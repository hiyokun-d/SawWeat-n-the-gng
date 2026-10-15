/**
 * Reverse geocoding to kabupaten/kota and province with OpenStreetMap
 * Nominatim. Server-only. Nominatim's usage policy allows one request per
 * second with an identifying User-Agent, so calls go through a serial queue
 * and every answer is cached for a week.
 */

import { z } from "zod";

export interface Region {
  /** Kabupaten or kota (OSM county / city / state_district). */
  regency: string | null;
  province: string | null;
  country: string | null;
  countryCode: string | null;
}

const URL_BASE = "https://nominatim.openstreetmap.org/reverse";
const CACHE_MS = 7 * 24 * 3600_000;
const GAP_MS = 1_100;

const ReverseSchema = z.object({
  address: z
    .object({
      county: z.string().optional(),
      city: z.string().optional(),
      regency: z.string().optional(),
      state_district: z.string().optional(),
      state: z.string().optional(),
      country: z.string().optional(),
      country_code: z.string().optional(),
    })
    .loose()
    .optional(),
});

const cache = new Map<string, { at: number; region: Region }>();
let queue: Promise<unknown> = Promise.resolve();

async function lookup(lat: number, lng: number): Promise<Region> {
  const url = `${URL_BASE}?format=jsonv2&lat=${lat}&lon=${lng}&zoom=8&accept-language=id`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": "GambutWatch/0.1 (karhutla decision support)" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const a = ReverseSchema.parse(await res.json()).address ?? {};
  return {
    regency: a.regency ?? a.county ?? a.city ?? a.state_district ?? null,
    province: a.state ?? null,
    country: a.country ?? null,
    countryCode: a.country_code ?? null,
  };
}

export async function reverseRegion(lat: number, lng: number): Promise<Region> {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.region;
  const job = queue.then(async () => {
    const region = await lookup(lat, lng);
    cache.set(key, { at: Date.now(), region });
    await new Promise((r) => setTimeout(r, GAP_MS));
    return region;
  });
  // A failed lookup must not stall the queue for the next caller
  queue = job.catch(() => new Promise((r) => setTimeout(r, GAP_MS)));
  return job;
}
