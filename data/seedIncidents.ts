/**
 * Seed incidents: 4 realistic Kubu Raya peatland fire points (prd.md).
 *
 * Mandatory hackathon fallback: when the live satellite feed is empty
 * (e.g. rain over Kalimantan), the app still loads this crisis scenario
 * and combines it with live BMKG weather. Coordinates sit inside the
 * KHG Sungai Kapuas - Sungai Ambawang polygon, near the Rasau Jaya
 * villages with real BMKG coordinates.
 *
 * Created via factory (not a module constant) so `new Date()` is only
 * evaluated in the browser, never during prerender.
 */

import type { FireStatus, FirePoint, HotspotIncident, PeatlandZone, WeatherTelemetry } from "../lib/gambut";

/** Everything except the parts computed at runtime by the simulation engine. */
export type SeedIncident = Omit<
  HotspotIncident,
  "nowcastPolygon" | "forecastPolygons" | "firebreak" | "nearestVillage" | "weather"
> & {
  fallbackWeather: WeatherTelemetry;
  /** Set when a satellite-update demo re-anchors a merged burn polygon here. */
  mergedNowcast?: GeoJSON.Feature<GeoJSON.Polygon>;
};

export const FIRST_SEED_ID = "GW-KHR-001";

export const PEATLAND_ZONES: Record<string, PeatlandZone> = {
  "KHG-RASU": {
    khgId: "KHG-RASU",
    name: "KHG Rasau Jaya",
    depthCategory: "SEDANG (1-3m)",
    baseSpreadRateR0: 18,
  },
  "KHG-SKA-SAW": {
    khgId: "KHG-SKA-SAW",
    name: "KHG Sungai Kapuas - Sungai Ambawang",
    depthCategory: "DALAM (>3m)",
    baseSpreadRateR0: 28,
  },
  "KHG-KAKAP": {
    khgId: "KHG-KAKAP",
    name: "KHG Sungai Kakap",
    depthCategory: "DANGKAL (<1m)",
    baseSpreadRateR0: 12,
  },
};

/** Typical Kubu Raya dry-season conditions used until live BMKG data lands. */
export function fallbackWeather(): WeatherTelemetry {
  return {
    windSpeedKmh: 15,
    windDirectionDeg: 270,
    windVectorDeg: 90,
    relativeHumidity: 65,
    temperatureC: 31,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Convert a real NASA FIRMS detection into a seed incident so the simulation
 * engine can run on it exactly like the fallback scenario.
 * High-confidence VIIRS detections are treated as confirmed surface fires;
 * nominal/low detections start unverified until a field team checks them.
 */
export function firePointToSeed(fire: FirePoint, index: number): SeedIncident {
  return {
    id: `FIRMS-${String(index + 1).padStart(3, "0")}`,
    originLat: fire.lat,
    originLng: fire.lng,
    satelliteAcquisitionTime: fire.acquiredAt,
    systemReceivedTime: new Date().toISOString(),
    frpMegawatt: fire.frpMegawatt,
    confidence: fire.confidence,
    status: fire.confidence === "high" ? "CONFIRMED_FLAMING" : "UNVERIFIED_HOTSPOT",
    peatlandInfo: PEATLAND_ZONES["KHG-SKA-SAW"],
    fallbackWeather: fallbackWeather(),
  };
}

function seedIncident(
  id: string,
  originLat: number,
  originLng: number,
  frpMegawatt: number,
  confidence: HotspotIncident["confidence"],
  status: FireStatus,
  zoneKey: keyof typeof PEATLAND_ZONES,
): SeedIncident {
  return {
    id,
    originLat,
    originLng,
    satelliteAcquisitionTime: new Date(Date.now() - 3 * 3600_000).toISOString(),
    systemReceivedTime: new Date().toISOString(),
    frpMegawatt,
    confidence,
    status,
    peatlandInfo: PEATLAND_ZONES[zoneKey],
    fallbackWeather: fallbackWeather(),
  };
}

/**
 * Build the seed crisis scenario. Called from a mount effect so timestamps
 * are fresh on every visit without touching the prerender phase.
 */
export function createSeedIncidents(): SeedIncident[] {
  return [
    // 1. New hotspot east of Rasau Jaya Umum, deep degraded peat
    seedIncident(
      "GW-KHR-001",
      -0.236,
      109.4035,
      42.5,
      "high",
      "UNVERIFIED_HOTSPOT",
      "KHG-SKA-SAW",
    ),
    // 2. Active surface fire south of Rasau Jaya Dua, medium peat
    seedIncident(
      "GW-KHR-002",
      -0.2812,
      109.4128,
      78.3,
      "high",
      "CONFIRMED_FLAMING",
      "KHG-RASU",
    ),
    // 3. Hotspot vanished from satellite near Bintang Mas: smoldering blindness
    seedIncident(
      "GW-KHR-003",
      -0.2548,
      109.2905,
      15.2,
      "nominal",
      "SUSPECTED_SMOLDERING",
      "KHG-KAKAP",
    ),
    // 4. Underground embers confirmed by MPA near Pematang Tujuh
    seedIncident(
      "GW-KHR-004",
      -0.2316,
      109.2705,
      26.8,
      "nominal",
      "CONFIRMED_SMOLDERING",
      "KHG-RASU",
    ),
  ];
}
