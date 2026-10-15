/**
 * Indonesia land boundary (geoBoundaries gbOpen ADM0, simplified, CC BY 4.0)
 * for tagging fires as inside or outside Indonesia. Server-only; loaded once
 * and kept in memory. Until it loads, a coarse bounding box answers instead.
 */

import { z } from "zod";

const BOUNDARY_URL =
  "https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/gbOpen/IDN/ADM0/geoBoundaries-IDN-ADM0_simplified.geojson";
const TIMEOUT_MS = 60_000;
const RETRY_AFTER_FAILURE_MS = 30 * 60_000;

/** west, south, east, north */
export const INDONESIA_BBOX = [94.9, -11.2, 141.1, 6.2] as const;

type Ring = number[][];
interface IndexedPolygon {
  bbox: [number, number, number, number];
  rings: Ring[];
}

const GeoJsonSchema = z.object({
  features: z.array(
    z.object({
      geometry: z.union([
        z.object({ type: z.literal("Polygon"), coordinates: z.array(z.array(z.array(z.number()))) }),
        z.object({
          type: z.literal("MultiPolygon"),
          coordinates: z.array(z.array(z.array(z.array(z.number())))),
        }),
      ]),
    }),
  ),
});

let polygons: IndexedPolygon[] | null = null;
let failedAt = 0;
let inflight: Promise<void> | null = null;

function index(rings: Ring[]): IndexedPolygon {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of rings[0]) {
    w = Math.min(w, x); e = Math.max(e, x);
    s = Math.min(s, y); n = Math.max(n, y);
  }
  return { bbox: [w, s, e, n], rings };
}

async function load() {
  try {
    const res = await fetch(BOUNDARY_URL, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`geoBoundaries HTTP ${res.status}`);
    const parsed = GeoJsonSchema.safeParse(await res.json());
    if (!parsed.success) throw new Error("Format batas wilayah tidak dikenali");
    polygons = parsed.data.features.flatMap(({ geometry: g }) =>
      g.type === "Polygon" ? [index(g.coordinates)] : g.coordinates.map(index),
    );
  } catch (err) {
    failedAt = Date.now();
    console.warn("[indonesia]", err instanceof Error ? err.message : err);
  } finally {
    inflight = null;
  }
}

function inRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inBbox(lng: number, lat: number, [w, s, e, n]: readonly number[]): boolean {
  return lng >= w && lng <= e && lat >= s && lat <= n;
}

/** Returns a point-in-Indonesia test, waiting at most `waitMs` for the boundary to load. */
export async function getIndonesiaTest(waitMs: number): Promise<(lat: number, lng: number) => boolean> {
  if (!polygons && !inflight && Date.now() - failedAt > RETRY_AFTER_FAILURE_MS) inflight = load();
  if (inflight) await Promise.race([inflight, new Promise((r) => setTimeout(r, waitMs))]);

  const loaded = polygons;
  if (!loaded) return (lat, lng) => inBbox(lng, lat, INDONESIA_BBOX);
  return (lat, lng) => {
    if (!inBbox(lng, lat, INDONESIA_BBOX)) return false;
    for (const p of loaded) {
      if (!inBbox(lng, lat, p.bbox)) continue;
      if (!inRing(lng, lat, p.rings[0])) continue;
      if (p.rings.slice(1).some((hole) => inRing(lng, lat, hole))) continue;
      return true;
    }
    return false;
  };
}
