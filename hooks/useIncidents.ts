"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_ADM4,
  FirmsApiResponseSchema,
  MaritimeApiResponseSchema,
  toFireStatus,
  WeatherApiResponseSchema,
  type FireStatus,
  type FirePoint,
  type HotspotIncident,
  type WeatherSource,
  type WeatherTelemetry,
} from "@/lib/gambut";
import { fallbackWeather, firePointToSource, type HotspotSource } from "@/data/hotspotSource";
import {
  computeFirebreak,
  computeNearestVillage,
  simulateSpread,
} from "@/lib/simulationEngine";
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

type StatusMap = Record<string, { status: FireStatus; verifiedBy?: string; verifiedAt?: string }>;

type IncidentGeometry = Pick<
  HotspotIncident,
  "nowcastPolygon" | "forecastPolygons" | "firebreak" | "nearestVillage"
>;

// Polygons only depend on the source hotspot and the weather, not on the
// verification status, so a status change (HUD button) reuses them.
const geometryCache = new WeakMap<
  HotspotSource,
  { weather: WeatherTelemetry; geometry: IncidentGeometry }
>();

function incidentGeometry(source: HotspotSource, weather: WeatherTelemetry): IncidentGeometry {
  const cached = geometryCache.get(source);
  if (cached && cached.weather === weather) return cached.geometry;

  const now = new Date();
  const simInput = {
    originLat: source.originLat,
    originLng: source.originLng,
    satelliteAcquisitionTime: source.satelliteAcquisitionTime,
    weather,
    peatlandInfo: source.peatlandInfo,
  };
  const sim = simulateSpread(simInput, now);
  const firebreak = computeFirebreak(simInput, now);
  const nearestVillage = computeNearestVillage(
    source.originLat,
    source.originLng,
    weather.windDirectionDeg,
    now,
    source.satelliteAcquisitionTime,
    source.peatlandInfo,
    weather,
    sim.headRate,
  );

  const geometry: IncidentGeometry = {
    nowcastPolygon: sim.nowcastPolygon,
    forecastPolygons: sim.forecastPolygons,
    firebreak,
    nearestVillage,
  };
  geometryCache.set(source, { weather, geometry });
  return geometry;
}

function buildIncident(
  source: HotspotSource,
  weather: WeatherTelemetry,
  status: FireStatus,
  verifiedBy?: string,
  verifiedAt?: string,
): HotspotIncident {
  return {
    ...source,
    status,
    weather,
    ...incidentGeometry(source, weather),
    lastVerifiedBy: verifiedBy,
    lastVerifiedAt: verifiedAt,
  };
}

export interface UseIncidentsResult {
  incidents: HotspotIncident[];
  weather: WeatherTelemetry | null;
  /** Provider that supplied `weather` (attribution is required for both). */
  weatherSource: WeatherSource | null;
  maritime: MaritimeConditions | null;
  weatherError: string | null;
  weatherLoading: boolean;
  selectedId: string | null;
  selectIncident: (id: string) => void;
  selectedIncident: HotspotIncident | null;
  refreshWeather: () => void;
  satelliteNotice: string | null;
  /** NASA FIRMS live fire detections (empty when key missing or no fires). */
  firePoints: FirePoint[];
  /** True when MAP_KEY is set and FIRMS replied with detections. */
  firmsLive: boolean;
  /** True until the first FIRMS response lands (distinguishes loading from empty). */
  firmsLoading: boolean;
}

export function useIncidents(): UseIncidentsResult {
  const [statuses, setStatuses] = useState<StatusMap>({});
  const [weather, setWeather] = useState<WeatherTelemetry | null>(null);
  const [weatherSource, setWeatherSource] = useState<WeatherSource | null>(null);
  const [maritime, setMaritime] = useState<MaritimeConditions | null>(null);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [satelliteNotice, setSatelliteNotice] = useState<string | null>(null);
  const [firePoints, setFirePoints] = useState<FirePoint[]>([]);
  const [firmsConfigured, setFirmsConfigured] = useState(false);
  const [firmsLoading, setFirmsLoading] = useState(true);
  const hydrated = useRef(false);

  // Mirror state in refs so the FIRMS loader always sees fresh values
  const firePointsRef = useRef(firePoints);
  firePointsRef.current = firePoints;

  /* ---------------- weather (Open-Meteo, BMKG fallback) ---------------- */

  const loadWeather = useCallback(async () => {
    setWeatherLoading(true);
    try {
      const res = await fetch(`/api/weather?adm4=${DEFAULT_ADM4}`, { cache: "no-store" });
      const json: unknown = await res.json();
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
      const res = await fetch("/api/maritime", { cache: "no-store" });
      const json: unknown = await res.json();
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

  /* ---------------- NASA FIRMS hotspots ---------------- */

  const loadFirms = useCallback(async () => {
    try {
      const res = await fetch("/api/firms", { cache: "no-store" });
      const json: unknown = await res.json();
      const parsed = FirmsApiResponseSchema.safeParse(json);
      if (!parsed.success) return;
      const failed =
        parsed.data.configured && parsed.data.fires.length === 0 && Boolean(parsed.data.reason);
      // A failed refresh keeps the detections (and notice) already on screen
      if (failed && firePointsRef.current.length > 0) return;
      setFirmsConfigured(parsed.data.configured);
      setFirePoints(parsed.data.fires);
      if (parsed.data.configured && parsed.data.fires.length > 0) {
        setSatelliteNotice(
          `${parsed.data.fires.length} titik api terdeteksi NASA FIRMS (VIIRS near-real-time) di area KHG.`,
        );
      } else if (parsed.data.configured && parsed.data.reason) {
        setSatelliteNotice(
          `${parsed.data.reason} Titik api tidak bisa ditampilkan sampai koneksi satelit normal kembali.`,
        );
      } else if (parsed.data.configured) {
        setSatelliteNotice(
          `NASA FIRMS tidak mendeteksi hotspot di area KHG dalam 3 hari terakhir.`,
        );
      } else {
        setSatelliteNotice(
          `MAP_KEY NASA FIRMS belum diset, data titik api satelit tidak tersedia. Daftar gratis di https://firms.modaps.eosdis.nasa.gov/api/`,
        );
      }
    } catch {
      // FIRMS is supplementary; keep the detections already on screen
    } finally {
      setFirmsLoading(false);
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
    // VIIRS passes arrive a few times a day; the proxy caches for 15 minutes
    const firmsTimer = window.setInterval(() => void loadFirms(), 15 * 60_000);
    return () => {
      window.clearInterval(weatherTimer);
      window.clearInterval(firmsTimer);
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
        setSelectedId(msg.id);
      } else if (msg.type === "weather:telemetry") {
        setWeather(msg.telemetry);
      }
    });
  }, []);

  /* ---------------- incidents (engine) ---------------- */

  const sources = useMemo(
    () => firePoints.map(firePointToSource),
    [firePoints],
  );

  const incidents = useMemo(() => {
    return sources.map((source) => {
      const entry = statuses[source.id];
      const effectiveWeather = weather ?? fallbackWeather();
      return buildIncident(
        source,
        effectiveWeather,
        entry?.status ?? source.status,
        entry?.verifiedBy,
        entry?.verifiedAt,
      );
    });
  }, [sources, statuses, weather]);

  const selectedIncident = useMemo(
    () => incidents.find((i) => i.id === selectedId) ?? incidents[0] ?? null,
    [incidents, selectedId],
  );

  const selectIncident = useCallback((id: string) => {
    setSelectedId(id);
    publishSync({ type: "incident:select", id });
  }, []);

  return {
    incidents,
    weather,
    weatherSource,
    maritime,
    weatherError,
    weatherLoading,
    selectedId: selectedIncident?.id ?? null,
    selectIncident,
    selectedIncident,
    refreshWeather: loadWeather,
    satelliteNotice,
    firePoints,
    firmsLive: firmsConfigured && sources.length > 0,
    firmsLoading,
  };
}
