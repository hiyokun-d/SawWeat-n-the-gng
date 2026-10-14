/**
 * NASA FIRMS (Fire Information for Resource Management System) client.
 *
 * Public API, free, but requires a personal MAP_KEY:
 * https://firms.modaps.eosdis.nasa.gov/api/  (register with an email, key
 * arrives immediately). The key goes in .env.local as MAP_KEY.
 *
 * VIIRS near-real-time (NRT) sources have ~3 hour latency and cover the
 * KHG Sungai Kapuas - Sungai Ambawang area around the clock.
 */

import { FIRMS_SOURCES, type FirePoint } from "./gambut";

const FIRMS_BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv";
const FIRMS_TIMEOUT_MS = 8_000;

function normaliseConfidence(raw: string): FirePoint["confidence"] {
  const v = raw.trim().toLowerCase();
  if (v === "h" || v === "high") return "high";
  if (v === "l" || v === "low") return "low";
  if (v === "n" || v === "nominal") return "nominal";
  const pct = Number(v);
  if (Number.isFinite(pct)) return pct >= 80 ? "high" : pct >= 30 ? "nominal" : "low";
  return "nominal";
}

/** Parse one FIRMS CSV response into fire points. */
export function parseFirmsCsv(csv: string): FirePoint[] {
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
  if (iLat < 0 || iLng < 0) return [];

  return lines.slice(1).map((line, i) => {
    const c = line.split(",");
    const time = (c[iTime] ?? "0000").padStart(4, "0");
    const date = c[iDate] ?? "";
    return {
      id: `${date}-${time}-${c[iSat] ?? "sat"}-${i}`,
      lat: Number(c[iLat]),
      lng: Number(c[iLng]),
      frpMegawatt: Number(c[iFrp]),
      confidence: normaliseConfidence(c[iConf] ?? ""),
      acquiredAt: `${date}T${time.slice(0, 2)}:${time.slice(2)}:00Z`,
      satellite: c[iSat] ?? "unknown",
      daynight: (c[iDn] ?? "D").trim() === "N" ? "N" : "D",
    };
  });
}

/**
 * Fetch real fire detections around the KHG area. Returns null when the API
 * key is missing or the request fails — callers fall back to seed data.
 */
export async function fetchFirmsFires(
  key: string,
  bbox: readonly [number, number, number, number],
  days = 3,
): Promise<FirePoint[] | null> {
  const area = bbox.map((n) => n.toFixed(4)).join(",");
  const results = await Promise.allSettled(
    FIRMS_SOURCES.map((source) =>
      fetch(`${FIRMS_BASE}/${key}/${source}/${area}/${days}`, {
        next: { revalidate: 900 },
        signal: AbortSignal.timeout(FIRMS_TIMEOUT_MS),
      }),
    ),
  );

  const fires: FirePoint[] = [];
  let reachable = 0;
  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value.ok) continue;
    try {
      fires.push(...parseFirmsCsv(await result.value.text()));
      reachable += 1;
    } catch {
      // Skip a malformed source; the others may still be good
    }
  }
  return reachable === 0 ? null : fires;
}

/**
 * Merge detections of the same spot. VIIRS pixels are ~375 m (about 0.003
 * degrees), so a fire seen on several passes or by overlapping satellites
 * shares one 3-decimal lat/lng key; the newest detection wins.
 */
export function dedupeFirmsFires(fires: FirePoint[]): FirePoint[] {
  const seen = new Set<string>();
  const unique: FirePoint[] = [];
  // Newest detections first
  const sorted = [...fires].sort((a, b) => b.acquiredAt.localeCompare(a.acquiredAt));
  for (const f of sorted) {
    if (!Number.isFinite(f.lat) || !Number.isFinite(f.lng)) continue;
    const key = `${f.lat.toFixed(3)}:${f.lng.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(f);
  }
  return unique;
}
