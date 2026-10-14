import { NextRequest } from "next/server";
import {
  BmkgMarineResponseSchema,
  KUBU_RAYA_MARINE_CODE,
  windFromNameToDeg,
  windVectorDeg,
} from "@/lib/gambut";

const KNOT_TO_KMH = 1.852;

/**
 * Proxy to the BMKG maritime API (maritim.bmkg.go.id/apidoc).
 * Base URL: https://maritim.bmkg.go.id/marine2026-data/
 * Default area: P.V.04 "Perairan Kubu Raya" from meta/area_province.json.
 * Marine wind speed arrives in knots; we convert to km/h for the engine.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code") ?? KUBU_RAYA_MARINE_CODE;
  if (!/^P\.[A-Z]{1,2}\.\d{2}$/.test(code)) {
    return Response.json(
      { ok: false, error: `Kode perairan tidak valid: ${code}` },
      { status: 400 },
    );
  }

  try {
    const res = await fetch(
      `https://maritim.bmkg.go.id/marine2026-data/perairan/${code}.json`,
      { cache: "no-store" },
    );
    if (!res.ok) {
      return Response.json(
        { ok: false, error: `BMKG maritim merespons HTTP ${res.status} untuk ${code}` },
        { status: 502 },
      );
    }
    const json: unknown = await res.json();
    const parsed = BmkgMarineResponseSchema.safeParse(json);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: "Format respons BMKG maritim tidak dikenali" },
        { status: 502 },
      );
    }

    const marine = parsed.data;
    const entries = marine.forecast_day1 ?? [];
    if (entries.length === 0) {
      return Response.json(
        { ok: false, error: `Tidak ada prakiraan hari ini untuk ${code}` },
        { status: 502 },
      );
    }

    // Marine forecast times are UTC ("YYYY-MM-DD HH:00 UTC"); pick nearest to now.
    const now = Date.now();
    let current = entries[0];
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const entry of entries) {
      const isoTime = `${entry.time.replace(" UTC", "").replace(" ", "T")}Z`;
      const delta = Math.abs(new Date(isoTime).getTime() - now);
      if (delta < bestDelta) {
        bestDelta = delta;
        current = entry;
      }
    }

    const windFromDeg = windFromNameToDeg(current.wind_from);
    return Response.json({
      ok: true,
      code: marine.code,
      name: marine.name,
      issued: marine.issued,
      validFrom: marine.valid_from,
      validTo: marine.valid_to,
      current: {
        time: current.time,
        weather: current.weather,
        temperatureC: current.temp_avg,
        relativeHumidity: current.rh_avg,
        windFrom: current.wind_from,
        windSpeedKnot: current.wind_speed,
        windSpeedKmh: Math.round(current.wind_speed * KNOT_TO_KMH * 10) / 10,
        windGustKmh:
          current.wind_gust != null
            ? Math.round(current.wind_gust * KNOT_TO_KMH * 10) / 10
            : null,
        waveCategory: current.wave_cat,
        waveHeightM: current.wave_height,
        currentTo: current.current_to,
        currentSpeedKnot: current.current_speed,
        windFromDeg,
        windVectorDeg: windVectorDeg(windFromDeg),
      },
      attribution: "BMKG",
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Gagal menghubungi BMKG maritim" },
      { status: 502 },
    );
  }
}
