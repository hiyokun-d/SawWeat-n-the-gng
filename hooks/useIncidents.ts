"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { destination, point } from "@turf/turf";
import {
  DEFAULT_ADM4,
  FIRMS_ATTRIBUTION,
  FirmsApiResponseSchema,
  MaritimeApiResponseSchema,
  toFireStatus,
  WeatherApiResponseSchema,
  type FireStatus,
  type FirePoint,
  type HotspotIncident,
  type WeatherTelemetry,
} from "@/lib/gambut";
import {
  FIRST_SEED_ID,
  createSeedIncidents,
  fallbackWeather,
  firePointToSeed,
  type SeedIncident,
} from "@/data/seedIncidents";
import {
  computeFirebreak,
  computeNearestVillage,
  mergeBurnPolygons,
  polygonAreaHa,
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

function buildIncident(
  seed: SeedIncident,
  weather: WeatherTelemetry,
  status: FireStatus,
  verifiedBy?: string,
  verifiedAt?: string,
): HotspotIncident {
  const simInput = {
    originLat: seed.originLat,
    originLng: seed.originLng,
    satelliteAcquisitionTime: seed.satelliteAcquisitionTime,
    weather,
    peatlandInfo: seed.peatlandInfo,
  };
  const sim = simulateSpread(simInput);

  // Re-anchored polygon from a satellite-update demo (scenario 1)
  const nowcast = seed.mergedNowcast
    ? {
        ...sim.nowcastPolygon,
        geojsonPolygon: seed.mergedNowcast,
        burnedAreaHa: polygonAreaHa(seed.mergedNowcast),
      }
    : sim.nowcastPolygon;

  // Widened buffer pushes the firebreak farther ahead after re-anchoring
  const firebreak = computeFirebreak(simInput, new Date(), seed.mergedNowcast ? { bufferM: 300 } : undefined);

  const nearestVillage = computeNearestVillage(
    seed.originLat,
    seed.originLng,
    weather.windDirectionDeg,
    new Date(),
    seed.satelliteAcquisitionTime,
    seed.peatlandInfo,
    weather,
  );

  return {
    ...seed,
    status,
    weather,
    nowcastPolygon: nowcast,
    forecastPolygons: sim.forecastPolygons,
    firebreak,
    nearestVillage,
    lastVerifiedBy: verifiedBy,
    lastVerifiedAt: verifiedAt,
  };
}

export interface UseIncidentsResult {
  incidents: HotspotIncident[];
  weather: WeatherTelemetry | null;
  maritime: MaritimeConditions | null;
  weatherError: string | null;
  weatherLoading: boolean;
  selectedId: string | null;
  selectIncident: (id: string) => void;
  selectedIncident: HotspotIncident | null;
  refreshWeather: () => void;
  simulateNewHotspot: () => void;
  simulateHotspotLost: () => void;
  satelliteNotice: string | null;
  /** NASA FIRMS live fire detections (empty when key missing or no fires). */
  firePoints: FirePoint[];
  /** True when MAP_KEY is set and FIRMS replied. */
  firmsLive: boolean;
}

export function useIncidents(): UseIncidentsResult {
  // Seeds load in a mount effect: timestamps must not run during prerender
  const [seeds, setSeeds] = useState<SeedIncident[]>([]);
  const [statuses, setStatuses] = useState<StatusMap>({});
  const [weather, setWeather] = useState<WeatherTelemetry | null>(null);
  const [maritime, setMaritime] = useState<MaritimeConditions | null>(null);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string>(FIRST_SEED_ID);
  const [satelliteNotice, setSatelliteNotice] = useState<string | null>(null);
  const [firePoints, setFirePoints] = useState<FirePoint[]>([]);
  const [firmsConfigured, setFirmsConfigured] = useState(false);
  const hydrated = useRef(false);

  // Mirror state in refs so demo handlers always see fresh values
  const seedsRef = useRef(seeds);
  seedsRef.current = seeds;
  const weatherRef = useRef(weather);
  weatherRef.current = weather;

  useEffect(() => {
    setSeeds(createSeedIncidents());
  }, []);

  /* ---------------- weather (BMKG prakiraan-cuaca) ---------------- */

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
            : "Respons cuaca BMKG tidak dikenali";
        setWeatherError(errorMessage);
        return;
      }
      setWeather(parsed.data.telemetry);
      setWeatherError(null);
      publishSync({ type: "weather:telemetry", telemetry: parsed.data.telemetry });
    } catch (err) {
      setWeatherError(err instanceof Error ? err.message : "Gagal memuat cuaca BMKG");
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
      setFirmsConfigured(parsed.data.configured);
      setFirePoints(parsed.data.fires);
      if (parsed.data.configured && parsed.data.fires.length > 0) {
        setSatelliteNotice(
          `${parsed.data.fires.length} titik api terdeteksi NASA FIRMS (VIIRS near-real-time) di area KHG. Skenario simulasi dimatikan.`,
        );
      } else if (parsed.data.configured) {
        setSatelliteNotice(
          `NASA FIRMS tidak mendeteksi hotspot di area KHG dalam 3 hari terakhir. Menampilkan skenario simulasi (${FIRMS_ATTRIBUTION}).`,
        );
      } else {
        setSatelliteNotice(
          `MAP_KEY NASA FIRMS belum diset; menampilkan skenario simulasi. Daftar gratis di https://firms.modaps.eosdis.nasa.gov/api/`,
        );
      }
    } catch {
      // FIRMS is supplementary; keep the seed scenario on failure
    }
  }, []);

  useEffect(() => {
    void loadWeather();
    void loadMaritime();
    void loadFirms();
    const interval = window.setInterval(() => {
      void loadWeather();
      void loadMaritime();
    }, 5 * 60_000);
    return () => window.clearInterval(interval);
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

  // Real FIRMS detections take priority; seed scenario is the fallback
  const realSeeds = useMemo(
    () => firePoints.map(firePointToSeed),
    [firePoints],
  );
  const usingFirms = firmsConfigured && realSeeds.length > 0;
  const effectiveSeeds = usingFirms ? realSeeds : seeds;

  const incidents = useMemo(() => {
    return effectiveSeeds.map((seed) => {
      const entry = statuses[seed.id];
      const effectiveWeather = weather ?? seed.fallbackWeather;
      return buildIncident(
        seed,
        effectiveWeather,
        entry?.status ?? seed.status,
        entry?.verifiedBy,
        entry?.verifiedAt,
      );
    });
  }, [effectiveSeeds, statuses, weather]);

  const selectedIncident = useMemo(
    () => incidents.find((i) => i.id === selectedId) ?? incidents[0] ?? null,
    [incidents, selectedId],
  );

  const selectIncident = useCallback((id: string) => {
    setSelectedId(id);
    publishSync({ type: "incident:select", id });
  }, []);

  /* ---------------- satellite update simulations ---------------- */

  const simulateNewHotspot = useCallback(() => {
    const prev = seedsRef.current;
    const anchor = prev.find((s) => s.id === selectedId) ?? prev[0];
    const anchorWeather = weatherRef.current ?? anchor.fallbackWeather;

    const anchorSim = simulateSpread({
      originLat: anchor.originLat,
      originLng: anchor.originLng,
      satelliteAcquisitionTime: anchor.satelliteAcquisitionTime,
      weather: anchorWeather,
      peatlandInfo: anchor.peatlandInfo,
    });

    // New hotspot outside the current prediction polygon: 500 m beyond the
    // max spread radius, 120 degrees off the wind push axis.
    const bearing = (anchorWeather.windVectorDeg + 120) % 360;
    const km = (anchorSim.nowcastPolygon.maxSpreadRadiusM + 500) / 1000;
    const pt = destination(point([anchor.originLng, anchor.originLat]), km, bearing, {
      units: "kilometers",
    });
    const [lng, lat] = pt.geometry.coordinates;

    const newSeed: SeedIncident = {
      id: `GW-KHR-${String(prev.length + 1).padStart(3, "0")}`,
      originLat: lat,
      originLng: lng,
      satelliteAcquisitionTime: new Date().toISOString(),
      systemReceivedTime: new Date().toISOString(),
      frpMegawatt: 55.4,
      confidence: "high",
      status: "UNVERIFIED_HOTSPOT",
      peatlandInfo: anchor.peatlandInfo,
      fallbackWeather: anchorWeather,
    };

    const newSim = simulateSpread({
      originLat: newSeed.originLat,
      originLng: newSeed.originLng,
      satelliteAcquisitionTime: newSeed.satelliteAcquisitionTime,
      weather: anchorWeather,
      peatlandInfo: newSeed.peatlandInfo,
    });

    // Re-anchor: union the fresh burn polygon into the selected incident
    const merged = mergeBurnPolygons(
      anchorSim.nowcastPolygon.geojsonPolygon,
      newSim.nowcastPolygon.geojsonPolygon,
    );

    setSeeds([
      ...prev.map((s) => (s.id === anchor.id ? { ...s, mergedNowcast: merged } : s)),
      newSeed,
    ]);
    publishSync({ type: "incident:satellite-update", kind: "new-hotspot" });
    setSatelliteNotice(
      `UPDATE SATELIT: hotspot baru ${newSeed.id} di luar poligon prediksi. Poligon digabung, garis sekat bakar digeser ke depan.`,
    );
  }, [selectedId]);

  const simulateHotspotLost = useCallback(() => {
    const target = incidents.find(
      (i) => i.status === "CONFIRMED_FLAMING" || i.status === "UNVERIFIED_HOTSPOT",
    );
    if (!target) {
      setSatelliteNotice("Tidak ada hotspot aktif yang bisa hilang dari satelit.");
      return;
    }
    setStatuses((prev) => ({
      ...prev,
      [target.id]: { status: "SUSPECTED_SMOLDERING" },
    }));
    publishSync({
      type: "incident:status",
      id: target.id,
      status: "SUSPECTED_SMOLDERING",
      verifiedBy: "Sistem (smoldering blindness)",
      verifiedAt: new Date().toISOString(),
    });
    setSelectedId(target.id);
    setSatelliteNotice(
      `UPDATE SATELIT: hotspot ${target.id} hilang dari jangkauan sensor (tertutup tanah/asap). Status diubah menjadi SUSPECTED_SMOLDERING, permintaan verifikasi dikirim ke HUD MPA.`,
    );
  }, [incidents]);

  return {
    incidents,
    weather,
    maritime,
    weatherError,
    weatherLoading,
    selectedId: selectedIncident?.id ?? null,
    selectIncident,
    selectedIncident,
    refreshWeather: loadWeather,
    simulateNewHotspot,
    simulateHotspotLost,
    satelliteNotice,
    firePoints,
    firmsLive: usingFirms,
  };
}
