/**
 * GambutWatch data contract.
 * Mirrors the TypeScript interfaces defined in prd.md so the frontend,
 * the simulation engine, and the BMKG API routes share one source of truth.
 */

export type FireStatus =
  | "UNVERIFIED_HOTSPOT"
  | "CONFIRMED_FLAMING"
  | "SUSPECTED_SMOLDERING"
  | "CONFIRMED_SMOLDERING"
  | "EXTINGUISHED";

export type ThreatLevel = "AMAN" | "WASPADA" | "SIAGA" | "BAHAYA";

export interface WeatherTelemetry {
  windSpeedKmh: number;
  windDirectionDeg: number;
  windVectorDeg: number;
  relativeHumidity: number;
  temperatureC: number;
  updatedAt: string;
}

export interface PeatlandZone {
  khgId: string;
  name: string;
  depthCategory: "DANGKAL (<1m)" | "SEDANG (1-3m)" | "DALAM (>3m)";
  baseSpreadRateR0: number;
}

export interface TimeStepPolygon {
  hourOffset: number;
  timestamp: string;
  geojsonPolygon: GeoJSON.Feature<GeoJSON.Polygon>;
  burnedAreaHa: number;
  maxSpreadRadiusM: number;
}

export interface FirebreakRecommendation {
  targetHourOffset: number;
  coordinates: [number, number][];
  lengthMeters: number;
  safetyBufferMeters: number;
  etaFireArrivalMinutes: number;
  tacticalNotes: string;
}

export interface HotspotIncident {
  id: string;
  originLat: number;
  originLng: number;
  satelliteAcquisitionTime: string;
  systemReceivedTime: string;
  frpMegawatt: number;
  confidence: "low" | "nominal" | "high";
  status: FireStatus;
  peatlandInfo: PeatlandZone;
  weather: WeatherTelemetry;
  nowcastPolygon: TimeStepPolygon;
  forecastPolygons: TimeStepPolygon[];
  firebreak: FirebreakRecommendation;
  nearestVillage: {
    name: string;
    lat: number;
    lng: number;
    distanceMeters: number;
    threatLevel: ThreatLevel;
    safeEvacuationBearingDeg: number;
  };
  lastVerifiedBy?: string;
  lastVerifiedAt?: string;
}

/* ------------------------------------------------------------------ */
/* BMKG integration constants                                          */
/* ------------------------------------------------------------------ */

/** Kabupaten Kubu Raya, Kecamatan Rasau Jaya (Kemendagri 61.12.07). */
export interface BmkgVillage {
  adm4: string;
  name: string;
  lat: number;
  lng: number;
}

export const BmkgVillages: BmkgVillage[] = [
  { adm4: "61.12.07.2001", name: "Rasau Jaya Umum", lat: -0.2429026383, lng: 109.3838286841 },
  { adm4: "61.12.07.2002", name: "Rasau Jaya Satu", lat: -0.2513048205, lng: 109.3817639209 },
  { adm4: "61.12.07.2003", name: "Rasau Jaya Dua", lat: -0.2732142839, lng: 109.4013227516 },
  { adm4: "61.12.07.2004", name: "Rasau Jaya Tiga", lat: -0.2371158361, lng: 109.3455728058 },
  { adm4: "61.12.07.2005", name: "Bintang Mas", lat: -0.2511184439, lng: 109.2951422014 },
  { adm4: "61.12.07.2006", name: "Pematang Tujuh", lat: -0.2281124133, lng: 109.2760432196 },
];

export interface FirePoint {
  id: string;
  lat: number;
  lng: number;
  /** Fire radiative power in megawatts. */
  frpMegawatt: number;
  confidence: "low" | "nominal" | "high";
  /** Detection time, ISO UTC (FIRMS acquisition date + time). */
  acquiredAt: string;
  satellite: string;
  daynight: "D" | "N";
}

/**
 * Bounding box (west, south, east, north) around the KHG Sungai Kapuas -
 * Sungai Ambawang peat dome and the six Rasau Jaya villages, used for the
 * FIRMS area query. Wider than the KHG polygon so border fires are caught.
 */
export const FIRMS_BBOX = [109.15, -0.35, 109.55, -0.12] as const;

/** FIRMS near-real-time satellite sources, queried in order and merged. */
export const FIRMS_SOURCES = ["VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT"] as const;

/** NASA FIRMS requires attribution on every surface that shows their data. */
export const FIRMS_ATTRIBUTION =
  "Data hotspot: NASA FIRMS (Fire Information for Resource Management System)";

/** Default weather source: Desa Rasau Jaya Umum (Kec. Rasau Jaya, Kab. Kubu Raya). */
export const DEFAULT_ADM4 = "61.12.07.2001";

/* ------------------------------------------------------------------ */
/* API response schemas (zod)                                         */
/* ------------------------------------------------------------------ */

/** Response of GET /api/firms (NASA FIRMS area proxy). */
export const FirmsApiResponseSchema = z.object({
  configured: z.boolean(),
  fires: z.array(
    z.object({
      id: z.string(),
      lat: z.number(),
      lng: z.number(),
      frpMegawatt: z.number(),
      confidence: z.enum(["low", "nominal", "high"]),
      acquiredAt: z.string(),
      satellite: z.string(),
      daynight: z.enum(["D", "N"]),
    }),
  ),
  attribution: z.string().nullish(),
  reason: z.string().nullish(),
  fetchedAt: z.string().nullish(),
});

/** Maritime area code for Perairan Kubu Raya from maritim.bmkg.go.id meta/area_province.json. */
export const KUBU_RAYA_MARINE_CODE = "P.V.04";

export const SECTOR_NAME = "Kab. Kubu Raya, Kalimantan Barat";

/** BMKG requires attribution on every surface that shows their data. */
export const BMKG_ATTRIBUTION = "Sumber data: BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)";

/* ------------------------------------------------------------------ */
/* BMKG response schemas (zod)                                         */
/* ------------------------------------------------------------------ */

import { z } from "zod";

export const BmkgLocationSchema = z.object({
  adm1: z.string(),
  adm2: z.string(),
  adm3: z.string(),
  adm4: z.string(),
  provinsi: z.string(),
  kotkab: z.string(),
  kecamatan: z.string(),
  desa: z.string(),
  lon: z.number(),
  lat: z.number(),
  timezone: z.string(),
});

export const BmkgForecastEntrySchema = z.object({
  utc_datetime: z.string(),
  local_datetime: z.string(),
  t: z.number(),
  hu: z.number(),
  ws: z.number(),
  wd_deg: z.number(),
  wd: z.string(),
  weather_desc: z.string(),
  weather_desc_en: z.string(),
  analysis_date: z.string(),
});

export const BmkgWeatherResponseSchema = z.object({
  lokasi: BmkgLocationSchema,
  data: z.array(
    z.object({
      lokasi: BmkgLocationSchema.optional(),
      cuaca: z.array(z.array(BmkgForecastEntrySchema)),
    }),
  ),
});

export type BmkgWeatherResponse = z.infer<typeof BmkgWeatherResponseSchema>;
export type BmkgForecastEntry = z.infer<typeof BmkgForecastEntrySchema>;

export const BmkgMarineEntrySchema = z.object({
  time: z.string(),
  weather: z.string(),
  temp_avg: z.number(),
  rh_avg: z.number(),
  wind_from: z.string(),
  wind_speed: z.number(),
  wind_gust: z.number().nullish(),
  wave_cat: z.string().nullish(),
  wave_height: z.number().nullish(),
  current_to: z.string().nullish(),
  current_speed: z.number().nullish(),
});

export const BmkgMarineResponseSchema = z.object({
  code: z.string(),
  name: z.string(),
  issued: z.string(),
  valid_from: z.string(),
  valid_to: z.string(),
  forecast_day1: z.array(BmkgMarineEntrySchema).nullish(),
  "forecast_day2-4": z.array(BmkgMarineEntrySchema).nullish(),
});

export type BmkgMarineResponse = z.infer<typeof BmkgMarineResponseSchema>;
export type BmkgMarineEntry = z.infer<typeof BmkgMarineEntrySchema>;

/* ------------------------------------------------------------------ */
/* API response contracts (shared with the API routes)                 */
/* ------------------------------------------------------------------ */

export const WeatherTelemetrySchema = z.object({
  windSpeedKmh: z.number(),
  windDirectionDeg: z.number(),
  windVectorDeg: z.number(),
  relativeHumidity: z.number(),
  temperatureC: z.number(),
  updatedAt: z.string(),
});

export const WEATHER_SOURCES = ["open-meteo", "bmkg", "fallback"] as const;
export type WeatherSource = (typeof WEATHER_SOURCES)[number];

export const WeatherApiResponseSchema = z.object({
  ok: z.literal(true),
  // Only BMKG returns an administrative location block
  lokasi: BmkgLocationSchema.nullish(),
  telemetry: WeatherTelemetrySchema,
  source: z.enum(WEATHER_SOURCES),
});

export const MaritimeApiResponseSchema = z.object({
  ok: z.literal(true),
  code: z.string(),
  name: z.string(),
  current: z.object({
    weather: z.string(),
    windSpeedKmh: z.number(),
    windFrom: z.string(),
    waveCategory: z.string().nullish(),
    waveHeightM: z.number().nullish(),
    windVectorDeg: z.number(),
  }),
});

/** Runtime narrowing of a sync/storage status string to FireStatus (no casts). */
export function toFireStatus(value: string): FireStatus | null {
  switch (value) {
    case "UNVERIFIED_HOTSPOT":
    case "CONFIRMED_FLAMING":
    case "SUSPECTED_SMOLDERING":
    case "CONFIRMED_SMOLDERING":
    case "EXTINGUISHED":
      return value;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

const COMPASS_16 = [
  "Utara",
  "Utara Timur Laut",
  "Timur Laut",
  "Timur Timur Laut",
  "Timur",
  "Timur Tenggara",
  "Tenggara",
  "Selatan Tenggara",
  "Selatan",
  "Selatan Barat Daya",
  "Barat Daya",
  "Barat Barat Daya",
  "Barat",
  "Barat Barat Laut",
  "Barat Laut",
  "Utara Barat Laut",
] as const;

/** Indonesian maritime direction name ("Timur Laut") to degrees the wind comes FROM. */
const WIND_FROM_DEG: Record<string, number> = {
  Utara: 0,
  "Utara Timur Laut": 22.5,
  "Timur Laut": 45,
  "Timur Timur Laut": 67.5,
  Timur: 90,
  "Timur Tenggara": 112.5,
  Tenggara: 135,
  "Selatan Tenggara": 157.5,
  "Tenggara Selatan": 157.5,
  Selatan: 180,
  "Selatan Barat Daya": 202.5,
  "Barat Daya": 225,
  "Barat Barat Daya": 247.5,
  Barat: 270,
  "Barat Barat Laut": 292.5,
  "Barat Laut": 315,
  "Utara Barat Laut": 337.5,
};

export function windFromNameToDeg(name: string): number {
  return WIND_FROM_DEG[name] ?? 0;
}

export function compassName(deg: number): string {
  const normalized = ((deg % 360) + 360) % 360;
  return COMPASS_16[Math.round(normalized / 22.5) % 16];
}

/** Direction the wind pushes TOWARD: (from + 180) mod 360. */
export function windVectorDeg(fromDeg: number): number {
  return (fromDeg + 180) % 360;
}

/** Convert a BMKG prakiraan-cuaca entry into the PRD telemetry contract. */
export function toWeatherTelemetry(entry: BmkgForecastEntry, localDatetime?: string): WeatherTelemetry {
  return {
    windSpeedKmh: entry.ws,
    windDirectionDeg: entry.wd_deg,
    windVectorDeg: windVectorDeg(entry.wd_deg),
    relativeHumidity: entry.hu,
    temperatureC: entry.t,
    updatedAt: localDatetime ?? entry.local_datetime,
  };
}

/** Pick the forecast entry closest to a target instant (local time). */
export function pickForecastEntry(
  entries: BmkgForecastEntry[],
  target: Date,
): BmkgForecastEntry {
  let best = entries[0];
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const entry of entries) {
    const delta = Math.abs(new Date(entry.local_datetime).getTime() - target.getTime());
    if (delta < bestDelta) {
      bestDelta = delta;
      best = entry;
    }
  }
  return best;
}

export const FIRE_STATUS_LABEL: Record<FireStatus, string> = {
  UNVERIFIED_HOTSPOT: "Titik Panas Belum Verifikasi",
  CONFIRMED_FLAMING: "Api Permukaan Aktif",
  SUSPECTED_SMOLDERING: "Dicurigai Smoldering",
  CONFIRMED_SMOLDERING: "Smoldering Terkonfirmasi",
  EXTINGUISHED: "Padam Total",
};

export const FIRE_STATUS_COLOR: Record<FireStatus, string> = {
  UNVERIFIED_HOTSPOT: "#facc15",
  CONFIRMED_FLAMING: "#ef4444",
  SUSPECTED_SMOLDERING: "#f97316",
  CONFIRMED_SMOLDERING: "#f97316",
  EXTINGUISHED: "#22c55e",
};

export const THREAT_COLOR: Record<ThreatLevel, string> = {
  AMAN: "#22c55e",
  WASPADA: "#eab308",
  SIAGA: "#f97316",
  BAHAYA: "#ef4444",
};

export const THREAT_LABEL: Record<ThreatLevel, string> = {
  AMAN: "Aman",
  WASPADA: "Waspada",
  SIAGA: "Siaga",
  BAHAYA: "Bahaya",
};

/** Format an ISO timestamp as WIB (UTC+7, Kab. Kubu Raya time). */
export function wibTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const wib = new Date(d.getTime() + 7 * 3600 * 1000);
  const hh = String(wib.getUTCHours()).padStart(2, "0");
  const mm = String(wib.getUTCMinutes()).padStart(2, "0");
  return `${hh}.${mm} WIB`;
}
