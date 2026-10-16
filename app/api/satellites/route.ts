import { NextResponse } from "next/server";
import { degreesLat, degreesLong, eciToGeodetic, gstime, propagate, twoline2satrec } from "satellite.js";
import { FIRE_SATELLITES, type SatelliteTle, type SatellitesPayload, type SatelliteTrack } from "@/lib/satellites";

// CelesTrak updates elements a few times a day and asks clients not to poll more often than that
const TLE_CACHE_MS = 6 * 3_600_000;
/** Samples cover 40 min behind (the drawn track) to 110 min ahead (more than one ~100 min orbit). */
const PAST_S = 40 * 60;
const AHEAD_S = 110 * 60;
const STEP_S = 20;

let tleCache: { at: number; tles: SatelliteTle[] } | null = null;
let inflight: Promise<SatelliteTle[]> | null = null;

async function fetchTle(norad: number): Promise<SatelliteTle> {
  const res = await fetch(`https://celestrak.org/NORAD/elements/gp.php?CATNR=${norad}&FORMAT=TLE`, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`CelesTrak HTTP ${res.status}`);
  const [name, line1, line2] = (await res.text()).split(/\r?\n/).map((l) => l.trim());
  if (!line1?.startsWith("1 ") || !line2?.startsWith("2 ")) throw new Error(`TLE ${norad} tidak valid`);
  return { norad, name, line1, line2 };
}

/**
 * Where each FIRMS satellite is, sampled every 20 s from 40 min ago to 110 min
 * ahead (SGP4 on CelesTrak elements). The browser interpolates between samples,
 * so the satellites glide on the map without shipping an orbit library.
 */
export async function GET(request: Request) {
  new URL(request.url).searchParams.get("refresh");
  const started = Date.now();
  let upstreamMs: number | null = null;
  if (!tleCache || Date.now() - tleCache.at > TLE_CACHE_MS) {
    inflight ??= Promise.allSettled(FIRE_SATELLITES.map((s) => fetchTle(s.norad)))
      .then((r) => r.flatMap((x) => (x.status === "fulfilled" ? [x.value] : [])))
      .finally(() => {
        inflight = null;
      });
    const tles = await inflight;
    upstreamMs = Date.now() - started;
    if (tles.length > 0) tleCache = { at: Date.now(), tles };
  }

  // Aligned to the step so every request in the same 20 s shares identical samples
  const startMs = Math.floor((Date.now() - PAST_S * 1000) / (STEP_S * 1000)) * STEP_S * 1000;
  const n = Math.floor((PAST_S + AHEAD_S) / STEP_S) + 1;
  const sats: SatelliteTrack[] = (tleCache?.tles ?? []).flatMap((t) => {
    const meta = FIRE_SATELLITES.find((s) => s.norad === t.norad);
    if (!meta) return [];
    const rec = twoline2satrec(t.line1, t.line2);
    const track: SatelliteTrack = { norad: t.norad, name: meta.name, sensor: meta.sensor, swathKm: meta.swathKm, lat: [], lng: [], altKm: [] };
    for (let i = 0; i < n; i++) {
      const at = new Date(startMs + i * STEP_S * 1000);
      const pv = propagate(rec, at);
      if (!pv || typeof pv.position === "boolean" || !pv.position) return [];
      const geo = eciToGeodetic(pv.position, gstime(at));
      track.lat.push(Math.round(degreesLat(geo.latitude) * 1e3) / 1e3);
      track.lng.push(Math.round(degreesLong(geo.longitude) * 1e3) / 1e3);
      track.altKm.push(Math.round(geo.height));
    }
    return [track];
  });

  const body: SatellitesPayload = {
    ok: sats.length > 0,
    fetchedAt: new Date(tleCache?.at ?? Date.now()).toISOString(),
    start: new Date(startMs).toISOString(),
    stepS: STEP_S,
    sats,
  };
  return NextResponse.json(body, {
    status: body.ok ? 200 : 502,
    headers: {
      "Cache-Control": "public, s-maxage=20, stale-while-revalidate=60",
      ...(upstreamMs === null ? {} : { "x-upstream-ms": String(upstreamMs) }),
    },
  });
}
