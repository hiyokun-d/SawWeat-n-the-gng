/**
 * NASA FIRMS (Fire Information for Resource Management System) client.
 *
 * Public API, free, but requires a personal MAP_KEY:
 * https://firms.modaps.eosdis.nasa.gov/api/  (register with an email, key
 * arrives immediately). The key goes in .env.local as MAP_KEY.
 *
 * Every near-real-time dataset with global coverage is queried (VIIRS on
 * S-NPP, NOAA-20 and NOAA-21, MODIS on Terra and Aqua) and the pixels are
 * fused into fire events, so a fire seen by several satellites shows up once
 * with all of them listed. The world comes from the public 24 h files; the
 * MAP_KEY only adds multi-day history over Indonesia.
 */

import {
  FIRMS_SOURCES,
  type FirePoint,
  type FirmsSourceId,
  type FirmsSourceStatus,
  type FusedHotspot,
} from "./gambut";

const FIRMS_BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv";
const FIRMS_GLOBAL_BASE = "https://firms.modaps.eosdis.nasa.gov/data/active_fire";
// World files are 2-10 MB each and NASA's server is sometimes slow
const FIRMS_TIMEOUT_MS = 90_000;

/** Fire detected again within this many hours of the latest pass is still burning at the surface. */
export const SMOLDER_AFTER_HOURS = 12;
/** Pixels closer than this belong to the same fire event. */
const FUSE_DISTANCE_KM = 1.2;

const SATELLITE_NAMES: Record<string, string> = {
  N: "S-NPP",
  N20: "NOAA-20",
  "1": "NOAA-20",
  N21: "NOAA-21",
  T: "Terra",
  Terra: "Terra",
  A: "Aqua",
  Aqua: "Aqua",
};

function normaliseConfidence(raw: string): FirePoint["confidence"] {
  const v = raw.trim().toLowerCase();
  if (v === "h" || v === "high") return "high";
  if (v === "l" || v === "low") return "low";
  if (v === "n" || v === "nominal") return "nominal";
  // MODIS reports a 0-100 percentage
  const pct = Number(v);
  if (Number.isFinite(pct)) return pct >= 80 ? "high" : pct >= 30 ? "nominal" : "low";
  return "nominal";
}

/** Parse one FIRMS CSV response into fire points. */
export function parseFirmsCsv(csv: string, source: FirmsSourceId): FirePoint[] {
  const lines = csv.trim().split(/\r?\n/);
  // FIRMS returns plain-text errors (e.g. "Invalid MAP_KEY.") with a 200 status
  if (lines.length < 2 || !lines[0].startsWith("latitude,")) return [];
  const header = lines[0].split(",");
  const col = (name: string) => header.indexOf(name);
  const iLat = col("latitude");
  const iLng = col("longitude");
  const iDate = col("acq_date");
  const iTime = col("acq_time");
  const iSat = col("satellite");
  const iConf = col("confidence");
  const iFrp = col("frp");
  const iDn = col("daynight");
  if (iLat < 0 || iLng < 0 || iDate < 0) return [];

  const points: FirePoint[] = [];
  for (const line of lines.slice(1)) {
    const c = line.split(",");
    const lat = Number(c[iLat]);
    const lng = Number(c[iLng]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const time = (c[iTime] ?? "0000").trim().padStart(4, "0");
    const date = c[iDate] ?? "";
    const acquiredAt = `${date}T${time.slice(0, 2)}:${time.slice(2)}:00Z`;
    const rawSat = (c[iSat] ?? "").trim();
    const frp = Number(c[iFrp]);
    points.push({
      // Same pixel from the same pass always gets the same id
      id: `${source}:${acquiredAt}:${lat.toFixed(4)}:${lng.toFixed(4)}`,
      lat,
      lng,
      frpMegawatt: Number.isFinite(frp) ? frp : 0,
      confidence: normaliseConfidence(c[iConf] ?? ""),
      acquiredAt,
      satellite: SATELLITE_NAMES[rawSat] ?? (rawSat || "unknown"),
      source,
      daynight: (c[iDn] ?? "D").trim() === "N" ? "N" : "D",
    });
  }
  return points;
}

export interface FirmsFetchResult {
  fires: FirePoint[];
  sources: FirmsSourceStatus[];
}

async function fetchCsv(url: string, source: FirmsSourceId): Promise<FirePoint[]> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(FIRMS_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`FIRMS HTTP ${res.status}`);
  const text = await res.text();
  // FIRMS answers key/quota errors as plain text with a 200 status
  if (!text.startsWith("latitude,")) throw new Error(text.slice(0, 120));
  return parseFirmsCsv(text, source);
}

/**
 * Every FIRMS source, worldwide: the public rolling-24h world files, plus
 * (with a MAP_KEY) `historyDays` of keyed history over `historyBbox` so
 * the focus region can tell a fire that went quiet from one that never was.
 * Returns null when no source answered at all.
 */
export async function fetchFirmsFires(options: {
  key?: string;
  historyBbox: readonly [number, number, number, number];
  historyDays: number;
}): Promise<FirmsFetchResult | null> {
  const area = options.historyBbox.map((n) => n.toFixed(4)).join(",");
  const jobs = FIRMS_SOURCES.flatMap((source) => [
    { source: source.id, url: `${FIRMS_GLOBAL_BASE}/${source.globalFile}` },
    ...(options.key
      ? [{ source: source.id, url: `${FIRMS_BASE}/${options.key}/${source.id}/${area}/${options.historyDays}` }]
      : []),
  ]);
  const results = await Promise.allSettled(jobs.map((j) => fetchCsv(j.url, j.source)));

  const byId = new Map<string, FirePoint>();
  const okSources = new Set<string>();
  results.forEach((result, i) => {
    if (result.status !== "fulfilled") {
      console.warn("[firms]", jobs[i].source, String(result.reason).slice(0, 160));
      return;
    }
    okSources.add(jobs[i].source);
    // The world file and the keyed history overlap; the pixel id dedupes them
    for (const f of result.value) byId.set(f.id, f);
  });
  if (okSources.size === 0) return null;

  const fires = [...byId.values()];
  const counts = new Map<string, number>();
  for (const f of fires) counts.set(f.source, (counts.get(f.source) ?? 0) + 1);
  const sources = FIRMS_SOURCES.map((s) => ({
    id: s.id,
    label: s.label,
    ok: okSources.has(s.id),
    detections: counts.get(s.id) ?? 0,
  }));
  return { fires, sources };
}

/* ------------------------------------------------------------------ */
/* Multi-satellite fusion                                              */
/* ------------------------------------------------------------------ */

function kmBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  // Equirectangular is exact enough at 1 km scale near the equator
  const x = (bLng - aLng) * Math.cos(((aLat + bLat) / 2) * (Math.PI / 180));
  const y = bLat - aLat;
  return Math.sqrt(x * x + y * y) * 111.32;
}

/**
 * Status from the observation history alone (prd.md status model):
 * - not seen in the last SMOLDER_AFTER_HOURS while newer passes exist:
 *   the surface signal vanished, so suspect smoldering, never "padam".
 * - seen by two or more satellites, or flagged high confidence: confirmed flaming.
 * - otherwise a single unconfirmed pixel.
 */
export function deriveHotspotStatus(
  lastSeenMs: number,
  latestPassMs: number,
  satelliteCount: number,
  confidence: FirePoint["confidence"],
): FusedHotspot["status"] {
  if (latestPassMs - lastSeenMs > SMOLDER_AFTER_HOURS * 3600_000) return "SUSPECTED_SMOLDERING";
  if (satelliteCount >= 2 || confidence === "high") return "CONFIRMED_FLAMING";
  return "UNVERIFIED_HOTSPOT";
}

const CONFIDENCE_RANK = { low: 0, nominal: 1, high: 2 } as const;

/**
 * Group pixels from every satellite into fire events by single linkage
 * within FUSE_DISTANCE_KM, using a grid so it stays linear in the pixel count.
 */
export function fuseHotspots(
  fires: FirePoint[],
): Omit<FusedHotspot, "inIndonesia" | "insideKhg" | "nearestSettlement">[] {
  if (fires.length === 0) return [];
  const cellDeg = FUSE_DISTANCE_KM / 111.32;
  const cellKey = (lat: number, lng: number) =>
    `${Math.floor(lat / cellDeg)}:${Math.floor(lng / cellDeg)}`;

  const grid = new Map<string, number[]>();
  fires.forEach((f, i) => {
    const key = cellKey(f.lat, f.lng);
    const bucket = grid.get(key);
    if (bucket) bucket.push(i);
    else grid.set(key, [i]);
  });

  const parent = fires.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };

  fires.forEach((f, i) => {
    const cy = Math.floor(f.lat / cellDeg);
    const cx = Math.floor(f.lng / cellDeg);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const j of grid.get(`${cy + dy}:${cx + dx}`) ?? []) {
          if (j <= i) continue;
          if (kmBetween(f.lat, f.lng, fires[j].lat, fires[j].lng) <= FUSE_DISTANCE_KM) {
            parent[find(j)] = find(i);
          }
        }
      }
    }
  });

  const groups = new Map<number, FirePoint[]>();
  fires.forEach((f, i) => {
    const root = find(i);
    const group = groups.get(root);
    if (group) group.push(f);
    else groups.set(root, [f]);
  });

  // Polar orbiters pass a place at roughly fixed local times, so "the latest
  // pass" is tracked per 10-degree longitude band, not worldwide
  const band = (lng: number) => Math.floor((lng + 180) / 10);
  const latestPassByBand = new Map<number, number>();
  for (const f of fires) {
    const b = band(f.lng);
    latestPassByBand.set(b, Math.max(latestPassByBand.get(b) ?? 0, Date.parse(f.acquiredAt)));
  }

  const usedIds = new Set<string>();
  const hotspots = [...groups.values()].map((pixels) => {
    pixels.sort((a, b) => a.acquiredAt.localeCompare(b.acquiredAt));
    const first = pixels[0];
    const last = pixels[pixels.length - 1];

    // FRP-weighted centroid; +1 keeps zero-FRP pixels in the average
    let wSum = 0;
    let lat = 0;
    let lng = 0;
    let maxFrp = 0;
    let confidence: FirePoint["confidence"] = "low";
    const satellites = new Set<string>();
    for (const p of pixels) {
      const w = p.frpMegawatt + 1;
      wSum += w;
      lat += p.lat * w;
      lng += p.lng * w;
      maxFrp = Math.max(maxFrp, p.frpMegawatt);
      if (CONFIDENCE_RANK[p.confidence] > CONFIDENCE_RANK[confidence]) confidence = p.confidence;
      satellites.add(p.satellite);
    }

    // Anchored on the first pixel so the id survives refreshes while the fire grows
    // Reads as a coordinate, e.g. "0.245S-109.340E"
    const base = `${Math.abs(first.lat).toFixed(3)}${first.lat < 0 ? "S" : "N"}-${Math.abs(
      first.lng,
    ).toFixed(3)}${first.lng < 0 ? "W" : "E"}`;
    let id = base;
    for (let n = 2; usedIds.has(id); n++) id = `${base}-${n}`;
    usedIds.add(id);

    return {
      id,
      lat: lat / wSum,
      lng: lng / wSum,
      maxFrpMegawatt: Math.round(maxFrp * 10) / 10,
      confidence,
      firstSeen: first.acquiredAt,
      lastSeen: last.acquiredAt,
      detectionCount: pixels.length,
      satellites: [...satellites].sort(),
      status: deriveHotspotStatus(
        Date.parse(last.acquiredAt),
        latestPassByBand.get(band(lng / wSum)) ?? Date.parse(last.acquiredAt),
        satellites.size,
        confidence,
      ),
    };
  });

  return hotspots;
}
