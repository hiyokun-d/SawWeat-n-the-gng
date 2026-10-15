import { NextRequest } from "next/server";
import { findNearestPlace } from "@/lib/overpass";

const cache = new Map<string, { at: number; body: unknown }>();
const CACHE_MS = 24 * 3600_000;

/**
 * Nearest named place to a fire, anywhere in the world (OpenStreetMap via
 * Overpass), and the nearest Indonesian village with a Kemendagri code so
 * BMKG can forecast it. Called for the incident an operator selects.
 */
export async function GET(request: NextRequest) {
  const lat = Number(request.nextUrl.searchParams.get("lat"));
  const lng = Number(request.nextUrl.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return Response.json({ ok: false, error: "lat/lng tidak valid" }, { status: 400 });
  }

  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return Response.json(hit.body);

  const started = Date.now();
  try {
    const { nearest, coded } = await findNearestPlace(lat, lng);
    const body = { ok: true, nearest, coded };
    cache.set(key, { at: Date.now(), body });
    return Response.json(body, { headers: { "x-upstream-ms": String(Date.now() - started) } });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Gagal mencari permukiman" },
      { status: 502 },
    );
  }
}
