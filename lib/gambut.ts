/**
 * GambutWatch data contract.
 * Mirrors the TypeScript interfaces defined in prd.md so the frontend,
 * the simulation engine, and the BMKG API routes share one source of truth.
 */

import { z } from "zod";

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
  /** Rain over the last/current interval (mm per hour), when the provider reports it. */
  precipitationMmH?: number;
  /** Provider forecast ahead of `updatedAt`, oldest first; drives the spread forecast. */
  forecast?: WeatherForecastStep[];
}

/** One forecast slot from BMKG (3-hourly) or Open-Meteo (hourly). */
export interface WeatherForecastStep {
  /** Start of the slot, ISO UTC. */
  at: string;
  windSpeedKmh: number;
  windDirectionDeg: number;
  relativeHumidity: number;
  temperatureC: number;
  precipitationMmH: number;
}

export interface PeatlandZone {
  khgId: string;
  name: string;
  depthCategory: "DANGKAL (<1m)" | "SEDANG (1-3m)" | "DALAM (>3m)" | "TIDAK TERPETAKAN";
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
  /** Null where no settlement data is available yet (looked up on selection). */
  nearestVillage: {
    name: string;
    lat: number;
    lng: number;
    distanceMeters: number;
    threatLevel: ThreatLevel;
    safeEvacuationBearingDeg: number;
    /** Minutes until the forecast spread reaches the village (Infinity past the forecast). */
    etaMinutes: number;
    population?: number;
  } | null;
  /** Inside Indonesia: the app's focus area. */
  inIndonesia: boolean;
  lastVerifiedBy?: string;
  lastVerifiedAt?: string;
  /** Satellites that saw this fire in the query window (fused FIRMS sources). */
  satellites: string[];
  /** Number of FIRMS pixels fused into this incident. */
  detectionCount: number;
  firstDetectedAt: string;
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

/**
 * FIRMS near-real-time datasets with global coverage, all queried and merged.
 * `globalFile` is the public rolling-24h world file under
 * firms.modaps.eosdis.nasa.gov/data/active_fire/ (no key needed).
 */
export const FIRMS_SOURCES = [
  {
    id: "VIIRS_SNPP_NRT",
    label: "VIIRS S-NPP",
    globalFile: "suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv",
  },
  {
    id: "VIIRS_NOAA20_NRT",
    label: "VIIRS NOAA-20",
    globalFile: "noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv",
  },
  {
    id: "VIIRS_NOAA21_NRT",
    label: "VIIRS NOAA-21",
    globalFile: "noaa-21-viirs-c2/csv/J2_VIIRS_C2_Global_24h.csv",
  },
  // One dataset, two satellites: the CSV satellite column says Terra or Aqua
  {
    id: "MODIS_NRT",
    label: "MODIS Terra/Aqua",
    globalFile: "modis-c6.1/csv/MODIS_C6_1_Global_24h.csv",
  },
] as const;
// LANDSAT_NRT and GOES_NRT are left out on purpose: FIRMS only publishes
// them for the Americas (LANDSAT_NRT for the US and Canada), so they would
// add no detections over Indonesia and only partial ones elsewhere.

export type FirmsSourceId = (typeof FIRMS_SOURCES)[number]["id"];

export interface FirePoint {
  id: string;
  lat: number;
  lng: number;
  /** Fire radiative power in megawatts. */
  frpMegawatt: number;
  confidence: "low" | "nominal" | "high";
  /** Detection time, ISO UTC (FIRMS acquisition date + time). */
  acquiredAt: string;
  /** Satellite display name, e.g. "NOAA-20" or "Aqua". */
  satellite: string;
  source: FirmsSourceId;
  daynight: "D" | "N";
}

/**
 * Fire event fused from every FIRMS pixel within ~1 km of each other,
 * whichever satellite saw them. Status is derived from the observation
 * history, see `deriveHotspotStatus` in lib/firms.ts.
 */
export interface FusedHotspot {
  id: string;
  /** FRP-weighted centroid of the fused pixels. */
  lat: number;
  lng: number;
  maxFrpMegawatt: number;
  confidence: "low" | "nominal" | "high";
  firstSeen: string;
  lastSeen: string;
  detectionCount: number;
  satellites: string[];
  status: Extract<FireStatus, "UNVERIFIED_HOTSPOT" | "CONFIRMED_FLAMING" | "SUSPECTED_SMOLDERING">;
  /** Inside Indonesia's land boundary: the app's focus, drawn larger on the map. */
  inIndonesia: boolean;
  /** Inside the mapped KHG Sungai Kapuas - Sungai Ambawang polygon. */
  insideKhg: boolean;
  /** Nearest named settlement (OpenStreetMap), where settlement data is loaded. */
  nearestSettlement: Settlement | null;
}

export interface Settlement {
  name: string;
  lat: number;
  lng: number;
  /** Kemendagri village code (OSM `ref`), which is also BMKG's forecast key. */
  adm4?: string;
  /** Residents from the OSM `population` tag, where mappers recorded it. */
  population?: number;
}

/** Region whose villages are preloaded from OpenStreetMap (west, south, east, north). */
export const SETTLEMENT_BBOX = [107.7, -3.4, 114.5, 2.4] as const;

/** Days of keyed FIRMS history pulled for Indonesia (API maximum is 5); the world gets 24 h. */
export const FIRMS_INDONESIA_DAYS = 3;

/** NASA FIRMS requires attribution on every surface that shows their data. */
export const FIRMS_ATTRIBUTION =
  "Data hotspot: NASA FIRMS (Fire Information for Resource Management System)";

/** Default weather source: Desa Rasau Jaya Umum (Kec. Rasau Jaya, Kab. Kubu Raya). */
export const DEFAULT_ADM4 = "61.12.07.2001";

/* ------------------------------------------------------------------ */
/* API response schemas (zod)                                         */
/* ------------------------------------------------------------------ */

/**
 * Fused hotspots as columns, so ~100k fires worldwide stay a few MB.
 * Times are minutes after `baseTime`; `sats` is a bitmask over
 * `satelliteNames`; `flags` bit 0 = in Indonesia, bit 1 = inside the KHG.
 */
export const HotspotTableSchema = z.object({
  baseTime: z.string(),
  satelliteNames: z.array(z.string()),
  ids: z.array(z.string()),
  lat: z.array(z.number()),
  lng: z.array(z.number()),
  frp: z.array(z.number()),
  conf: z.array(z.number()),
  status: z.array(z.number()),
  first: z.array(z.number()),
  last: z.array(z.number()),
  count: z.array(z.number()),
  sats: z.array(z.number()),
  flags: z.array(z.number()),
  /** Nearest settlement per hotspot id, only where settlement data is loaded. */
  settlements: z.record(
    z.string(),
    z.object({
      name: z.string(),
      lat: z.number(),
      lng: z.number(),
      adm4: z.string().optional(),
      population: z.number().optional(),
    }),
  ),
});

export type HotspotTable = z.infer<typeof HotspotTableSchema>;

export const HOTSPOT_CONFIDENCES = ["low", "nominal", "high"] as const;
export const HOTSPOT_STATUSES = [
  "UNVERIFIED_HOTSPOT",
  "CONFIRMED_FLAMING",
  "SUSPECTED_SMOLDERING",
] as const satisfies readonly FusedHotspot["status"][];

export function encodeHotspots(hotspots: FusedHotspot[], baseTime: string): HotspotTable {
  const baseMs = Date.parse(baseTime);
  const satelliteNames = [...new Set(hotspots.flatMap((h) => h.satellites))].sort();
  const minutes = (iso: string) => Math.round((Date.parse(iso) - baseMs) / 60_000);
  const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
  const table: HotspotTable = {
    baseTime,
    satelliteNames,
    ids: [], lat: [], lng: [], frp: [], conf: [], status: [],
    first: [], last: [], count: [], sats: [], flags: [],
    settlements: {},
  };
  for (const h of hotspots) {
    table.ids.push(h.id);
    table.lat.push(round(h.lat, 4));
    table.lng.push(round(h.lng, 4));
    table.frp.push(h.maxFrpMegawatt);
    table.conf.push(HOTSPOT_CONFIDENCES.indexOf(h.confidence));
    table.status.push(HOTSPOT_STATUSES.indexOf(h.status));
    table.first.push(minutes(h.firstSeen));
    table.last.push(minutes(h.lastSeen));
    table.count.push(h.detectionCount);
    table.sats.push(h.satellites.reduce((m, s) => m | (1 << satelliteNames.indexOf(s)), 0));
    table.flags.push((h.inIndonesia ? 1 : 0) | (h.insideKhg ? 2 : 0));
    if (h.nearestSettlement) table.settlements[h.id] = h.nearestSettlement;
  }
  return table;
}

export function decodeHotspots(t: HotspotTable): FusedHotspot[] {
  const baseMs = Date.parse(t.baseTime);
  const iso = (min: number) => new Date(baseMs + min * 60_000).toISOString();
  return t.ids.map((id, i) => ({
    id,
    lat: t.lat[i],
    lng: t.lng[i],
    maxFrpMegawatt: t.frp[i],
    confidence: HOTSPOT_CONFIDENCES[t.conf[i]] ?? "nominal",
    status: HOTSPOT_STATUSES[t.status[i]] ?? "UNVERIFIED_HOTSPOT",
    firstSeen: iso(t.first[i]),
    lastSeen: iso(t.last[i]),
    detectionCount: t.count[i],
    satellites: t.satelliteNames.filter((_, b) => (t.sats[i] & (1 << b)) !== 0),
    inIndonesia: (t.flags[i] & 1) !== 0,
    insideKhg: (t.flags[i] & 2) !== 0,
    nearestSettlement: t.settlements[id] ?? null,
  }));
}

export const FirmsSourceStatusSchema = z.object({
  id: z.string(),
  label: z.string(),
  ok: z.boolean(),
  detections: z.number(),
});

export type FirmsSourceStatus = z.infer<typeof FirmsSourceStatusSchema>;

/** Response of GET /api/firms (NASA FIRMS area proxy). */
export const FirmsApiResponseSchema = z.object({
  ok: z.boolean(),
  /** True when MAP_KEY is set, so Indonesia also gets multi-day history. */
  keyed: z.boolean(),
  hotspots: HotspotTableSchema.nullish(),
  detections: z.number().default(0),
  sources: z.array(FirmsSourceStatusSchema).default([]),
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
  /** Precipitation in the 3-hour slot (mm). */
  tp: z.number().nullish(),
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

export const WeatherForecastStepSchema = z.object({
  at: z.string(),
  windSpeedKmh: z.number(),
  windDirectionDeg: z.number(),
  relativeHumidity: z.number(),
  temperatureC: z.number(),
  precipitationMmH: z.number(),
});

export const WeatherTelemetrySchema = z.object({
  windSpeedKmh: z.number(),
  windDirectionDeg: z.number(),
  windVectorDeg: z.number(),
  relativeHumidity: z.number(),
  temperatureC: z.number(),
  updatedAt: z.string(),
  precipitationMmH: z.number().optional(),
  forecast: z.array(WeatherForecastStepSchema).optional(),
});

/** Response of GET /api/weather/grid: weather per fire area. */
export const WeatherGridResponseSchema = z.object({
  ok: z.literal(true),
  cells: z.array(
    z.object({
      key: z.string(),
      source: z.enum(["bmkg", "open-meteo"]),
      /** BMKG village the forecast belongs to, when BMKG answered. */
      place: z.string().nullish(),
      telemetry: WeatherTelemetrySchema,
    }),
  ),
});

export const WEATHER_SOURCES = ["bmkg", "open-meteo"] as const;
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
  // Darker than suspected so a field-confirmed ember reads apart from a satellite guess
  CONFIRMED_SMOLDERING: "#c2410c",
  EXTINGUISHED: "#22c55e",
};

/** Every status, most urgent first: drives list order, counters and the legend. */
export const FIRE_STATUS_ORDER: FireStatus[] = [
  "CONFIRMED_FLAMING",
  "CONFIRMED_SMOLDERING",
  "SUSPECTED_SMOLDERING",
  "UNVERIFIED_HOTSPOT",
  "EXTINGUISHED",
];

export function isSmoldering(status: FireStatus): boolean {
  return status === "SUSPECTED_SMOLDERING" || status === "CONFIRMED_SMOLDERING";
}

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

/* ------------------------------------------------------------------ */
/* Air quality (Open-Meteo Air Quality API, CAMS model)                */
/* ------------------------------------------------------------------ */

export const AirQualitySchema = z.object({
  at: z.string(),
  usAqi: z.number().nullable(),
  pm25: z.number().nullable(),
  pm10: z.number().nullable(),
  /** Carbon monoxide, microgram per cubic meter. */
  co: z.number().nullable(),
  /** Aerosol optical depth: how much the smoke column dims sunlight. */
  aod: z.number().nullable(),
  /** Hourly forecast ahead (first entry = now). */
  forecast: z.array(z.object({ at: z.string(), usAqi: z.number().nullable(), pm25: z.number().nullable() })),
});

export type AirQuality = z.infer<typeof AirQualitySchema>;

export const AirGridResponseSchema = z.object({
  ok: z.literal(true),
  cells: z.array(z.object({ key: z.string(), air: AirQualitySchema })),
});

export interface AqiBand {
  max: number;
  label: string;
  color: string;
  advice: string;
}

/** US AQI bands with Indonesian labels and field advice. */
export const AQI_BANDS: AqiBand[] = [
  { max: 50, label: "Baik", color: "#22c55e", advice: "Udara aman untuk aktivitas luar." },
  { max: 100, label: "Sedang", color: "#eab308", advice: "Kelompok sensitif kurangi aktivitas berat di luar." },
  {
    max: 150,
    label: "Tidak sehat (sensitif)",
    color: "#f97316",
    advice: "Anak, lansia, ibu hamil dan penderita ISPA pakai masker dan batasi waktu di luar.",
  },
  {
    max: 200,
    label: "Tidak sehat",
    color: "#ef4444",
    advice: "Semua warga pakai masker N95; regu lapangan rotasi dan sediakan posko kesehatan.",
  },
  {
    max: 300,
    label: "Sangat tidak sehat",
    color: "#a855f7",
    advice: "Tutup sekolah, siapkan ruang udara bersih; pindahkan kelompok rentan menjauhi asap.",
  },
  {
    max: Number.POSITIVE_INFINITY,
    label: "Berbahaya",
    color: "#9f1239",
    advice: "Evakuasi kelompok rentan keluar jalur asap; regu hanya dengan pelindung pernapasan.",
  },
];

export function aqiBand(usAqi: number): AqiBand {
  return AQI_BANDS.find((b) => usAqi <= b.max) ?? AQI_BANDS[AQI_BANDS.length - 1];
}
