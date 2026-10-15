import { NextRequest } from "next/server";
import type { Settlement } from "@/lib/gambut";
import { fetchPlacesInCells } from "@/lib/overpass";

const MAX_CELLS = 40;
const HALF_DEG = 0.25;
const CACHE_MS = 24 * 3600_000;
const cache = new Map<string, { at: number; places: Settlement[] }>();

/**
 * Villages and towns (OpenStreetMap) inside 0.5-degree fire areas, so every
 * simulated fire gets its threatened village, not only the selected one.
 * `cells` is a ";"-separated list of area centers "lat,lng".
 */
export async function GET(request: NextRequest) {
  const cells = (request.nextUrl.searchParams.get("cells") ?? "")
    .split(";")
    .flatMap((key) => {
      const [lat, lng] = key.split(",").map(Number);
      return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
        ? [{ key, lat, lng }]
        : [];
    })
    .slice(0, MAX_CELLS);
  if (cells.length === 0) {
    return Response.json({ ok: false, error: "Parameter cells kosong" }, { status: 400 });
  }

  const now = Date.now();
  const missing = cells.filter((c) => {
    const hit = cache.get(c.key);
    return !hit || now - hit.at > CACHE_MS;
  });
  const started = Date.now();
  if (missing.length > 0) {
    try {
      const found = await fetchPlacesInCells(missing, HALF_DEG);
      for (const c of missing) cache.set(c.key, { at: now, places: found[c.key] ?? [] });
    } catch (err) {
      return Response.json(
        { ok: false, error: err instanceof Error ? err.message : "Gagal memuat permukiman" },
        { status: 502, headers: { "x-upstream-ms": String(Date.now() - started) } },
      );
    }
  }

  return Response.json(
    { ok: true, cells: cells.map((c) => ({ key: c.key, places: cache.get(c.key)?.places ?? [] })) },
    { headers: missing.length > 0 ? { "x-upstream-ms": String(Date.now() - started) } : {} },
  );
}
