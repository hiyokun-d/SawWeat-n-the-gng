/**
 * GambutWatch simulation engine (lib/simulationEngine.ts).
 *
 * Client-side 2D Cellular Automata fire-spread model, per prd.md:
 *
 *   R(theta) = R0 * (1 + w(theta))^m
 *
 *   R0 : base peat spread rate (m/h) by peat depth category
 *        DALAM (>3m) = 28, SEDANG (1-3m) = 18, DANGKAL (<1m) = 12
 *   m  : humidity retardation coefficient = 0.25 + 1.4 - RH/100
 *   w  : wind push factor (wind ellipse distribution)
 *        w(theta) = 0.12 * windSpeedKmh * (1 + cos(theta))^2 / 1.8
 *        where theta is the angular difference between the spread bearing
 *        and the wind vector (direction the wind pushes toward).
 *        Head fire (theta = 0) gets maximum push; backfire (theta = 180) gets w = 0.
 *
 *   D_nowcast(theta)   = R(theta) * t_latency
 *   D_forecast(theta,h) = R(theta) * (t_latency + h)
 *
 * R is integrated over time with the BMKG/Open-Meteo forecast, so wind
 * shifts, humidity swings and rain inside the 12 h window bend the polygons.
 *
 * All geometry runs through @turf/turf so it stays fast and works offline.
 */

import {
  area,
  bearing,
  destination,
  distance,
  lineString,
  length as lineLength,
  point,
  pointToLineDistance,
  polygon,
} from "@turf/turf";
import type { Feature, FeatureCollection, LineString, Polygon, Position } from "geojson";
import {
  compassName,
  windVectorDeg,
  type FirebreakRecommendation,
  type HotspotIncident,
  type PeatlandZone,
  type ThreatLevel,
  type TimeStepPolygon,
  type WeatherForecastStep,
  type WeatherTelemetry,
} from "./gambut";

export const POLYGON_STEPS = 24; // one vertex every 15 degrees
export const FIREBREAK_PREP_HOURS = 3; // ground crew preparation horizon
export const FIREBREAK_BUFFER_M = 120; // safety buffer from the fire head
export const DEFAULT_LATENCY_HOURS = 3; // satellite picture-to-arrival delay
/** Hourly steps so the timeline playback moves smoothly through the 12 h window. */
export const FORECAST_HOURS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

/** Minimum wind arrow length so a slow fire still gets a readable arrow. */
const WIND_ARROW_MIN_M = 250;

/* ------------------------------------------------------------------ */
/* Core rate formulas                                                  */
/* ------------------------------------------------------------------ */

/** Humidity retardation coefficient m = 0.25 + 1.4 - RH/100 (clamped). */
export function moistureRetardation(rh: number): number {
  return Math.min(3, Math.max(0.1, 0.25 + 1.4 - rh / 100));
}

/** Angular difference between two bearings, normalized to [-180, 180]. */
export function angleDelta(bearingDeg: number, referenceDeg: number): number {
  return ((((bearingDeg - referenceDeg) % 360) + 540) % 360) - 180;
}

/**
 * Wind push factor w(theta) with the wind ellipse distribution:
 * w = 0.12 * windSpeedKmh * (1 + cos(theta))^2 / 1.8
 */
export function windFactor(thetaDeg: number, windSpeedKmh: number): number {
  const cos = Math.cos((thetaDeg * Math.PI) / 180);
  return (0.12 * windSpeedKmh * (1 + cos) * (1 + cos)) / 1.8;
}

/** Fire spread rate (m/h) at a compass bearing, given wind and peat data. */
export function spreadRateAt(
  bearingDeg: number,
  r0: number,
  m: number,
  windVector: number,
  windSpeedKmh: number,
): number {
  const w = windFactor(angleDelta(bearingDeg, windVector), windSpeedKmh);
  return r0 * Math.pow(1 + w, m);
}

/** Head-fire rate: the maximum, along the wind push direction. */
export function headFireRate(
  r0: number,
  m: number,
  windVector: number,
  windSpeedKmh: number,
): number {
  return spreadRateAt(windVector, r0, m, windVector, windSpeedKmh);
}

/* ------------------------------------------------------------------ */
/* Polygon construction                                                */
/* ------------------------------------------------------------------ */

/**
 * Build the burn polygon for a given distance function.
 * 24 vertices every 15 degrees around the origin; distance in meters.
 */
export function buildSpreadPolygon(
  originLat: number,
  originLng: number,
  distanceAt: (bearingDeg: number) => number,
): Feature<Polygon> {
  const ring: Position[] = [];
  for (let i = 0; i < POLYGON_STEPS; i++) {
    const bearingDeg = (i * 360) / POLYGON_STEPS;
    const km = Math.max(distanceAt(bearingDeg), 0) / 1000;
    const pt = destination(point([originLng, originLat]), km, bearingDeg, {
      units: "kilometers",
    });
    ring.push(pt.geometry.coordinates);
  }
  ring.push(ring[0]); // close the ring
  return polygon([ring]);
}

export function polygonAreaHa(poly: Feature<Polygon>): number {
  return area(poly) / 10000;
}

export function maxRadiusAt(
  originLat: number,
  originLng: number,
  distanceAt: (bearingDeg: number) => number,
  windVector: number,
): number {
  return distanceAt(windVector);
}

/* ------------------------------------------------------------------ */
/* Incident simulation                                                 */
/* ------------------------------------------------------------------ */

/** Older detections are nowcast from this many hours ago, not from their pixel time. */
export const MAX_NOWCAST_HOURS = 12;
/** Integration step for time-varying weather. */
const STEP_HOURS = 0.5;
/** ETAs further out than this are reported as "beyond the forecast". */
export const MAX_ETA_HOURS = 48;

/**
 * Rain damping on the spread rate. Not part of the prd.md formula: a
 * heuristic so a forecast downpour slows the projection instead of being
 * ignored (about 1 mm/h cuts the rate by 30%, 5 mm/h by 80%).
 */
export function rainDamping(precipitationMmH: number): number {
  return Math.exp(-0.35 * Math.max(0, precipitationMmH));
}

/** Weather in effect at an instant: the latest forecast slot already started, else the current reading. */
export function weatherAt(weather: WeatherTelemetry, atMs: number) {
  const currentMs = Date.parse(weather.updatedAt);
  let slot: WeatherForecastStep | null = null;
  for (const s of weather.forecast ?? []) {
    const ms = Date.parse(s.at);
    if (ms > atMs) break;
    if (ms > currentMs) slot = s;
  }
  const src = slot ?? {
    windSpeedKmh: weather.windSpeedKmh,
    windDirectionDeg: weather.windDirectionDeg,
    relativeHumidity: weather.relativeHumidity,
    temperatureC: weather.temperatureC,
    precipitationMmH: weather.precipitationMmH ?? 0,
  };
  return {
    windSpeedKmh: src.windSpeedKmh,
    windDirectionDeg: src.windDirectionDeg,
    windVectorDeg: windVectorDeg(src.windDirectionDeg),
    relativeHumidity: src.relativeHumidity,
    temperatureC: src.temperatureC,
    precipitationMmH: src.precipitationMmH,
    fromForecast: slot !== null,
  };
}

/** Weather the spread model uses at a timeline hour (0 = now). */
export function weatherAtHour(weather: WeatherTelemetry, now: Date, hourOffset: number) {
  return weatherAt(weather, now.getTime() + hourOffset * 3600_000);
}

function toTimeStep(
  hourOffset: number,
  now: Date,
  poly: Feature<Polygon>,
  maxRadiusM: number,
): TimeStepPolygon {
  const stamp = new Date(now.getTime() + hourOffset * 3600_000);
  return {
    hourOffset,
    timestamp: stamp.toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Pontianak",
    }),
    geojsonPolygon: poly,
    burnedAreaHa: polygonAreaHa(poly),
    maxSpreadRadiusM: maxRadiusM,
  };
}

/** Hours between the satellite snapshot and "now" (the latency we nowcast over). */
export function latencyHours(
  acquisitionTime: string,
  now: Date,
): number {
  const ms = now.getTime() - new Date(acquisitionTime).getTime();
  return Math.max(0, ms / 3600_000);
}

export interface SimulationInput {
  originLat: number;
  originLng: number;
  satelliteAcquisitionTime: string;
  weather: WeatherTelemetry;
  peatlandInfo: PeatlandZone;
}

/**
 * Fire travel model with weather that changes over time:
 *
 *   D(theta, t) = sum over steps of R(theta; wind, RH, rain at that step) * dt
 *
 * integrated from the satellite pass (at most MAX_NOWCAST_HOURS back) to
 * now + t. With a flat forecast this equals the prd.md R(theta) * (t_latency + h).
 */
export function spreadModel(input: SimulationInput, now: Date = new Date()) {
  const nowMs = now.getTime();
  const acqMs = Date.parse(input.satelliteAcquisitionTime);
  const startMs = Math.min(nowMs, Math.max(acqMs, nowMs - MAX_NOWCAST_HOURS * 3600_000));
  const elapsedH = (nowMs - startMs) / 3600_000;
  const r0 = input.peatlandInfo.baseSpreadRateR0;

  const totalSteps = Math.ceil((elapsedH + MAX_ETA_HOURS) / STEP_HOURS);
  const conditions = Array.from({ length: totalSteps }, (_, i) => {
    // Sample mid-step so a slot boundary inside the step is split fairly
    const w = weatherAt(input.weather, startMs + (i + 0.5) * STEP_HOURS * 3600_000);
    return {
      wv: w.windVectorDeg,
      ws: w.windSpeedKmh,
      m: moistureRetardation(w.relativeHumidity),
      damp: rainDamping(w.precipitationMmH),
    };
  });

  const rateAt = (bearingDeg: number, step: number) => {
    const c = conditions[Math.min(step, conditions.length - 1)];
    return spreadRateAt(bearingDeg, r0, c.m, c.wv, c.ws) * c.damp;
  };

  /** Distance (m) reached along a bearing at each requested timeline hour. */
  const profile = (bearingDeg: number, hourOffsets: readonly number[]): number[] => {
    const out: number[] = [];
    let dist = 0;
    let step = 0;
    for (const h of hourOffsets) {
      const untilSteps = (elapsedH + h) / STEP_HOURS;
      while (step + 1 <= untilSteps) {
        dist += rateAt(bearingDeg, step) * STEP_HOURS;
        step++;
      }
      const frac = untilSteps - step;
      out.push(dist + (frac > 0 ? rateAt(bearingDeg, step) * frac * STEP_HOURS : 0));
    }
    return out;
  };

  const distanceAt = (bearingDeg: number, hourOffset: number) => profile(bearingDeg, [hourOffset])[0];

  /** Hours from now until the fire reaches `meters` along a bearing (0 if already there, Infinity past the forecast). */
  const hoursToReach = (bearingDeg: number, meters: number): number => {
    let dist = 0;
    for (let step = 0; step < conditions.length; step++) {
      const next = dist + rateAt(bearingDeg, step) * STEP_HOURS;
      if (next >= meters) {
        const frac = (meters - dist) / Math.max(next - dist, 1e-9);
        return Math.max(0, (step + frac) * STEP_HOURS - elapsedH);
      }
      dist = next;
    }
    return Number.POSITIVE_INFINITY;
  };

  /** Bearing where the fire has travelled furthest by a timeline hour (the head fire). */
  const headBearingAt = (hourOffset: number): number => {
    let best = 0;
    let bestD = -1;
    for (let b = 0; b < 360; b += 5) {
      const d = distanceAt(b, hourOffset);
      if (d > bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  };

  return { elapsedH, profile, distanceAt, hoursToReach, headBearingAt, rateAt };
}

export type SpreadModel = ReturnType<typeof spreadModel>;

/**
 * Run the full nowcast + forecast computation for one incident.
 * Pure: returns new polygons without mutating the input.
 */
export function simulateSpread(input: SimulationInput, now: Date = new Date()) {
  const model = spreadModel(input, now);
  const hours = [0, ...FORECAST_HOURS];
  const byBearing = Array.from({ length: POLYGON_STEPS }, (_, i) =>
    model.profile((i * 360) / POLYGON_STEPS, hours),
  );

  const steps = hours.map((h, hi) => {
    const poly = buildSpreadPolygon(
      input.originLat,
      input.originLng,
      (bearingDeg) => byBearing[Math.round((bearingDeg * POLYGON_STEPS) / 360) % POLYGON_STEPS][hi],
    );
    const maxRadius = Math.max(...byBearing.map((d) => d[hi]));
    return toTimeStep(h, now, poly, maxRadius);
  });

  const w = weatherAt(input.weather, now.getTime());
  return {
    model,
    latencyHours: model.elapsedH,
    moisture: moistureRetardation(w.relativeHumidity),
    headRate:
      headFireRate(input.peatlandInfo.baseSpreadRateR0, moistureRetardation(w.relativeHumidity), w.windVectorDeg, w.windSpeedKmh) *
      rainDamping(w.precipitationMmH),
    nowcastPolygon: steps[0],
    forecastPolygons: steps.slice(1),
  };
}

/* ------------------------------------------------------------------ */
/* Firebreak recommendation                                            */
/* ------------------------------------------------------------------ */

/**
 * Firebreak line cutting the head-fire path at the crew prep horizon
 * (t+3h) plus a 120 m safety buffer, as five arc points at
 * [head-35, head-17.5, head, head+17.5, head+35]. The head is where the
 * forecast wind has pushed the fire furthest by then, so a wind shift
 * during the prep window moves the line with it.
 */
export function computeFirebreak(
  input: SimulationInput,
  now: Date = new Date(),
  options?: { bufferM?: number; prepHours?: number; model?: SpreadModel },
): FirebreakRecommendation {
  const model = options?.model ?? spreadModel(input, now);
  const prepHours = options?.prepHours ?? FIREBREAK_PREP_HOURS;
  const bufferM = options?.bufferM ?? FIREBREAK_BUFFER_M;

  const head = model.headBearingAt(prepHours);
  const offsets = [-35, -17.5, 0, 17.5, 35];
  const points: [number, number][] = [];

  for (const off of offsets) {
    const theta = (head + off + 360) % 360;
    const dM = model.distanceAt(theta, prepHours) + bufferM;
    const pt = destination(
      point([input.originLng, input.originLat]),
      dM / 1000,
      theta,
      { units: "kilometers" },
    );
    const [lng, lat] = pt.geometry.coordinates;
    points.push([lat, lng]); // PRD contract: [lat, lng]
  }

  const line = lineString(points.map(([lat, lng]) => [lng, lat]));
  const lengthMeters = lineLength(line, { units: "meters" });

  // Remaining time before the fire head touches the line, under the forecast weather
  const headLineM = model.distanceAt(head, prepHours) + bufferM;
  const etaH = model.hoursToReach(head, headLineM);
  const etaFireArrivalMinutes = Math.round(Math.min(etaH, MAX_ETA_HOURS) * 60);
  const nowRate = model.rateAt(head, Math.floor(model.elapsedH / STEP_HOURS));
  const prepWind = weatherAtHour(input.weather, now, prepHours);

  return {
    targetHourOffset: prepHours,
    coordinates: points,
    lengthMeters: Math.round(lengthMeters),
    safetyBufferMeters: bufferM,
    etaFireArrivalMinutes,
    tacticalNotes:
      `Kepala api diproyeksikan bergerak ke ${compassName(head)} (${head}°) pada t+${prepHours} jam ` +
      `mengikuti prakiraan angin ${Math.round(prepWind.windSpeedKmh)} km/jam dari ` +
      `${compassName(prepWind.windDirectionDeg)}. Laju kepala api saat ini ${Math.round(nowRate)} m/jam; ` +
      `potong jalur sepanjang ${Math.round(lengthMeters)} m dengan penyangga ${bufferM} m.`,
  };
}

/** GeoJSON LineString of the firebreak (map-ready [lng, lat] order). */
export function firebreakLineString(
  rec: FirebreakRecommendation,
): Feature<LineString> {
  return lineString(rec.coordinates.map(([lat, lng]) => [lng, lat]));
}

/* ------------------------------------------------------------------ */
/* Village threat assessment                                           */
/* ------------------------------------------------------------------ */

export interface VillageThreat {
  name: string;
  lat: number;
  lng: number;
  distanceMeters: number;
  threatLevel: ThreatLevel;
  safeEvacuationBearingDeg: number;
  population?: number;
}

export function threatFromEta(etaMinutes: number): ThreatLevel {
  if (etaMinutes <= 60) return "BAHAYA";
  if (etaMinutes <= 180) return "SIAGA";
  if (etaMinutes <= 360) return "WASPADA";
  return "AMAN";
}

/**
 * Threat to a village: how long the fire takes to cover the distance along
 * the bearing toward it, under the forecast wind (a village upwind is reached
 * slowly or not at all inside the forecast window).
 */
export function computeVillageThreat(
  input: SimulationInput,
  village: { name: string; lat: number; lng: number; population?: number },
  now: Date = new Date(),
  model: SpreadModel = spreadModel(input, now),
): VillageThreat & { etaMinutes: number } {
  const origin = point([input.originLng, input.originLat]);
  const target = point([village.lng, village.lat]);
  const distanceMeters = Math.round(distance(origin, target, { units: "kilometers" }) * 1000);
  const towardVillage = (bearing(origin, target) + 360) % 360;
  const etaMinutes = model.hoursToReach(towardVillage, distanceMeters) * 60;

  // Escape bearing: perpendicular to the wind push direction (crosswind),
  // on the side away from the fire
  const wv = weatherAt(input.weather, now.getTime()).windVectorDeg;
  const left = (wv + 270) % 360;
  const right = (wv + 90) % 360;
  const safeEvacuationBearingDeg =
    Math.abs(angleDelta(left, towardVillage)) < Math.abs(angleDelta(right, towardVillage)) ? left : right;

  return {
    name: village.name,
    lat: village.lat,
    lng: village.lng,
    distanceMeters,
    threatLevel: threatFromEta(etaMinutes),
    safeEvacuationBearingDeg,
    etaMinutes,
    population: village.population,
  };
}

/** Distance in meters from a volunteer position to the firebreak line. */
export function distanceToFirebreakMeters(
  volunteerLat: number,
  volunteerLng: number,
  rec: FirebreakRecommendation,
): number {
  const line = firebreakLineString(rec);
  const km = pointToLineDistance(point([volunteerLng, volunteerLat]), line, {
    units: "kilometers",
  });
  return km * 1000;
}

/** Bearing from the volunteer to the fire origin (for the HUD compass). */
export function bearingToFire(
  volunteerLat: number,
  volunteerLng: number,
  fireLat: number,
  fireLng: number,
): number {
  return bearing(point([volunteerLng, volunteerLat]), point([fireLng, fireLat]));
}

/** Distance in meters from the volunteer to the fire origin. */
export function distanceToFireMeters(
  volunteerLat: number,
  volunteerLng: number,
  fireLat: number,
  fireLng: number,
): number {
  return distance(point([volunteerLng, volunteerLat]), point([fireLng, fireLat]), {
    units: "kilometers",
  }) * 1000;
}

/**
 * Spread rate (m/h) of the fire toward the volunteer, for the HUD readout.
 * The fire travels from its origin to the volunteer, so the bearing is
 * origin -> volunteer (the reverse of the HUD compass bearing).
 */
export function spreadRateToward(
  volunteerLat: number,
  volunteerLng: number,
  incident: Pick<HotspotIncident, "originLat" | "originLng" | "weather" | "peatlandInfo">,
): number {
  const brg = bearingToFire(incident.originLat, incident.originLng, volunteerLat, volunteerLng);
  const m = moistureRetardation(incident.weather.relativeHumidity);
  const wv = windVectorDeg(incident.weather.windDirectionDeg);
  return spreadRateAt(brg, incident.peatlandInfo.baseSpreadRateR0, m, wv, incident.weather.windSpeedKmh);
}

/** Polygon of an incident at a timeline hour (0 = nowcast; unknown hours snap to the last forecast). */
export function stepPolygonFor(
  incident: Pick<HotspotIncident, "nowcastPolygon" | "forecastPolygons">,
  hourOffset: number,
): TimeStepPolygon {
  if (hourOffset === 0) return incident.nowcastPolygon;
  return (
    incident.forecastPolygons.find((p) => p.hourOffset === hourOffset) ??
    incident.forecastPolygons[incident.forecastPolygons.length - 1] ??
    incident.nowcastPolygon
  );
}

/* ------------------------------------------------------------------ */
/* Wind arrow                                                          */
/* ------------------------------------------------------------------ */

/**
 * Wind-push arrow anchored on the fire origin and pointing the way the wind
 * drives the head fire: a shaft (LineString) plus a triangular head (Polygon),
 * tagged by `properties.part`. Length follows the head-fire reach so the tip
 * pokes out of the burn polygon.
 */
export function windArrowGeometry(
  originLat: number,
  originLng: number,
  windVector: number,
  reachM: number,
): FeatureCollection<LineString | Polygon, { part: "shaft" | "head" }> {
  const lengthM = Math.max(reachM * 1.25, WIND_ARROW_MIN_M);
  const headM = Math.max(lengthM * 0.16, 60);
  const from = point([originLng, originLat]);
  const tip = destination(from, lengthM / 1000, windVector, { units: "kilometers" });
  const baseLeft = destination(tip, headM / 1000, (windVector + 150) % 360, {
    units: "kilometers",
  });
  const baseRight = destination(tip, headM / 1000, (windVector + 210) % 360, {
    units: "kilometers",
  });
  const tipXY = tip.geometry.coordinates;
  const leftXY = baseLeft.geometry.coordinates;
  const rightXY = baseRight.geometry.coordinates;

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { part: "shaft" },
        geometry: { type: "LineString", coordinates: [[originLng, originLat], tipXY] },
      },
      {
        type: "Feature",
        properties: { part: "head" },
        geometry: { type: "Polygon", coordinates: [[tipXY, leftXY, rightXY, tipXY]] },
      },
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Smoke drift and evacuation                                          */
/* ------------------------------------------------------------------ */

/**
 * Smoke drift cone: where the plume is carried by the wind at a timeline
 * hour. A visual model, not a dispersion simulation: the cone opens 18
 * degrees each side of the wind push, its reach is the distance the wind
 * travels in two hours (2-60 km), stretched for stronger fires (FRP).
 */
export function smokePlume(
  incident: Pick<HotspotIncident, "originLat" | "originLng" | "weather" | "frpMegawatt">,
  now: Date,
  hourOffset: number,
): Feature<Polygon, { reachKm: number }> {
  const w = weatherAtHour(incident.weather, now, hourOffset);
  const strength = 1 + Math.min(incident.frpMegawatt, 300) / 100;
  const reachKm = Math.min(60, Math.max(2, w.windSpeedKmh * 2 * strength));
  const origin = point([incident.originLng, incident.originLat]);
  const ring: Position[] = [[incident.originLng, incident.originLat]];
  for (let off = -18; off <= 18; off += 6) {
    ring.push(
      destination(origin, reachKm, (w.windVectorDeg + off + 360) % 360, { units: "kilometers" }).geometry
        .coordinates,
    );
  }
  ring.push([incident.originLng, incident.originLat]);
  return polygon([ring], { reachKm });
}

/** Evacuation arrow from a village along its safe (crosswind) bearing. */
export function evacuationArrow(
  village: { lat: number; lng: number; safeEvacuationBearingDeg: number },
  lengthM = 3000,
) {
  return windArrowGeometry(village.lat, village.lng, village.safeEvacuationBearingDeg, lengthM / 1.25);
}
