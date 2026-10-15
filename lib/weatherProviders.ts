/**
 * Server-side weather providers for the spread model. BMKG prakiraan-cuaca
 * (per village, 3-hourly, 3 days) is the primary source; Open-Meteo (hourly,
 * any coordinate, batchable) covers villages BMKG has no code for or when
 * BMKG is slow. Both return the current slot plus the forecast ahead, so the
 * engine can follow wind shifts hour by hour.
 */

import { z } from "zod";
import {
  type AirQuality,
  BmkgWeatherResponseSchema,
  windVectorDeg,
  type BmkgForecastEntry,
  type WeatherForecastStep,
  type WeatherTelemetry,
} from "./gambut";

const BMKG_TIMEOUT_MS = 6_000;
const OPEN_METEO_TIMEOUT_MS = 12_000;
/** Forecast window carried to the client: the timeline reaches t+12 h, ETAs look further. */
const FORECAST_HOURS = 48;
const BMKG_SLOT_HOURS = 3;

export type BmkgLokasi = z.infer<typeof BmkgWeatherResponseSchema>["lokasi"];

/** BMKG datetimes look like "2026-10-14 12:00:00" (no zone marker). */
function bmkgUtcMs(entry: BmkgForecastEntry): number {
  return new Date(`${entry.utc_datetime.replace(" ", "T")}Z`).getTime();
}

function toTelemetry(current: WeatherForecastStep, forecast: WeatherForecastStep[]): WeatherTelemetry {
  return {
    windSpeedKmh: current.windSpeedKmh,
    windDirectionDeg: current.windDirectionDeg,
    windVectorDeg: windVectorDeg(current.windDirectionDeg),
    relativeHumidity: current.relativeHumidity,
    temperatureC: current.temperatureC,
    precipitationMmH: current.precipitationMmH,
    updatedAt: current.at,
    forecast,
  };
}

/** Current slot = the latest one already started; forecast = it and everything after. */
function splitSeries(steps: WeatherForecastStep[], nowMs: number) {
  const sorted = [...steps].sort((a, b) => a.at.localeCompare(b.at));
  let currentIdx = 0;
  sorted.forEach((s, i) => {
    if (Date.parse(s.at) <= nowMs) currentIdx = i;
  });
  const until = nowMs + FORECAST_HOURS * 3600_000;
  const forecast = sorted.slice(currentIdx).filter((s) => Date.parse(s.at) <= until);
  return { current: sorted[currentIdx], forecast };
}

export async function fetchBmkg(adm4: string): Promise<{ telemetry: WeatherTelemetry; lokasi: BmkgLokasi }> {
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

  const steps: WeatherForecastStep[] = entries.map((e) => ({
    at: new Date(bmkgUtcMs(e)).toISOString(),
    windSpeedKmh: e.ws,
    windDirectionDeg: e.wd_deg,
    relativeHumidity: e.hu,
    temperatureC: e.t,
    precipitationMmH: (e.tp ?? 0) / BMKG_SLOT_HOURS,
  }));
  const { current, forecast } = splitSeries(steps, Date.now());
  return { telemetry: toTelemetry(current, forecast), lokasi };
}

const OpenMeteoLocationSchema = z.object({
  hourly: z.object({
    time: z.array(z.string()),
    temperature_2m: z.array(z.number().nullable()),
    relative_humidity_2m: z.array(z.number().nullable()),
    wind_speed_10m: z.array(z.number().nullable()),
    wind_direction_10m: z.array(z.number().nullable()),
    precipitation: z.array(z.number().nullable()),
  }),
});

/**
 * Open-Meteo for many coordinates in one request (the API takes comma lists
 * and answers with an array). wind_speed_10m is km/h; timezone=GMT keeps
 * times in UTC.
 */
export async function fetchOpenMeteoBatch(
  points: { lat: number; lng: number }[],
): Promise<WeatherTelemetry[]> {
  if (points.length === 0) return [];
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${points.map((p) => p.lat.toFixed(3)).join(",")}` +
    `&longitude=${points.map((p) => p.lng.toFixed(3)).join(",")}` +
    `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation` +
    `&past_hours=1&forecast_hours=${FORECAST_HOURS}&timezone=GMT`;
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(OPEN_METEO_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const json: unknown = await res.json();
  const parsed = z
    .array(OpenMeteoLocationSchema)
    .safeParse(Array.isArray(json) ? json : [json]);
  if (!parsed.success) throw new Error("Format respons Open-Meteo tidak dikenali");

  const now = Date.now();
  return parsed.data.map(({ hourly: h }) => {
    const steps: WeatherForecastStep[] = [];
    h.time.forEach((t, i) => {
      const ws = h.wind_speed_10m[i];
      const wd = h.wind_direction_10m[i];
      const rh = h.relative_humidity_2m[i];
      const temp = h.temperature_2m[i];
      if (ws === null || wd === null || rh === null || temp === null) return;
      steps.push({
        at: new Date(`${t}Z`).toISOString(),
        windSpeedKmh: ws,
        windDirectionDeg: wd,
        relativeHumidity: rh,
        temperatureC: temp,
        precipitationMmH: h.precipitation[i] ?? 0,
      });
    });
    if (steps.length === 0) throw new Error("Open-Meteo tidak mengirim data jam-an");
    const { current, forecast } = splitSeries(steps, now);
    return toTelemetry(current, forecast);
  });
}

const AirLocationSchema = z.object({
  current: z.object({
    time: z.string(),
    us_aqi: z.number().nullable(),
    pm2_5: z.number().nullable(),
    pm10: z.number().nullable(),
    carbon_monoxide: z.number().nullable(),
    aerosol_optical_depth: z.number().nullable(),
  }),
  hourly: z.object({
    time: z.array(z.string()),
    us_aqi: z.array(z.number().nullable()),
    pm2_5: z.array(z.number().nullable()),
  }),
});

/** Open-Meteo Air Quality (CAMS) for many coordinates in one request. */
export async function fetchAirBatch(points: { lat: number; lng: number }[]): Promise<AirQuality[]> {
  if (points.length === 0) return [];
  const url =
    `https://air-quality-api.open-meteo.com/v1/air-quality` +
    `?latitude=${points.map((p) => p.lat.toFixed(3)).join(",")}` +
    `&longitude=${points.map((p) => p.lng.toFixed(3)).join(",")}` +
    `&current=us_aqi,pm2_5,pm10,carbon_monoxide,aerosol_optical_depth` +
    `&hourly=us_aqi,pm2_5&forecast_hours=13&timezone=GMT`;
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(OPEN_METEO_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Open-Meteo Air HTTP ${res.status}`);
  const json: unknown = await res.json();
  const parsed = z.array(AirLocationSchema).safeParse(Array.isArray(json) ? json : [json]);
  if (!parsed.success) throw new Error("Format respons kualitas udara tidak dikenali");
  return parsed.data.map(({ current: c, hourly: h }) => ({
    at: new Date(`${c.time}Z`).toISOString(),
    usAqi: c.us_aqi,
    pm25: c.pm2_5,
    pm10: c.pm10,
    co: c.carbon_monoxide,
    aod: c.aerosol_optical_depth,
    forecast: h.time.map((t, i) => ({
      at: new Date(`${t}Z`).toISOString(),
      usAqi: h.us_aqi[i],
      pm25: h.pm2_5[i],
    })),
  }));
}
