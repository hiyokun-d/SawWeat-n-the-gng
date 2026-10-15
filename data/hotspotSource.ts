/**
 * Hotspot source data: the input the simulation engine runs on.
 *
 * Every source is a real NASA FIRMS fire event (pixels from all satellites
 * fused by lib/firms.ts). Every geometry (nowcast, forecast, firebreak,
 * village threat) is computed at runtime by the engine from a source plus
 * live BMKG / Open-Meteo weather for its area. There is no seed data.
 */

import type { FusedHotspot, HotspotIncident, PeatlandZone } from "../lib/gambut";

/** Everything except the parts computed at runtime by the simulation engine. */
export type HotspotSource = Omit<
  HotspotIncident,
  "nowcastPolygon" | "forecastPolygons" | "firebreak" | "nearestVillage" | "weather"
>;

export const PEATLAND_ZONES = {
  KHG: {
    khgId: "KHG-SKA-SAW",
    name: "KHG Sungai Kapuas - Sungai Ambawang",
    depthCategory: "DALAM (>3m)",
    baseSpreadRateR0: 28,
  },
  // No peat-depth map is loaded for the rest of the world, so these use the
  // slowest prd.md rate rather than claiming a depth
  INDONESIA: {
    khgId: "ID-UNMAPPED",
    name: "Indonesia, kedalaman gambut belum terpetakan",
    depthCategory: "TIDAK TERPETAKAN",
    baseSpreadRateR0: 12,
  },
  WORLD: {
    khgId: "WORLD",
    name: "Di luar Indonesia",
    depthCategory: "TIDAK TERPETAKAN",
    baseSpreadRateR0: 12,
  },
} satisfies Record<string, PeatlandZone>;

export function hotspotToSource(h: FusedHotspot, receivedAt: string): HotspotSource {
  return {
    id: h.id,
    originLat: h.lat,
    originLng: h.lng,
    satelliteAcquisitionTime: h.lastSeen,
    systemReceivedTime: receivedAt,
    frpMegawatt: h.maxFrpMegawatt,
    confidence: h.confidence,
    status: h.status,
    peatlandInfo: h.insideKhg
      ? PEATLAND_ZONES.KHG
      : h.inIndonesia
        ? PEATLAND_ZONES.INDONESIA
        : PEATLAND_ZONES.WORLD,
    satellites: h.satellites,
    detectionCount: h.detectionCount,
    firstDetectedAt: h.firstSeen,
    inIndonesia: h.inIndonesia,
  };
}
