/**
 * Hotspot source data: the input the simulation engine runs on.
 *
 * Satellite-only data model: sources are real NASA FIRMS VIIRS detections
 * converted by `firePointToSource`, anchored to the KHG peatland zones and
 * the Rasau Jaya villages with real BMKG coordinates. Every geometry
 * (nowcast, forecast, firebreak, village threat) is computed at runtime by
 * the engine from a source plus the live BMKG weather.
 *
 * `fallbackWeather()` covers the window between a FIRMS detection landing
 * and live BMKG weather arriving.
 *
 * Timestamps come from factories, never module constants, so `new Date()`
 * never runs during prerender.
 */

import type { FirePoint, HotspotIncident, PeatlandZone, WeatherTelemetry } from "../lib/gambut";

/** Everything except the parts computed at runtime by the simulation engine. */
export type HotspotSource = Omit<
  HotspotIncident,
  "nowcastPolygon" | "forecastPolygons" | "firebreak" | "nearestVillage" | "weather"
>;

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
 * Convert a NASA FIRMS detection into a hotspot source so the simulation
 * engine can run on it. High-confidence VIIRS detections are treated as
 * confirmed surface fires; nominal/low detections start unverified until a
 * field team checks them. Detections are anchored to KHG Sungai Kapuas -
 * Sungai Ambawang, the deepest peat zone that spans the query bbox.
 */
export function firePointToSource(fire: FirePoint, index: number): HotspotSource {
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
  };
}
