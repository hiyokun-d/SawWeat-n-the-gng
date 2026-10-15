/**
 * Named settlements around Kalimantan Barat from OpenStreetMap (Overpass API),
 * preloaded so every fire there gets its threatened village without a
 * request per fire. Elsewhere lib/overpass.ts looks places up on demand.
 * Server-only.
 *
 * The Overpass query takes 20-30 s, so it runs in the background and is kept
 * in memory for a day; until it lands, the six BMKG Rasau Jaya villages stand in.
 */

import { z } from "zod";
import { BmkgVillages, SETTLEMENT_BBOX, type Settlement } from "./gambut";
import { overpassQuery } from "./overpass";

export type { Settlement };

export const ADM4_PATTERN = /^\d{2}\.\d{2}\.\d{2}\.\d{4}$/;

/** OSM population tags are free text ("1234", "1.234", "1,234"); unreadable ones are dropped. */
export function parsePopulation(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw.replace(/[.,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

const OVERPASS_TIMEOUT_MS = 60_000;
const TTL_MS = 24 * 3600_000;
const RETRY_AFTER_FAILURE_MS = 10 * 60_000;

const [W, S, E, N] = SETTLEMENT_BBOX;
const QUERY = `[out:json][timeout:50];node["place"~"^(city|town|village)$"]["name"](${S},${W},${N},${E});out qt;`;

const OverpassSchema = z.object({
  elements: z.array(
    z.object({
      lat: z.number(),
      lon: z.number(),
      tags: z.object({ name: z.string(), ref: z.string().optional(), population: z.string().optional() }).loose(),
    }),
  ),
});

const FALLBACK: Settlement[] = BmkgVillages.map(({ name, lat, lng, adm4 }) => ({ name, lat, lng, adm4 }));

let cached: { settlements: Settlement[]; loadedAt: number } | null = null;
let failedAt = 0;
let inflight: Promise<void> | null = null;

async function load(): Promise<void> {
  try {
    const parsed = OverpassSchema.safeParse(await overpassQuery(QUERY, OVERPASS_TIMEOUT_MS));
    if (!parsed.success || parsed.data.elements.length === 0) throw new Error("Overpass kosong");
    cached = {
      settlements: parsed.data.elements.map((e) => ({
        name: e.tags.name,
        lat: e.lat,
        lng: e.lon,
        adm4: e.tags.ref && ADM4_PATTERN.test(e.tags.ref) ? e.tags.ref : undefined,
        population: parsePopulation(e.tags.population),
      })),
      loadedAt: Date.now(),
    };
  } catch (err) {
    failedAt = Date.now();
    console.warn("[settlements]", err instanceof Error ? err.message : err);
  } finally {
    inflight = null;
  }
}

/**
 * Settlements for nearest-village lookups. Waits at most `waitMs` for a
 * running Overpass load, then answers with whatever is available.
 */

export async function getSettlements(waitMs: number): Promise<Settlement[]> {
  const fresh = cached && Date.now() - cached.loadedAt < TTL_MS;
  const mayRetry = Date.now() - failedAt > RETRY_AFTER_FAILURE_MS;
  if (!fresh && !inflight && mayRetry) inflight = load();
  if (inflight) {
    await Promise.race([inflight, new Promise((r) => setTimeout(r, waitMs))]);
  }
  return cached?.settlements ?? FALLBACK;
}

/**
 * Nearest settlement by grid lookup (pass the same list for many queries).
 * Anything further than `maxKm` is not "the village this fire threatens".
 */
export function nearestSettlementIndex(
  allSettlements: Settlement[],
  filter?: (s: Settlement) => boolean,
  maxKm = Infinity,
) {
  const settlements = filter ? allSettlements.filter(filter) : allSettlements;
  const cellDeg = 0.25;
  const grid = new Map<string, Settlement[]>();
  for (const s of settlements) {
    const key = `${Math.floor(s.lat / cellDeg)}:${Math.floor(s.lng / cellDeg)}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(s);
    else grid.set(key, [s]);
  }

  const dist2 = (lat: number, lng: number, s: Settlement) => {
    const x = (s.lng - lng) * Math.cos((lat * Math.PI) / 180);
    const y = s.lat - lat;
    return x * x + y * y;
  };

  return (lat: number, lng: number): Settlement | null => {
    const cy = Math.floor(lat / cellDeg);
    const cx = Math.floor(lng / cellDeg);
    // Widen the ring until something is found; a ring of r cells guarantees
    // the answer once the best distance is within r-1 cells
    let best: Settlement | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (let r = 0; r < 40; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dy), Math.abs(dx)) !== r) continue;
          for (const s of grid.get(`${cy + dy}:${cx + dx}`) ?? []) {
            const d = dist2(lat, lng, s);
            if (d < bestD) {
              bestD = d;
              best = s;
            }
          }
        }
      }
      if (best && Math.sqrt(bestD) <= r * cellDeg) break;
    }
    if (best && Math.sqrt(bestD) * 111.32 > maxKm) return null;
    return best;
  };
}
