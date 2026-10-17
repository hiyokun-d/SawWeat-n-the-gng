import { NextRequest } from "next/server";
import { jsonResponse } from "@/lib/http";
import { excessIspa, ISPA_MODEL, reportsFromNews, wibDate, type IspaModelDay, type IspaPayload, type IspaReport } from "@/lib/ispa";
import { googleNewsRss } from "@/lib/news";
import { fetchAirDaily } from "@/lib/weatherProviders";

const MAX_CELLS = 40;
const PAST_DAYS = 7;
const FORECAST_DAYS = 2;
const AIR_CACHE_MS = 60 * 60_000;
const NEWS_CACHE_MS = 15 * 60_000;

const airCache = new Map<string, { at: number; days: { date: string; pm25: number }[] }>();
let news: { at: number; reports: IspaReport[] } | null = null;

async function loadNews(): Promise<IspaReport[]> {
  if (news && Date.now() - news.at < NEWS_CACHE_MS) return news.reports;
  const queries = ["ISPA karhutla when:30d", "Kemenkes kasus ISPA karhutla when:60d", "kasus ISPA kabut asap when:30d"];
  const results = await Promise.allSettled(queries.map(googleNewsRss));
  const articles = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (articles.length === 0 && news) return news.reports;
  news = { at: Date.now(), reports: reportsFromNews(articles) };
  return news.reports;
}

/**
 * ISPA from karhutla smoke: case counts reported by Kemenkes and local health
 * offices (from news headlines), and a modeled daily count of extra cases from
 * measured PM2.5 in the areas around monitored fires (see lib/ispa.ts).
 * `cells` is a ";"-separated list of "lat,lng,residents": a 0.5-degree area
 * center and the WorldPop residents of the largest modeled smoke plume in it
 * (the dashboard already counts those; overlapping plumes are not summed).
 */
export async function GET(request: NextRequest) {
  const started = Date.now();
  const cells = (request.nextUrl.searchParams.get("cells") ?? "")
    .split(";")
    .flatMap((triple) => {
      const [lat, lng, pop] = triple.split(",").map(Number);
      const valid =
        Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && pop >= 0;
      return valid ? [{ key: `${lat},${lng}`, lat, lng, pop }] : [];
    })
    .slice(0, MAX_CELLS);

  const reportsP = loadNews().catch(() => [] as IspaReport[]);

  // Daily PM2.5 for areas not cached in the last hour
  const now = Date.now();
  const stale = cells.filter((c) => {
    const hit = airCache.get(c.key);
    return !hit || now - hit.at > AIR_CACHE_MS;
  });
  let airError: string | null = null;
  if (stale.length > 0) {
    try {
      const daily = await fetchAirDaily(stale, PAST_DAYS, FORECAST_DAYS);
      stale.forEach((c, i) => airCache.set(c.key, { at: now, days: daily[i] ?? [] }));
    } catch (err) {
      airError = err instanceof Error ? err.message : "Gagal memuat PM2.5 harian";
    }
  }

  const today = wibDate(Date.now());
  const byDay = new Map<string, IspaModelDay>();
  for (const c of cells) {
    const pop = c.pop;
    for (const { date, pm25 } of airCache.get(c.key)?.days ?? []) {
      const d = byDay.get(date) ?? { date, forecast: date > today, cases: 0, low: 0, high: 0, exposed: 0, maxPm25: 0 };
      d.cases += excessIspa(pop, pm25);
      d.low += excessIspa(pop, pm25, ISPA_MODEL.rrPer10Low);
      d.high += excessIspa(pop, pm25, ISPA_MODEL.rrPer10High);
      if (pm25 > ISPA_MODEL.thresholdPm25) d.exposed += pop;
      d.maxPm25 = Math.max(d.maxPm25, pm25);
      byDay.set(date, d);
    }
  }
  const days = [...byDay.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ ...d, cases: Math.round(d.cases), low: Math.round(d.low), high: Math.round(d.high), maxPm25: Math.round(d.maxPm25) }));

  const reports = await reportsP;
  const body: IspaPayload & { error?: string } = {
    ok: days.length > 0 || reports.length > 0,
    model: { days, areas: cells.length, residents: cells.reduce((n, c) => n + c.pop, 0) },
    reports,
    fetchedAt: new Date().toISOString(),
    ...(airError ? { error: airError } : {}),
  };
  return jsonResponse(request, body, { headers: { "x-upstream-ms": String(Date.now() - started) } });
}
