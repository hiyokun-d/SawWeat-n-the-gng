import { NextRequest } from "next/server";
import {
  BmkgWeatherResponseSchema,
  DEFAULT_ADM4,
  type BmkgForecastEntry,
} from "@/lib/gambut";

/**
 * Proxy to the BMKG open weather forecast API (data.bmkg.go.id/prakiraan-cuaca).
 * Source endpoint:
 *   https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4={kode_wilayah_tingkat_iv}
 * BMKG requires attribution; the client renders it alongside the data.
 */
export async function GET(request: NextRequest) {
  const adm4 = request.nextUrl.searchParams.get("adm4") ?? DEFAULT_ADM4;
  if (!/^\d{2}\.\d{2}\.\d{2}\.\d{4}$/.test(adm4)) {
    return Response.json(
      { ok: false, error: `Kode wilayah adm4 tidak valid: ${adm4}` },
      { status: 400 },
    );
  }

  try {
    const res = await fetch(
      `https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=${adm4}`,
      { cache: "no-store" },
    );
    if (!res.ok) {
      return Response.json(
        { ok: false, error: `BMKG merespons HTTP ${res.status} untuk adm4 ${adm4}` },
        { status: 502 },
      );
    }
    const json: unknown = await res.json();
    const parsed = BmkgWeatherResponseSchema.safeParse(json);
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: "Format respons BMKG tidak dikenali" },
        { status: 502 },
      );
    }

    const { lokasi, data } = parsed.data;
    const entries: BmkgForecastEntry[] = data.flatMap((day) => day.cuaca.flat());

    // Entry nearest to now (local time, Asia/Pontianak)
    const now = Date.now();
    let current = entries[0];
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const entry of entries) {
      const delta = Math.abs(new Date(entry.local_datetime).getTime() - now);
      if (delta < bestDelta) {
        bestDelta = delta;
        current = entry;
      }
    }

    const telemetry = {
      windSpeedKmh: current.ws,
      windDirectionDeg: current.wd_deg,
      windVectorDeg: (current.wd_deg + 180) % 360,
      relativeHumidity: current.hu,
      temperatureC: current.t,
      updatedAt: current.local_datetime,
    };

    return Response.json({
      ok: true,
      lokasi,
      telemetry,
      current,
      forecast: entries.slice(entries.indexOf(current), entries.indexOf(current) + 8),
      attribution: "BMKG",
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Gagal menghubungi BMKG" },
      { status: 502 },
    );
  }
}
