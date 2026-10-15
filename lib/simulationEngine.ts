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
  BmkgVillages,
  windVectorDeg,
  type FirebreakRecommendation,
  type HotspotIncident,
  type PeatlandZone,
  type ThreatLevel,
  type TimeStepPolygon,
  type WeatherTelemetry,
} from "./gambut";

export const POLYGON_STEPS = 24; // one vertex every 15 degrees
export const FIREBREAK_PREP_HOURS = 3; // ground crew preparation horizon
export const FIREBREAK_BUFFER_M = 120; // safety buffer from the fire head
export const DEFAULT_LATENCY_HOURS = 3; // satellite picture-to-arrival delay
export const FORECAST_HOURS = [1, 3, 6, 9, 12] as const;

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
 * Run the full nowcast + forecast + firebreak computation for one incident.
 * Pure: returns new polygons without mutating the input.
 */
export function simulateSpread(input: SimulationInput, now: Date = new Date()) {
  const tLatency = latencyHours(input.satelliteAcquisitionTime, now);
  const r0 = input.peatlandInfo.baseSpreadRateR0;
  const m = moistureRetardation(input.weather.relativeHumidity);
  const wv = windVectorDeg(input.weather.windDirectionDeg);
  const ws = input.weather.windSpeedKmh;

  const distanceNowcast = (theta: number) =>
    spreadRateAt(theta, r0, m, wv, ws) * tLatency;
  const distanceForecast = (h: number) => (theta: number) =>
    spreadRateAt(theta, r0, m, wv, ws) * (tLatency + h);

  const nowcastPoly = buildSpreadPolygon(input.originLat, input.originLng, distanceNowcast);
  const nowcast = toTimeStep(
    0,
    now,
    nowcastPoly,
    maxRadiusAt(input.originLat, input.originLng, distanceNowcast, wv),
  );

  const forecastPolygons = FORECAST_HOURS.map((h) => {
    const dist = distanceForecast(h);
    return toTimeStep(
      h,
      now,
      buildSpreadPolygon(input.originLat, input.originLng, dist),
      maxRadiusAt(input.originLat, input.originLng, dist, wv),
    );
  });

  return {
    latencyHours: tLatency,
    moisture: m,
    headRate: headFireRate(r0, m, wv, ws),
    nowcastPolygon: nowcast,
    forecastPolygons,
  };
}

/* ------------------------------------------------------------------ */
/* Firebreak recommendation                                            */
/* ------------------------------------------------------------------ */

/**
 * Firebreak line cutting the head-fire path at the crew prep horizon
 * (t+3h) plus a 120 m safety buffer, as five arc points at
 * [wind-35, wind-17.5, wind, wind+17.5, wind+35].
 */
export function computeFirebreak(
  input: SimulationInput,
  now: Date = new Date(),
  options?: { bufferM?: number; prepHours?: number },
): FirebreakRecommendation {
  const tLatency = latencyHours(input.satelliteAcquisitionTime, now);
  const r0 = input.peatlandInfo.baseSpreadRateR0;
  const m = moistureRetardation(input.weather.relativeHumidity);
  const wv = windVectorDeg(input.weather.windDirectionDeg);
  const ws = input.weather.windSpeedKmh;
  const prepHours = options?.prepHours ?? FIREBREAK_PREP_HOURS;
  const bufferM = options?.bufferM ?? FIREBREAK_BUFFER_M;

  const headRate = headFireRate(r0, m, wv, ws);
  const offsets = [-35, -17.5, 0, 17.5, 35];
  const points: [number, number][] = [];

  for (const off of offsets) {
    const theta = (wv + off + 360) % 360;
    const rate = spreadRateAt(theta, r0, m, wv, ws);
    const dM = rate * (tLatency + prepHours) + bufferM;
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

  // Remaining time before the fire head touches the line:
  // (D_firebreak - D_nowcast) / headRate, in minutes.
  const dNowcast = headRate * tLatency;
  const dFirebreak = headRate * (tLatency + prepHours) + bufferM;
  const etaFireArrivalMinutes = Math.round(
    ((dFirebreak - dNowcast) / Math.max(headRate, 0.1)) * 60,
  );

  return {
    targetHourOffset: prepHours,
    coordinates: points,
    lengthMeters: Math.round(lengthMeters),
    safetyBufferMeters: bufferM,
    etaFireArrivalMinutes,
    tacticalNotes:
      `Potong jalur api pada horizon t+${prepHours} jam dengan penyangga ` +
      `${bufferM} m. Laju kepala api ${Math.round(headRate)} m/jam ke arah ` +
      `dorongan angin; perkiraan panjang sekat bakar ${Math.round(lengthMeters)} m.`,
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
}

export function threatFromEta(etaMinutes: number): ThreatLevel {
  if (etaMinutes <= 60) return "BAHAYA";
  if (etaMinutes <= 180) return "SIAGA";
  if (etaMinutes <= 360) return "WASPADA";
  return "AMAN";
}

/** Nearest village to the fire origin, with distance and escape bearing. */
export function computeNearestVillage(
  originLat: number,
  originLng: number,
  windDirectionDegValue: number,
  now: Date = new Date(),
  satelliteAcquisitionTime?: string,
  peatlandInfo?: PeatlandZone,
  weather?: WeatherTelemetry,
  knownHeadRate?: number,
): VillageThreat {
  const origin = point([originLng, originLat]);
  let best: (typeof BmkgVillages)[number] = BmkgVillages[0];
  let bestKm = Number.POSITIVE_INFINITY;
  for (const v of BmkgVillages) {
    const km = distance(origin, point([v.lng, v.lat]), { units: "kilometers" });
    if (km < bestKm) {
      bestKm = km;
      best = v;
    }
  }

  const distanceMeters = Math.round(bestKm * 1000);

  let etaMinutes = Number.POSITIVE_INFINITY;
  if (knownHeadRate !== undefined) {
    etaMinutes = (distanceMeters / Math.max(knownHeadRate, 0.1)) * 60;
  } else if (satelliteAcquisitionTime && peatlandInfo && weather) {
    const sim = simulateSpread(
      {
        originLat,
        originLng,
        satelliteAcquisitionTime,
        weather,
        peatlandInfo,
      },
      now,
    );
    // ETA for the fire head to travel the village distance at head-fire rate
    etaMinutes = (distanceMeters / Math.max(sim.headRate, 0.1)) * 60;
  }

  // Escape bearing: perpendicular to the wind push direction (crosswind).
  const safeEvacuationBearingDeg =
    (windVectorDeg(windDirectionDegValue) + 90) % 360;

  return {
    name: best.name,
    lat: best.lat,
    lng: best.lng,
    distanceMeters,
    threatLevel: threatFromEta(etaMinutes),
    safeEvacuationBearingDeg,
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
