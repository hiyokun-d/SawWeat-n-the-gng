import { NextRequest } from "next/server";
import { z } from "zod";
import {
  BmkgVillages,
  BmkgWeatherResponseSchema,
  DEFAULT_ADM4,
  windVectorDeg,
  type BmkgForecastEntry,
  type WeatherSource,
  type WeatherTelemetry,
} from "@/lib/gambut";

const OPEN_METEO_TIMEOUT_MS = 3_500;
const BMKG_TIMEOUT_MS = 5_000;
const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" };

const OpenMeteoSchema = z.object({
  current: z.object({
    time: z.string(),
    temperature_2m: z.number(),
    relative_humidity_2m: z.number(),
    wind_speed_10m: z.number(),
    wind_direction_10m: z.number(),
  }),
});

interface WeatherResult {
  source: WeatherSource;
  telemetry: WeatherTelemetry;
  lokasi?: z.infer<typeof BmkgWeatherResponseSchema>["lokasi"];
}

/** Open-Meteo: wind_speed_10m is km/h by default; timezone=GMT keeps `time` in UTC. */
async function fetchOpenMeteo(lat: number, lng: number): Promise<WeatherResult> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m` +
    `&timezone=GMT`;
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(OPEN_METEO_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const parsed = OpenMeteoSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error("Format respons Open-Meteo tidak dikenali");

  const c = parsed.data.current;
  return {
    source: "open-meteo",
    telemetry: {
      windSpeedKmh: c.wind_speed_10m,
      windDirectionDeg: c.wind_direction_10m,
      windVectorDeg: windVectorDeg(c.wind_direction_10m),
      relativeHumidity: c.relative_humidity_2m,
      temperatureC: c.temperature_2m,
      updatedAt: new Date(`${c.time}Z`).toISOString(),
    },
  };
}

/** BMKG datetimes look like "2026-10-14 12:00:00" (no zone marker). */
function bmkgUtcMs(entry: BmkgForecastEntry): number {
  return new Date(`${entry.utc_datetime.replace(" ", "T")}Z`).getTime();
}

async function fetchBmkg(adm4: string): Promise<WeatherResult> {
  const res = await fetch(`https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=${adm4}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(BMKG_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`BMKG HTTP ${res.status} untuk adm4 ${adm4}`);
  const parsed = BmkgWeatherResponseSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error("Format respons BMKG tidak dikenali");

  const { lokasi, data } = parsed.data;
  const entries = data.flatMap((day) => day.cuaca.flat());
  if (entries.length === 0) throw new Error("BMKG tidak mengirim data prakiraan");

  const now = Date.now();
  let current = entries[0];
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const entry of entries) {
    const delta = Math.abs(bmkgUtcMs(entry) - now);
    if (delta < bestDelta) {
      bestDelta = delta;
      current = entry;
    }
  }

  return {
    source: "bmkg",
    lokasi,
    telemetry: {
      windSpeedKmh: current.ws,
      windDirectionDeg: current.wd_deg,
      windVectorDeg: windVectorDeg(current.wd_deg),
      relativeHumidity: current.hu,
      temperatureC: current.t,
      updatedAt: new Date(bmkgUtcMs(current)).toISOString(),
    },
  };
}

/**
 * Weather proxy for the village given by adm4 (Kemendagri code).
 * Open-Meteo answers first (fast, no key; prd.md). BMKG
 * (api.bmkg.go.id/publik/prakiraan-cuaca) is the fallback; its public server
 * is often slow, so both calls are time-boxed. The response names its source
 * because both providers require attribution.
 */
export async function GET(request: NextRequest) {
  const adm4 = request.nextUrl.searchParams.get("adm4") ?? DEFAULT_ADM4;
  if (!/^\d{2}\.\d{2}\.\d{2}\.\d{4}$/.test(adm4)) {
    return Response.json(
      { ok: false, error: `Kode wilayah adm4 tidak valid: ${adm4}` },
      { status: 400 },
    );
  }

  const village = BmkgVillages.find((v) => v.adm4 === adm4) ?? BmkgVillages[0];

  const failures: string[] = [];
  for (const attempt of [() => fetchOpenMeteo(village.lat, village.lng), () => fetchBmkg(adm4)]) {
    try {
      const result = await attempt();
      return Response.json({ ok: true, ...result }, { headers: CACHE_HEADERS });
    } catch (err) {
      failures.push(err instanceof Error ? err.message : "Gagal menghubungi penyedia cuaca");
    }
  }

  const fallbackTelemetry: WeatherTelemetry = {
    windSpeedKmh: 15,
    windDirectionDeg: 270,
    windVectorDeg: 90,
    relativeHumidity: 65,
    temperatureC: 31,
    updatedAt: new Date().toISOString(),
  };

  return Response.json(
    {
      ok: true,
      source: "fallback",
      telemetry: fallbackTelemetry,
      warning: `Penyedia cuaca eksternal tidak merespons: ${failures.join("; ")}`,
    },
    { headers: CACHE_HEADERS },
  );
}
