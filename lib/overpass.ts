/**
 * OpenStreetMap place lookups through the Overpass API. Server-only.
 * The main instance often answers 504 under load, so each query walks a
 * list of public mirrors until one returns JSON.
 */

import { z } from "zod";
import type { Settlement } from "./gambut";
import { ADM4_PATTERN, nearestSettlementIndex, parsePopulation } from "./settlements";

const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

/** POST a query to the first mirror that answers; the timeout covers all attempts. */
export async function overpassQuery(query: string, timeoutMs: number): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  const failures: string[] = [];
  for (const url of OVERPASS_URLS) {
    const left = deadline - Date.now();
    if (left <= 1_000) break;
    try {
      const res = await fetch(url, {
        method: "POST",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "GambutWatch/0.1",
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(left),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      failures.push(`${new URL(url).hostname}: ${err instanceof Error ? err.message : err}`);
    }
  }
  throw new Error(`Overpass gagal (${failures.join("; ")})`);
}

const PlaceSchema = z.object({
  elements: z.array(
    z.object({
      lat: z.number(),
      lon: z.number(),
      tags: z.object({ name: z.string(), ref: z.string().optional(), population: z.string().optional() }).loose(),
    }),
  ),
});

/**
 * Nearest named place within `radiusKm` of a point, anywhere in the world,
 * plus the nearest one carrying a Kemendagri code (for BMKG). One small
 * Overpass query; used for the incident an operator selects.
 */
export async function findNearestPlace(
  lat: number,
  lng: number,
  radiusKm = 30,
): Promise<{ nearest: Settlement | null; coded: Settlement | null }> {
  const q =
    `[out:json][timeout:20];node["place"~"^(city|town|village|hamlet)$"]["name"]` +
    `(around:${Math.round(radiusKm * 1000)},${lat},${lng});out qt;`;
  const parsed = PlaceSchema.safeParse(await overpassQuery(q, 25_000));
  if (!parsed.success) throw new Error("Format Overpass tidak dikenali");
  const places: Settlement[] = parsed.data.elements.map((e) => ({
    name: e.tags.name,
    lat: e.lat,
    lng: e.lon,
    adm4: e.tags.ref && ADM4_PATTERN.test(e.tags.ref) ? e.tags.ref : undefined,
    population: parsePopulation(e.tags.population),
  }));
  const near = nearestSettlementIndex(places);
  const nearCoded = nearestSettlementIndex(places, (s) => s.adm4 !== undefined);
  return { nearest: near(lat, lng), coded: nearCoded(lat, lng) };
}

/**
 * Named places inside many 0.5-degree areas with one Overpass request (a
 * union of bounding boxes). Keys are the area centers ("lat,lng").
 */
export async function fetchPlacesInCells(
  cells: { key: string; lat: number; lng: number }[],
  halfDeg: number,
): Promise<Record<string, Settlement[]>> {
  const boxes = cells
    .map(
      (c) =>
        `node["place"~"^(city|town|village|hamlet)$"]["name"](${(c.lat - halfDeg).toFixed(3)},${(
          c.lng - halfDeg
        ).toFixed(3)},${(c.lat + halfDeg).toFixed(3)},${(c.lng + halfDeg).toFixed(3)});`,
    )
    .join("");
  const q = `[out:json][timeout:50];(${boxes});out qt;`;
  const parsed = PlaceSchema.safeParse(await overpassQuery(q, 60_000));
  if (!parsed.success) throw new Error("Format Overpass tidak dikenali");

  const out: Record<string, Settlement[]> = Object.fromEntries(cells.map((c) => [c.key, []]));
  for (const e of parsed.data.elements) {
    const cell = cells.find(
      (c) => Math.abs(e.lat - c.lat) <= halfDeg && Math.abs(e.lon - c.lng) <= halfDeg,
    );
    if (!cell) continue;
    out[cell.key].push({
      name: e.tags.name,
      lat: e.lat,
      lng: e.lon,
      adm4: e.tags.ref && ADM4_PATTERN.test(e.tags.ref) ? e.tags.ref : undefined,
      population: parsePopulation(e.tags.population),
    });
  }
  return out;
}
