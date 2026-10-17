"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AirGridResponseSchema,
  decodeHotspots,
  type AirQuality,
  DEFAULT_ADM4,
  FIRE_STATUS_ORDER,
  FirmsApiResponseSchema,
  MaritimeApiResponseSchema,
  toFireStatus,
  WeatherApiResponseSchema,
  WeatherGridResponseSchema,
  type FireStatus,
  type FirmsSourceStatus,
  type FusedHotspot,
  type HotspotIncident,
  type Settlement,
  type ThreatLevel,
  type WeatherSource,
  type WeatherTelemetry,
} from "@/lib/gambut";
import { hotspotToSource, type HotspotSource } from "@/data/hotspotSource";
import { backgroundSlot, reportFeed, trackedJson } from "@/lib/apiHealth";
import {
  computeFirebreak,
  computeVillageThreat,
  simulateSpread,
  smokePlume,
  stepPolygonFor,
} from "@/lib/simulationEngine";
import { circle } from "@turf/turf";
import type { Region } from "@/lib/geocode";
import type { NewsArticle } from "@/lib/news";
import {
  loadPersistedStatuses,
  persistStatuses,
  publishSync,
  subscribeSync,
  type SyncMessage,
} from "@/lib/syncChannel";

export interface MaritimeConditions {
  code: string;
  name: string;
  weather: string;
  windSpeedKmh: number;
  windFrom: string;
  waveCategory: string | null;
  waveHeightM: number | null;
  windVectorDeg: number;
}

/** west, south, east, north */
export type Bbox = [number, number, number, number];

type StatusMap = Record<string, { status: FireStatus; verifiedBy?: string; verifiedAt?: string }>;

/** Which fires the map and list show. Counters in the top bar always count everything. */
export interface HotspotFilter {
  statuses: FireStatus[];
  region: "indonesia" | "all";
  /** Only fires seen within this many hours; null = the whole data window. */
  maxAgeHours: number | null;
}

export const DEFAULT_FILTER: HotspotFilter = {
  statuses: [...FIRE_STATUS_ORDER],
  region: "all",
  maxAgeHours: null,
};

/** Dashboard opening view: only fires burning right now; the Peta tab filter brings the rest back. */
export const BURNING_FILTER: HotspotFilter = { ...DEFAULT_FILTER, statuses: ["CONFIRMED_FLAMING"] };

/** Fires seen within this many hours pulse on the map. */
export const FRESH_HOURS = 3;

/** Hotspot with the status operators see (satellite-derived, or a newer field verification). */
export type MapHotspot = FusedHotspot & { effectiveStatus: FireStatus; fresh: boolean };

interface CellWeather {
  source: "bmkg" | "open-meteo";
  place?: string | null;
  telemetry: WeatherTelemetry;
}

/**
 * Fires simulated up front: Indonesia's most urgent, whatever the camera shows,
 * so zooming and panning across the country never re-simulates or refetches.
 */
const ACTIVE_LIMIT = 150;
/** Extra fires simulated from the current view, for places outside the preloaded set. */
const VIEW_EXTRA_LIMIT = 40;
/** Whole Indonesia (west, south, east, north): the default viewport. */
const INDONESIA_VIEW: Bbox = [94.9, -11.2, 141.1, 6.2];
/** Fires whose danger and smoke zones get a WorldPop headcount (one request per zone). */
const POPULATION_LIMIT = 60;
/** At most this many headcount lookups per 0.5-degree area. */
const POPULATION_PER_CELL = 3;
/** A village further than this is not "the village this fire threatens". */
const VILLAGE_MAX_KM = 30;
/** Danger zone = the +12 h spread reach plus this buffer, where residents must be ready to move. */
export const DANGER_BUFFER_M = 2_000;
/** Weather is fetched per 0.5-degree area (about 55 km) around each simulated fire. */
const CELL_DEG = 0.5;
const MAX_CELLS_PER_REQUEST = 80;

const THREAT_RANK: Record<ThreatLevel, number> = { BAHAYA: 0, SIAGA: 1, WASPADA: 2, AMAN: 3 };

export function cellKey(lat: number, lng: number): string {
  const c = (v: number) => (Math.floor(v / CELL_DEG) * CELL_DEG + CELL_DEG / 2).toFixed(2);
  return `${c(lat)},${c(lng)}`;
}

function inBbox(h: { lat: number; lng: number }, [w, s, e, n]: Bbox): boolean {
  // A view crossing the antimeridian has w > e
  const lngIn = w <= e ? h.lng >= w && h.lng <= e : h.lng >= w || h.lng <= e;
  return lngIn && h.lat >= s && h.lat <= n;
}

/**
 * Status shown for a fire: a field verification wins until a satellite
 * sees the fire again after it (prd.md: a new hotspot reopens the incident).
 */
function effectiveStatus(h: FusedHotspot, entry: StatusMap[string] | undefined): FireStatus {
  if (!entry) return h.status;
  if (entry.verifiedAt && Date.parse(entry.verifiedAt) < Date.parse(h.lastSeen)) return h.status;
  return entry.status;
}

function priority(h: MapHotspot): number[] {
  return [h.inIndonesia ? 0 : 1, FIRE_STATUS_ORDER.indexOf(h.effectiveStatus), -h.maxFrpMegawatt];
}

function compareRank(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

// Polygons depend only on the source and its weather, not on the verification
// status, so a status change (HUD button) reuses them.
const geometryCache = new WeakMap<
  HotspotSource,
  {
    weather: WeatherTelemetry;
    village: Settlement | null;
    geometry: Pick<HotspotIncident, "nowcastPolygon" | "forecastPolygons" | "firebreak" | "nearestVillage">;
  }
>();

function buildIncident(
  source: HotspotSource,
  weather: WeatherTelemetry,
  village: Settlement | null,
  status: FireStatus,
  verifiedBy?: string,
  verifiedAt?: string,
): HotspotIncident {
  let cached = geometryCache.get(source);
  if (!cached || cached.weather !== weather || cached.village !== village) {
    const now = new Date();
    const input = {
      originLat: source.originLat,
      originLng: source.originLng,
      satelliteAcquisitionTime: source.satelliteAcquisitionTime,
      weather,
      peatlandInfo: source.peatlandInfo,
    };
    const sim = simulateSpread(input, now);
    cached = {
      weather,
      village,
      geometry: {
        nowcastPolygon: sim.nowcastPolygon,
        forecastPolygons: sim.forecastPolygons,
        firebreak: computeFirebreak(input, now, { model: sim.model }),
        nearestVillage: village ? computeVillageThreat(input, village, now, sim.model) : null,
      },
    };
    geometryCache.set(source, cached);
  }
  // Same inputs, same object: unchanged fires then cost nothing downstream (map layers, lists)
  const prev = incidentCache.get(source);
  if (
    prev &&
    prev.weather === weather &&
    prev.status === status &&
    prev.nowcastPolygon === cached.geometry.nowcastPolygon &&
    prev.nearestVillage === cached.geometry.nearestVillage &&
    prev.lastVerifiedBy === verifiedBy &&
    prev.lastVerifiedAt === verifiedAt
  ) {
    return prev;
  }
  const incident: HotspotIncident = {
    ...source,
    status,
    weather,
    ...cached.geometry,
    lastVerifiedBy: verifiedBy,
    lastVerifiedAt: verifiedAt,
  };
  incidentCache.set(source, incident);
  return incident;
}

const incidentCache = new WeakMap<HotspotSource, HotspotIncident>();

function sameRecord<T>(a: Record<string, T>, b: Record<string, T>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

function sameItems<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Statistics over every fire in the current view, simulated or not. */
export interface ViewStats {
  fires: number;
  indonesia: number;
  insideKhg: number;
  fresh: number;
  totalFrp: number;
  detections: number;
  byStatus: Record<FireStatus, number>;
  bySatellite: Record<string, number>;
}

/** Residents per incident zone from WorldPop (null = lookup failed). */
export interface ZonePopulation {
  danger: number | null;
  smoke: number | null;
}

export interface FirmsState {
  status: "loading" | "ok" | "error";
  /** True when MAP_KEY is set, so Indonesia gets three days of history. */
  keyed: boolean;
  detections: number;
  sources: FirmsSourceStatus[];
  fetchedAt: string | null;
  reason: string | null;
}

export interface UseIncidentsResult {
  /** Simulated incidents: the most urgent fires in view, Indonesia first. */
  incidents: HotspotIncident[];
  /** Fire events worldwide that pass the filter, for the map layer. */
  hotspots: MapHotspot[];
  /** Air quality per 0.5-degree area around simulated fires (key = cellKey). */
  air: Record<string, AirQuality>;
  filter: HotspotFilter;
  setFilter: (f: HotspotFilter) => void;
  viewStats: ViewStats;
  /** WorldPop residents per incident id (top POPULATION_LIMIT incidents). */
  population: Record<string, ZonePopulation>;
  /** Kabupaten/province per 0.5-degree area (key = cellKey). */
  regions: Record<string, Region | null>;
  /** Karhutla news per kabupaten name. */
  areaNews: Record<string, NewsArticle[]>;
  /** Counts per status: worldwide and inside Indonesia. */
  statusCounts: { world: Record<FireStatus, number>; indonesia: Record<FireStatus, number> };
  /** Fires in view still waiting for their area's weather before simulation. */
  pendingWeather: number;
  /** Fires in view beyond ACTIVE_LIMIT that are on the map but not simulated. */
  overflow: number;
  weather: WeatherTelemetry | null;
  /** Provider that supplied `weather` (attribution is required for both). */
  weatherSource: WeatherSource | null;
  /** Weather provider per simulated incident id. */
  incidentWeatherSource: Record<string, { source: "bmkg" | "open-meteo"; place?: string | null }>;
  maritime: MaritimeConditions | null;
  weatherError: string | null;
  weatherLoading: boolean;
  selectedId: string | null;
  /** Selection made by a person (list, map, other window), not the default pick. */
  focusId: string | null;
  selectIncident: (id: string) => void;
  selectedIncident: HotspotIncident | null;
  refreshWeather: () => void;
  setViewport: (bbox: Bbox) => void;
  firms: FirmsState;
  satelliteNotice: string | null;
}

function emptyCounts(): Record<FireStatus, number> {
  return {
    UNVERIFIED_HOTSPOT: 0,
    CONFIRMED_FLAMING: 0,
    SUSPECTED_SMOLDERING: 0,
    CONFIRMED_SMOLDERING: 0,
    EXTINGUISHED: 0,
  };
}

/** Run `run` for keys not requested yet, in batches; failed keys are released for a retry. */
async function fetchMissing(
  keys: string[],
  requested: Set<string>,
  batchSize: number,
  run: (batch: string[]) => Promise<void>,
) {
  const missing = [...new Set(keys)].filter((k) => !requested.has(k));
  for (let i = 0; i < missing.length; i += batchSize) {
    const batch = missing.slice(i, i + batchSize);
    batch.forEach((k) => requested.add(k));
    try {
      await run(batch);
    } catch {
      batch.forEach((k) => requested.delete(k));
    }
  }
}

function nearestWithin(lat: number, lng: number, places: Settlement[], maxKm: number): Settlement | null {
  let best: Settlement | null = null;
  let bestKm = maxKm;
  const cos = Math.cos((lat * Math.PI) / 180);
  for (const p of places) {
    const km = Math.hypot(p.lat - lat, (p.lng - lng) * cos) * 111.32;
    if (km <= bestKm) {
      bestKm = km;
      best = p;
    }
  }
  return best;
}

export function useIncidents(
  initialViewport: Bbox = INDONESIA_VIEW,
  /** Fires kept simulated and preloaded regardless of the view (presentation scenes). */
  pinnedIds: string[] = [],
  initialFilter: HotspotFilter = DEFAULT_FILTER,
): UseIncidentsResult {
  const [statuses, setStatuses] = useState<StatusMap>({});
  const [weather, setWeather] = useState<WeatherTelemetry | null>(null);
  const [weatherSource, setWeatherSource] = useState<WeatherSource | null>(null);
  const [maritime, setMaritime] = useState<MaritimeConditions | null>(null);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [rawHotspots, setRawHotspots] = useState<FusedHotspot[]>([]);
  const [firms, setFirms] = useState<FirmsState>({
    status: "loading",
    keyed: false,
    detections: 0,
    sources: [],
    fetchedAt: null,
    reason: null,
  });
  const [viewport, setViewportState] = useState<Bbox>(initialViewport);
  const [cellWeather, setCellWeather] = useState<Record<string, CellWeather>>({});
  const [places, setPlaces] = useState<Record<string, Settlement | null>>({});
  const [air, setAir] = useState<Record<string, AirQuality>>({});
  const [filter, setFilter] = useState<HotspotFilter>(initialFilter);
  const requestedAir = useRef(new Set<string>());
  const [placesByCell, setPlacesByCell] = useState<Record<string, Settlement[]>>({});
  const requestedPlaceCells = useRef(new Set<string>());
  const [regions, setRegions] = useState<Record<string, Region | null>>({});
  const [areaNews, setAreaNews] = useState<Record<string, NewsArticle[]>>({});
  const requestedRegions = useRef(new Set<string>());
  const [population, setPopulation] = useState<Record<string, ZonePopulation>>({});
  const requestedPopulation = useRef(new Set<string>());
  const [placeWeather, setPlaceWeather] = useState<Record<string, CellWeather>>({});
  const hydrated = useRef(false);
  const requestedCells = useRef(new Set<string>());
  const requestedPlaces = useRef(new Set<string>());

  /* ---------------- weather (BMKG, Open-Meteo fallback) ---------------- */

  const loadWeather = useCallback(async () => {
    setWeatherLoading(true);
    try {
      const json = await trackedJson<{ ok?: boolean }>("bmkg", `/api/weather?adm4=${DEFAULT_ADM4}`, {
        isOk: (j) => j.ok === true,
      });
      const parsed = WeatherApiResponseSchema.safeParse(json);
      if (!parsed.success) {
        const errorMessage =
          typeof json === "object" && json !== null && "error" in json
            ? String((json as { error: unknown }).error)
            : "Respons cuaca tidak dikenali";
        setWeatherError(errorMessage);
        return;
      }
      setWeather(parsed.data.telemetry);
      setWeatherSource(parsed.data.source);
      setWeatherError(null);
      publishSync({ type: "weather:telemetry", telemetry: parsed.data.telemetry });
    } catch (err) {
      setWeatherError(err instanceof Error ? err.message : "Gagal memuat data cuaca");
    } finally {
      setWeatherLoading(false);
    }
  }, []);

  /* ---------------- maritime (BMKG maritim) ---------------- */

  const loadMaritime = useCallback(async () => {
    try {
      const json = await trackedJson<{ ok?: boolean }>("maritime", "/api/maritime", {
        isOk: (j) => j.ok === true,
      });
      const parsed = MaritimeApiResponseSchema.safeParse(json);
      if (!parsed.success) return;
      const c = parsed.data.current;
      setMaritime({
        code: parsed.data.code,
        name: parsed.data.name,
        weather: c.weather,
        windSpeedKmh: c.windSpeedKmh,
        windFrom: c.windFrom,
        waveCategory: c.waveCategory ?? null,
        waveHeightM: c.waveHeightM ?? null,
        windVectorDeg: c.windVectorDeg,
      });
    } catch {
      // maritime is supplementary; ignore failures
    }
  }, []);

  /* ---------------- NASA FIRMS (worldwide, every satellite) ---------------- */

  const loadFirms = useCallback(async () => {
    try {
      const json = await trackedJson<{ ok?: boolean; detections?: number }>("firms", "/api/firms", {
        isOk: (j) => j.ok === true,
        count: (j) => j.detections ?? null,
      });
      const parsed = FirmsApiResponseSchema.safeParse(json);
      if (!parsed.success) throw new Error("Respons FIRMS tidak dikenali");
      const d = parsed.data;
      if (!d.ok || !d.hotspots) {
        // A failed refresh keeps the fires already on screen
        setFirms((prev) => ({
          ...prev,
          status: prev.status === "ok" ? "ok" : "error",
          keyed: d.keyed,
          reason: d.reason ?? "Gagal memuat NASA FIRMS",
        }));
        return;
      }
      setRawHotspots(decodeHotspots(d.hotspots));
      setFirms({
        status: "ok",
        keyed: d.keyed,
        detections: d.detections,
        sources: d.sources,
        fetchedAt: d.fetchedAt ?? null,
        reason: null,
      });
    } catch (err) {
      setFirms((prev) => ({
        ...prev,
        status: prev.status === "ok" ? "ok" : "error",
        reason: err instanceof Error ? err.message : "Gagal memuat NASA FIRMS",
      }));
    }
  }, []);

  useEffect(() => {
    void loadWeather();
    void loadMaritime();
    void loadFirms();
    const weatherTimer = window.setInterval(() => {
      void loadWeather();
      void loadMaritime();
    }, 5 * 60_000);
    // The proxy refreshes FIRMS every 10 minutes
    const firmsTimer = window.setInterval(() => void loadFirms(), 10 * 60_000);
    // Area forecasts are cached 30 minutes server-side; let them refetch after that
    const cellTimer = window.setInterval(() => {
      requestedCells.current.clear();
      requestedAir.current.clear();
      requestedPopulation.current.clear();
      setCellWeather({});
      setAir({});
    }, 30 * 60_000);
    return () => {
      window.clearInterval(weatherTimer);
      window.clearInterval(firmsTimer);
      window.clearInterval(cellTimer);
    };
  }, [loadWeather, loadMaritime, loadFirms]);

  /* ---------------- hydrate persisted statuses ---------------- */

  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    const persisted = loadPersistedStatuses();
    const restored: StatusMap = {};
    for (const [id, entry] of Object.entries(persisted)) {
      const status = toFireStatus(entry.status);
      if (status) restored[id] = { status, verifiedBy: entry.verifiedBy, verifiedAt: entry.verifiedAt };
    }
    if (Object.keys(restored).length > 0) setStatuses(restored);
  }, []);

  useEffect(() => {
    persistStatuses(statuses);
  }, [statuses]);

  /* ---------------- cross-window sync ---------------- */

  useEffect(() => {
    return subscribeSync((msg: SyncMessage) => {
      if (msg.type === "incident:status") {
        const status = toFireStatus(msg.status);
        if (!status) return;
        setStatuses((prev) => ({
          ...prev,
          [msg.id]: { status, verifiedBy: msg.verifiedBy, verifiedAt: msg.verifiedAt },
        }));
      } else if (msg.type === "incident:select") {
        setFocusId(msg.id);
      } else if (msg.type === "weather:telemetry") {
        setWeather(msg.telemetry);
      }
    });
  }, []);

  /* ---------------- hotspots, status and the active set ---------------- */

  const allHotspots = useMemo<MapHotspot[]>(() => {
    const newest = rawHotspots.reduce((m, h) => Math.max(m, Date.parse(h.lastSeen)), 0);
    return rawHotspots.map((h) => ({
      ...h,
      effectiveStatus: effectiveStatus(h, statuses[h.id]),
      // Relative to the newest pass in the data, so it needs no clock
      fresh: newest - Date.parse(h.lastSeen) <= FRESH_HOURS * 3600_000,
    }));
  }, [rawHotspots, statuses]);

  const hotspots = useMemo(() => {
    const newest = rawHotspots.reduce((m, h) => Math.max(m, Date.parse(h.lastSeen)), 0);
    const allowed = new Set(filter.statuses);
    return allHotspots.filter(
      (h) =>
        allowed.has(h.effectiveStatus) &&
        (filter.region === "all" || h.inIndonesia) &&
        (filter.maxAgeHours === null ||
          newest - Date.parse(h.lastSeen) <= filter.maxAgeHours * 3600_000),
    );
  }, [allHotspots, rawHotspots, filter]);

  const statusCounts = useMemo(() => {
    const world = emptyCounts();
    const indonesia = emptyCounts();
    for (const h of allHotspots) {
      world[h.effectiveStatus] += 1;
      if (h.inIndonesia) indonesia[h.effectiveStatus] += 1;
    }
    return { world, indonesia };
  }, [allHotspots]);

  const pinnedKey = pinnedIds.join("|");
  const preload = useMemo(
    () =>
      hotspots
        .filter((h) => h.inIndonesia)
        .sort((a, b) => compareRank(priority(a), priority(b)))
        .slice(0, ACTIVE_LIMIT),
    [hotspots],
  );
  const { active, overflow, viewStats } = useMemo(() => {
    const inView = hotspots.filter((h) => inBbox(h, viewport));
    inView.sort((a, b) => compareRank(priority(a), priority(b)));
    // `preload` does not depend on the viewport, so its memo survives every camera move
    const picked = [...preload];
    const chosen = new Set(picked);
    let extra = 0;
    for (const h of inView) {
      if (extra >= VIEW_EXTRA_LIMIT) break;
      if (chosen.has(h)) continue;
      picked.push(h);
      chosen.add(h);
      extra += 1;
    }
    // The focused and pinned fires stay simulated even after panning away from them
    const keep = new Set([focusId, ...pinnedKey.split("|")].filter(Boolean));
    for (const h of allHotspots) {
      if (keep.has(h.id) && !chosen.has(h)) {
        picked.push(h);
        chosen.add(h);
      }
    }

    const stats: ViewStats = {
      fires: inView.length,
      indonesia: 0,
      insideKhg: 0,
      fresh: 0,
      totalFrp: 0,
      detections: 0,
      byStatus: emptyCounts(),
      bySatellite: {},
    };
    for (const h of inView) {
      if (h.inIndonesia) stats.indonesia += 1;
      if (h.insideKhg) stats.insideKhg += 1;
      if (h.fresh) stats.fresh += 1;
      stats.totalFrp += h.maxFrpMegawatt;
      stats.detections += h.detectionCount;
      stats.byStatus[h.effectiveStatus] += 1;
      for (const sat of h.satellites) stats.bySatellite[sat] = (stats.bySatellite[sat] ?? 0) + 1;
    }
    const simulatedInView = inView.filter((h) => chosen.has(h)).length;
    return { active: picked, overflow: Math.max(0, inView.length - simulatedInView), viewStats: stats };
  }, [hotspots, allHotspots, preload, viewport, focusId, pinnedKey]);

  // Sources are memoized per hotspot object so the geometry cache survives re-renders
  const sourceCache = useRef(new WeakMap<FusedHotspot, HotspotSource>());
  const receivedAt = firms.fetchedAt ?? "";
  const rawById = useMemo(() => new Map(rawHotspots.map((h) => [h.id, h])), [rawHotspots]);
  const activeSources = useMemo(
    () =>
      active.map((h) => {
        const raw = rawById.get(h.id) ?? h;
        let src = sourceCache.current.get(raw);
        if (!src) {
          src = hotspotToSource(raw, receivedAt);
          sourceCache.current.set(raw, src);
        }
        return { hotspot: h, source: src };
      }),
    [active, rawById, receivedAt],
  );

  /* ---------------- per-area weather for the active set ---------------- */

  useEffect(() => {
    const missing = [...new Set(active.map((h) => cellKey(h.lat, h.lng)))].filter(
      (k) => !requestedCells.current.has(k),
    );
    if (missing.length === 0) return;
    const timer = window.setTimeout(async () => {
      for (let i = 0; i < missing.length; i += MAX_CELLS_PER_REQUEST) {
        const batch = missing.slice(i, i + MAX_CELLS_PER_REQUEST);
        batch.forEach((k) => requestedCells.current.add(k));
        try {
          const json = await trackedJson<{ ok?: boolean; cells?: unknown[] }>(
            "grid",
            `/api/weather/grid?cells=${encodeURIComponent(batch.join(";"))}`,
            { isOk: (j) => j.ok === true, count: (j) => j.cells?.length ?? null },
          );
          const parsed = WeatherGridResponseSchema.safeParse(json);
          if (!parsed.success) throw new Error("grid");
          setCellWeather((prev) => {
            const next = { ...prev };
            for (const c of parsed.data.cells) {
              next[c.key] = { source: c.source, place: c.place, telemetry: c.telemetry };
            }
            return next;
          });
          // Areas the providers did not answer may be retried on the next view change
          const answered = new Set(parsed.data.cells.map((c) => c.key));
          batch.filter((k) => !answered.has(k)).forEach((k) => requestedCells.current.delete(k));
        } catch {
          batch.forEach((k) => requestedCells.current.delete(k));
        }
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [active]);

  /* ---------------- air quality for the active set ---------------- */

  useEffect(() => {
    const missing = [...new Set(active.map((h) => cellKey(h.lat, h.lng)))].filter(
      (k) => !requestedAir.current.has(k),
    );
    if (missing.length === 0) return;
    const timer = window.setTimeout(async () => {
      for (let i = 0; i < missing.length; i += MAX_CELLS_PER_REQUEST) {
        const batch = missing.slice(i, i + MAX_CELLS_PER_REQUEST);
        batch.forEach((k) => requestedAir.current.add(k));
        try {
          const json = await trackedJson<{ ok?: boolean; cells?: unknown[] }>(
            "air",
            `/api/air?cells=${encodeURIComponent(batch.join(";"))}`,
            { isOk: (j) => j.ok === true, count: (j) => j.cells?.length ?? null },
          );
          const parsed = AirGridResponseSchema.safeParse(json);
          if (!parsed.success) throw new Error("air");
          setAir((prev) => {
            const next = { ...prev };
            for (const c of parsed.data.cells) next[c.key] = c.air;
            return next;
          });
        } catch {
          batch.forEach((k) => requestedAir.current.delete(k));
        }
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [active]);

  /* ---------------- villages, kabupaten and area news for the active set ---------------- */

  useEffect(() => {
    const keys = active.map((h) => cellKey(h.lat, h.lng));
    const timer = window.setTimeout(() => {
      void fetchMissing(keys, requestedPlaceCells.current, 40, async (batch) => {
        const json = await trackedJson<{ ok?: boolean; cells?: { key: string; places: Settlement[] }[] }>(
          "place",
          `/api/places?cells=${encodeURIComponent(batch.join(";"))}`,
          { isOk: (j) => j.ok === true, count: (j) => j.cells?.reduce((n, c) => n + c.places.length, 0) ?? null },
        );
        if (!json.ok || !json.cells) throw new Error("places");
        setPlacesByCell((prev) => ({ ...prev, ...Object.fromEntries(json.cells!.map((c) => [c.key, c.places])) }));
      });
      void fetchMissing(keys, requestedRegions.current, 30, async (batch) => {
        const json = await trackedJson<{
          ok?: boolean;
          regions?: Record<string, Region | null>;
          news?: Record<string, NewsArticle[]>;
        }>("areas", `/api/areas?cells=${encodeURIComponent(batch.join(";"))}`, {
          isOk: (j) => j.ok === true,
          count: (j) => (j.news ? Object.values(j.news).reduce((n, a) => n + a.length, 0) : null),
        });
        if (!json.ok || !json.regions) throw new Error("areas");
        setRegions((prev) => ({ ...prev, ...json.regions }));
        setAreaNews((prev) => ({ ...prev, ...json.news }));
      });
    }, 900);
    return () => window.clearTimeout(timer);
  }, [active]);

  /* ---------------- village + BMKG for the selected fire ---------------- */

  const defaultPick = activeSources[0]?.hotspot.id ?? null;
  const selectedHotspotId = focusId ?? defaultPick;
  const selectedHotspot = useMemo(
    () => allHotspots.find((h) => h.id === selectedHotspotId) ?? null,
    [allHotspots, selectedHotspotId],
  );

  useEffect(() => {
    const h = selectedHotspot;
    if (!h || h.nearestSettlement || requestedPlaces.current.has(h.id)) return;
    requestedPlaces.current.add(h.id);
    void (async () => {
      try {
        const json = await trackedJson<{
          ok?: boolean;
          nearest?: Settlement | null;
          coded?: Settlement | null;
        }>("place", `/api/place?lat=${h.lat}&lng=${h.lng}`, { isOk: (j) => j.ok === true });
        if (!json.ok) throw new Error("place");
        setPlaces((prev) => ({ ...prev, [h.id]: json.nearest ?? null }));
        // An Indonesian village with a Kemendagri code gets its own BMKG forecast
        if (json.coded?.adm4) {
          const w = await trackedJson("bmkg", `/api/weather?adm4=${json.coded.adm4}`);
          const parsed = WeatherApiResponseSchema.safeParse(w);
          if (parsed.success && parsed.data.source === "bmkg") {
            const lok = parsed.data.lokasi;
            setPlaceWeather((prev) => ({
              ...prev,
              [h.id]: {
                source: "bmkg",
                place: lok ? `${lok.desa}, ${lok.kecamatan}` : json.coded!.name,
                telemetry: parsed.data.telemetry,
              },
            }));
          }
        }
      } catch {
        // Lookup is best effort; let a later selection retry it
        requestedPlaces.current.delete(h.id);
      }
    })();
  }, [selectedHotspot]);

  /* ---------------- incidents (engine) ---------------- */

  const computed = useMemo(() => {
    const list: HotspotIncident[] = [];
    const sources: UseIncidentsResult["incidentWeatherSource"] = {};
    let pending = 0;
    for (const { hotspot, source } of activeSources) {
      const w = placeWeather[hotspot.id] ?? cellWeather[cellKey(hotspot.lat, hotspot.lng)];
      if (!w) {
        // No simulation on invented weather: wait for the area forecast
        pending += 1;
        continue;
      }
      const entry = statuses[hotspot.id];
      const village =
        hotspot.nearestSettlement ??
        places[hotspot.id] ??
        nearestWithin(hotspot.lat, hotspot.lng, placesByCell[cellKey(hotspot.lat, hotspot.lng)] ?? [], VILLAGE_MAX_KM);
      list.push(
        buildIncident(
          source,
          w.telemetry,
          village,
          hotspot.effectiveStatus,
          entry && hotspot.effectiveStatus === entry.status ? entry.verifiedBy : undefined,
          entry && hotspot.effectiveStatus === entry.status ? entry.verifiedAt : undefined,
        ),
      );
      // The cell entry itself (stable across renders), read only for its source and place
      sources[hotspot.id] = w;
    }
    // Most urgent first: Indonesia, status, village threat, fire power
    list.sort(
      (a, b) =>
        Number(b.inIndonesia) - Number(a.inIndonesia) ||
        FIRE_STATUS_ORDER.indexOf(a.status) - FIRE_STATUS_ORDER.indexOf(b.status) ||
        THREAT_RANK[a.nearestVillage?.threatLevel ?? "AMAN"] -
          THREAT_RANK[b.nearestVillage?.threatLevel ?? "AMAN"] ||
        b.frpMegawatt - a.frpMegawatt,
    );
    return { incidents: list, incidentWeatherSource: sources, pendingWeather: pending };
  }, [activeSources, cellWeather, placeWeather, places, placesByCell, statuses]);

  // A feed answer that changed no fire keeps the previous array, so nothing downstream re-renders
  const stableIncidents = useRef<HotspotIncident[]>([]);
  if (!sameItems(stableIncidents.current, computed.incidents)) stableIncidents.current = computed.incidents;
  const incidents = stableIncidents.current;

  const { pendingWeather } = computed;
  const stableSources = useRef<UseIncidentsResult["incidentWeatherSource"]>({});
  if (!sameRecord(stableSources.current, computed.incidentWeatherSource)) {
    stableSources.current = computed.incidentWeatherSource;
  }
  const incidentWeatherSource = stableSources.current;

  /* ---------------- WorldPop residents in danger and smoke zones ---------------- */

  useEffect(() => {
    // Spread the lookups over areas: a few fires per 0.5-degree area, so every priority
    // zone gets a headcount instead of the busiest district getting all of them
    // Round-robin: the first pass gives every area its most urgent fire, later passes add more
    const byCell = new Map<string, HotspotIncident[]>();
    for (const i of incidents) {
      if (i.status === "EXTINGUISHED") continue;
      const k = cellKey(i.originLat, i.originLng);
      const list = byCell.get(k) ?? [];
      if (list.length < POPULATION_PER_CELL) list.push(i);
      byCell.set(k, list);
    }
    const top: HotspotIncident[] = [];
    for (let pass = 0; pass < POPULATION_PER_CELL && top.length < POPULATION_LIMIT; pass++) {
      for (const list of byCell.values()) {
        if (list[pass] && top.length < POPULATION_LIMIT) top.push(list[pass]);
      }
    }
    const timer = window.setTimeout(() => {
      void fetchMissing(
        top.map((i) => i.id),
        requestedPopulation.current,
        20,
        async (ids) => {
          const now = new Date();
          const zones = ids.flatMap((id) => {
            const i = top.find((x) => x.id === id);
            if (!i) return [];
            const reachM = stepPolygonFor(i, 12).maxSpreadRadiusM + DANGER_BUFFER_M;
            const danger = circle([i.originLng, i.originLat], reachM / 1000, { steps: 24, units: "kilometers" });
            const smoke = smokePlume(i, now, 0);
            return [
              { id: `${id}|danger`, ring: danger.geometry.coordinates[0] },
              { id: `${id}|smoke`, ring: smoke.geometry.coordinates[0] },
            ];
          });
          const started = performance.now();
          const res = await backgroundSlot(() =>
            fetch("/api/population", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ zones }),
            }),
          );
          const json = (await res.json()) as { ok?: boolean; results?: Record<string, number | null> };
          reportFeed("population", {
            ok: json.ok === true,
            roundTripMs: Math.round(performance.now() - started),
            upstreamMs: Number(res.headers.get("x-upstream-ms")) || null,
            items: json.results ? Object.values(json.results).filter((v) => v !== null).length : null,
            error: json.ok ? null : `HTTP ${res.status}`,
          });
          if (!json.ok || !json.results) throw new Error("population");
          const results = json.results;
          setPopulation((prev) => {
            const next = { ...prev };
            for (const id of ids) {
              next[id] = { danger: results[`${id}|danger`] ?? null, smoke: results[`${id}|smoke`] ?? null };
            }
            return next;
          });
        },
      );
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [incidents]);

  const selectedIncident = useMemo(
    () => incidents.find((i) => i.id === selectedHotspotId) ?? incidents[0] ?? null,
    [incidents, selectedHotspotId],
  );

  const selectIncident = useCallback((id: string) => {
    setFocusId(id);
    publishSync({ type: "incident:select", id });
  }, []);

  const setViewport = useCallback((bbox: Bbox) => {
    setViewportState((prev) =>
      prev.every((v, i) => Math.abs(v - bbox[i]) < 1e-4) ? prev : bbox,
    );
  }, []);

  const satelliteNotice = useMemo(() => {
    if (firms.status === "loading") return null;
    if (firms.status === "error") {
      return `${firms.reason ?? "NASA FIRMS tidak merespons."} Titik api belum bisa ditampilkan.`;
    }
    const indo = Object.values(statusCounts.indonesia).reduce((a, b) => a + b, 0);
    const world = allHotspots.length;
    const okSources = firms.sources.filter((s) => s.ok).map((s) => s.label);
    const history = firms.keyed
      ? "Riwayat 3 hari untuk Indonesia."
      : "MAP_KEY belum diset: hanya data 24 jam, deteksi smoldering terbatas.";
    return `${indo.toLocaleString("id-ID")} kejadian api di Indonesia, ${world.toLocaleString(
      "id-ID",
    )} di seluruh dunia, dari ${firms.detections.toLocaleString("id-ID")} piksel ${okSources.join(
      ", ",
    )}. ${history}`;
  }, [firms, allHotspots.length, statusCounts]);

  return {
    incidents,
    hotspots,
    air,
    filter,
    setFilter,
    viewStats,
    population,
    regions,
    areaNews,
    statusCounts,
    pendingWeather,
    overflow,
    weather,
    weatherSource,
    incidentWeatherSource,
    maritime,
    weatherError,
    weatherLoading,
    selectedId: selectedIncident?.id ?? null,
    focusId,
    selectIncident,
    selectedIncident,
    refreshWeather: loadWeather,
    setViewport,
    firms,
    satelliteNotice,
  };
}
