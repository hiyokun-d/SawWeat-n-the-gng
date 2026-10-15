import { NextRequest } from "next/server";
import type { AirQuality } from "@/lib/gambut";
import { fetchAirBatch } from "@/lib/weatherProviders";

const MAX_CELLS = 80;
const CACHE_MS = 30 * 60_000;
const cache = new Map<string, { at: number; air: AirQuality }>();

/**
 * Air quality per fire area (Open-Meteo Air Quality API, Copernicus CAMS
 * model): US AQI, PM2.5, PM10, carbon monoxide, aerosol optical depth, plus
 * 12 h of PM2.5/AQI forecast. `cells` is a ";"-separated list of "lat,lng".
 */
export async function GET(request: NextRequest) {
  const cells = (request.nextUrl.searchParams.get("cells") ?? "")
    .split(";")
    .flatMap((pair) => {
      const [lat, lng] = pair.split(",").map(Number);
      return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
        ? [{ key: pair, lat, lng }]
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
      const air = await fetchAirBatch(missing);
      missing.forEach((c, i) => cache.set(c.key, { at: now, air: air[i] }));
    } catch (err) {
      return Response.json(
        { ok: false, error: err instanceof Error ? err.message : "Gagal memuat kualitas udara" },
        { status: 502, headers: { "x-upstream-ms": String(Date.now() - started) } },
      );
    }
  }

  return Response.json(
    {
      ok: true,
      cells: cells.flatMap((c) => {
        const hit = cache.get(c.key);
        return hit ? [{ key: c.key, air: hit.air }] : [];
      }),
    },
    { headers: missing.length > 0 ? { "x-upstream-ms": String(Date.now() - started) } : {} },
  );
}
