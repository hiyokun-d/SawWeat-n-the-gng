import type { NewsArticle } from "@/lib/news";

/**
 * ISPA (acute respiratory infection) from karhutla smoke, two ways:
 *
 * 1. Reported: case counts the Ministry of Health and local health offices
 *    publish, read from news headlines with the article linked. Nothing is
 *    filled in between reports.
 * 2. Modeled: extra ISPA cases per day caused by PM2.5 above the WHO daily
 *    guideline, in the 0.5-degree areas around monitored fires:
 *
 *      extra = residents x baseline daily ISPA rate x (RR^((PM2.5 - 15) / 10) - 1)
 *
 *    - RR: +0.50% upper respiratory infection outpatient visits per 10 ug/m3
 *      PM2.5 (95% CI 0.19-0.81%), Li et al. 2021, Chemosphere 280:130843,
 *      doi:10.1016/j.chemosphere.2021.130843 (pooled, four Chinese cities, children).
 *    - Baseline: 7.9 million ISPA cases in Indonesia from 1 January to
 *      29 August 2025 (Kemenkes, via Katadata 3 Sep 2026) over 241 days and
 *      284.67 million residents (BPS SUPAS 2025).
 *    - Threshold: WHO 2021 air quality guideline, 24-hour PM2.5 = 15 ug/m3.
 *    - Residents: WorldPop 100 m grid inside each area's largest modeled smoke
 *      plume. PM2.5: Copernicus CAMS daily means via Open-Meteo.
 */

export const ISPA_MODEL = {
  rrPer10: 1.005,
  rrPer10Low: 1.0019,
  rrPer10High: 1.0081,
  thresholdPm25: 15,
  baselineCases: 7_900_000,
  baselineDays: 241,
  population: 284_670_000,
} as const;

export const ISPA_BASELINE_RATE = ISPA_MODEL.baselineCases / ISPA_MODEL.baselineDays / ISPA_MODEL.population;

export const ISPA_SOURCES = {
  rr: { label: "Li dkk. 2021, Chemosphere", url: "https://doi.org/10.1016/j.chemosphere.2021.130843" },
  baseline: {
    label: "Kemenkes via Katadata (3 Sep 2026)",
    url: "https://katadata.co.id/infografik/6a991f78617e4/infografik-karhutla-picu-lonjakan-kasus-ispa",
  },
  population: { label: "BPS SUPAS 2025" },
  who: { label: "WHO Air Quality Guidelines 2021" },
} as const;

/** Extra ISPA cases per day among `residents` breathing `pm25` (daily mean). */
export function excessIspa(residents: number, pm25: number, rrPer10: number = ISPA_MODEL.rrPer10): number {
  const above = Math.max(0, pm25 - ISPA_MODEL.thresholdPm25);
  return residents * ISPA_BASELINE_RATE * (Math.pow(rrPer10, above / 10) - 1);
}

export interface IspaModelDay {
  /** WIB calendar day, YYYY-MM-DD. */
  date: string;
  forecast: boolean;
  /** Extra cases that day: central estimate and the 95% CI of the dose-response. */
  cases: number;
  low: number;
  high: number;
  /** Residents in areas above the WHO guideline that day. */
  exposed: number;
  /** Highest area daily-mean PM2.5. */
  maxPm25: number;
}

export interface IspaReport {
  count: number;
  /** "national": the Ministry's running total over the smoke provinces; "local": one city or regency. */
  scope: "national" | "local";
  /** Count limited to children under five. */
  underFive: boolean;
  title: string;
  source: string;
  url: string;
  publishedAt: string;
}

export interface IspaPayload {
  ok: boolean;
  model: {
    days: IspaModelDay[];
    areas: number;
    /** Residents in the smoke plumes the model covers. */
    residents: number;
  };
  reports: IspaReport[];
  fetchedAt: string;
}

/** "283.270" -> 283270, "283 Ribu" -> 283000, "1,8 juta" -> 1800000. */
function parseCount(num: string, unit: string | undefined): number {
  const u = unit?.toLowerCase();
  if (u === "ribu" || u === "juta") {
    const n = Number(num.replace(/\./g, "").replace(",", "."));
    return Math.round(n * (u === "ribu" ? 1_000 : 1_000_000));
  }
  return Number(num.replace(/\./g, ""));
}

const NATIONAL_TERMS = /kemenkes|kementerian kesehatan|7 provinsi|tujuh provinsi|\bri\b|nasional|imbas karhutla|akibat karhutla|wilayah (terdampak )?karhutla/i;
const REGION_TERMS =
  /kalteng|kalsel|kalbar|kaltim|kaltara|kalimantan (barat|tengah|selatan|timur|utara)|riau|jambi|sumsel|sumatera (selatan|utara|barat)|palembang|pekanbaru|palangka|pontianak|banjarmasin|samarinda|balikpapan|batam|makassar|mimika|maluku|ambon|padang|kendari|aceh|lampung|bengkulu|bangka/i;

const COUNT_RE = /(\d{1,3}(?:\.\d{3})+|\d+(?:,\d+)?)\s*(ribu|juta)?\s*(kasus|orang|warga|balita|anak|penderita|jiwa)?/gi;

/**
 * Case counts read from headlines. A headline must mention ISPA; a count is
 * taken only when the words next to it say what it counts (cases, people,
 * children), so years, percentages and multipliers are skipped.
 */
export function reportsFromNews(articles: NewsArticle[]): IspaReport[] {
  const out: IspaReport[] = [];
  const seen = new Set<string>();
  for (const a of articles) {
    const title = a.title.replace(/\s+-\s+[^-]+$/, "");
    if (!/\bispa\b/i.test(title)) continue;
    for (const m of title.matchAll(COUNT_RE)) {
      const [, num, unit, noun] = m;
      // Part of a word or code ("N95" masks), not a count
      if (m.index > 0 && /[\p{L}\d]/u.test(title[m.index - 1])) continue;
      const before = title.slice(Math.max(0, m.index - 12), m.index).toLowerCase();
      const after = title.slice(m.index + m[0].length, m.index + m[0].length + 20).toLowerCase();
      // "1,8 hingga 3,8 kali", "22,5 persen", "dalam dua pekan" and years are not case counts
      if (/kali|persen|%|pekan|hari|tahun|provinsi/.test(after) || /^\s*(19|20)\d{2}\b/.test(num)) continue;
      if (!noun && !/kasus|ispa|orang|warga/.test(after) && !/kasus/.test(before)) continue;
      const count = parseCount(num, unit);
      if (!Number.isFinite(count) || count < 10) continue;
      const underFive = /balita|anak/.test(`${noun ?? ""} ${after}`.toLowerCase());
      // The Ministry's total spans seven provinces; a headline naming one region reports that region
      const national =
        !underFive && count >= 50_000 && NATIONAL_TERMS.test(title) && !REGION_TERMS.test(title);
      const key = `${count}|${underFive}|${a.publishedAt.slice(0, 10)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        count,
        scope: national ? "national" : "local",
        underFive,
        title,
        source: a.source,
        url: a.url,
        publishedAt: a.publishedAt,
      });
    }
  }
  return out.sort((x, y) => y.publishedAt.localeCompare(x.publishedAt));
}

/** WIB calendar day of an instant. */
export function wibDate(iso: string | number): string {
  return new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

export interface ReportedDay {
  date: string;
  /** Largest national running total published that day. */
  total: number;
  /** New cases per day since the previous published total (null for the first). */
  perDay: number | null;
  report: IspaReport;
}

/**
 * The Ministry's running total by the day each figure was first published,
 * and the daily rise between figures. Outlets keep quoting older totals for
 * days, so a figure counts on the day it first appeared, not on later repeats.
 */
export function reportedSeries(reports: IspaReport[]): ReportedDay[] {
  const firstSeen = new Map<number, IspaReport>();
  for (const r of reports) {
    // Exact figures only: "283 ribu" is a rounding of a figure already in the series
    if (r.scope !== "national" || r.count % 1000 === 0) continue;
    const prev = firstSeen.get(r.count);
    if (!prev || r.publishedAt < prev.publishedAt) firstSeen.set(r.count, r);
  }
  const byDay = new Map<string, IspaReport>();
  for (const r of firstSeen.values()) {
    const d = wibDate(r.publishedAt);
    const prev = byDay.get(d);
    if (!prev || r.count > prev.count) byDay.set(d, r);
  }
  const out: ReportedDay[] = [];
  for (const [date, report] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const last = out.at(-1);
    // A running total only grows; a smaller new figure is a different tally
    if (last && report.count <= last.total) continue;
    const gapDays = last ? (Date.parse(date) - Date.parse(last.date)) / 86_400_000 : 0;
    out.push({
      date,
      total: report.count,
      perDay: last && gapDays > 0 ? Math.round((report.count - last.total) / gapDays) : null,
      report,
    });
  }
  return out;
}
