import { NextRequest } from "next/server";
import type { WeatherTelemetry } from "@/lib/gambut";
import { getSettlements, nearestSettlementIndex } from "@/lib/settlements";
import { fetchBmkg, fetchOpenMeteoBatch } from "@/lib/weatherProviders";

const MAX_CELLS = 80;
const CACHE_MS = 30 * 60_000;
/** BMKG's public API allows 60 requests a minute per IP; stay well under it. */
const BMKG_CONCURRENCY = 5;
/** A BMKG village further than this from the cell center does not speak for the cell. */
const BMKG_MAX_KM = 30;

interface CellWeather {
  key: string;
  source: "bmkg" | "open-meteo";
  place?: string | null;
  telemetry: WeatherTelemetry;
}

const cache = new Map<string, { at: number; cell: CellWeather }>();

function parseCells(raw: string | null): { key: string; lat: number; lng: number }[] {
  if (!raw) return [];
  const cells = raw.split(";").flatMap((pair) => {
    const [lat, lng] = pair.split(",").map(Number);
    const valid =
      Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    return valid ? [{ key: pair, lat, lng }] : [];
  });
  return cells.slice(0, MAX_CELLS);
}

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>) {
  const out: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.allSettled(items.slice(i, i + size).map(fn))));
  }
  return out;
}

/**
 * Weather per fire area for the spread model. `cells` is a ";"-separated
 * list of "lat,lng" area centers. Each area gets the BMKG forecast of the
 * nearest village that has a Kemendagri code (OpenStreetMap `ref` tag);
 * areas without one, or where BMKG fails, get Open-Meteo at the center.
 */
export async function GET(request: NextRequest) {
  const cells = parseCells(request.nextUrl.searchParams.get("cells"));
  if (cells.length === 0) {
    return Response.json({ ok: false, error: "Parameter cells kosong" }, { status: 400 });
  }

  const now = Date.now();
  const result = new Map<string, CellWeather>();
  for (const c of cells) {
    const hit = cache.get(c.key);
    if (hit && now - hit.at < CACHE_MS) result.set(c.key, hit.cell);
  }
  const missing = cells.filter((c) => !result.has(c.key));

  const started = Date.now();
  if (missing.length > 0) {
    const settlements = await getSettlements(2_000);
    const nearestCoded = nearestSettlementIndex(settlements, (s) => s.adm4 !== undefined, BMKG_MAX_KM);
    const withVillage = missing.map((c) => ({ cell: c, village: nearestCoded(c.lat, c.lng) }));

    const bmkgJobs = withVillage.filter((w) => w.village !== null);
    const bmkg = await inBatches(bmkgJobs, BMKG_CONCURRENCY, (w) => fetchBmkg(w.village!.adm4!));
    bmkg.forEach((r, i) => {
      if (r.status !== "fulfilled") return;
      const { cell, village } = bmkgJobs[i];
      const place = r.value.lokasi ? `${r.value.lokasi.desa}, ${r.value.lokasi.kecamatan}` : village!.name;
      result.set(cell.key, { key: cell.key, source: "bmkg", place, telemetry: r.value.telemetry });
    });

    const rest = missing.filter((c) => !result.has(c.key));
    if (rest.length > 0) {
      try {
        const telemetry = await fetchOpenMeteoBatch(rest);
        rest.forEach((c, i) =>
          result.set(c.key, { key: c.key, source: "open-meteo", telemetry: telemetry[i] }),
        );
      } catch (err) {
        console.warn("[weather/grid]", err instanceof Error ? err.message : err);
      }
    }

    for (const c of missing) {
      const cell = result.get(c.key);
      if (cell) cache.set(c.key, { at: now, cell });
    }
  }

  return Response.json(
    { ok: true, cells: [...result.values()] },
    { headers: missing.length > 0 ? { "x-upstream-ms": String(Date.now() - started) } : {} },
  );
}
