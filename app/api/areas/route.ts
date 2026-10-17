import { NextRequest } from "next/server";
import { reverseRegion, type Region } from "@/lib/geocode";
import { searchKarhutlaNews, type NewsArticle } from "@/lib/news";
import { jsonResponse } from "@/lib/http";

const MAX_CELLS = 30;
const NEWS_CACHE_MS = 60 * 60_000;
const ARTICLES_PER_AREA = 6;
const newsCache = new Map<string, { at: number; articles: NewsArticle[] }>();

/** Regency names come back as "Kabupaten X" / "Kota X"; news writes them both ways. */
function shortName(regency: string): string {
  return regency.replace(/^(Kabupaten|Kota|Kab\.)\s+/i, "").trim();
}

async function areaNews(regency: string): Promise<NewsArticle[]> {
  const hit = newsCache.get(regency);
  if (hit && Date.now() - hit.at < NEWS_CACHE_MS) return hit.articles;
  const name = shortName(regency);
  const articles = await searchKarhutlaNews(
    `(karhutla OR "kebakaran hutan" OR "kebakaran lahan" OR "kabut asap" OR "titik panas") "${name}" when:30d`,
    ARTICLES_PER_AREA,
  );
  newsCache.set(regency, { at: Date.now(), articles });
  return articles;
}

/**
 * Administrative area (kabupaten/kota, province) for each fire area, plus
 * recent karhutla news that names that kabupaten. `cells` is a
 * ";"-separated list of area centers "lat,lng". News is fetched for
 * Indonesian areas only; elsewhere the area is still named.
 */
export async function GET(request: NextRequest) {
  const cells = (request.nextUrl.searchParams.get("cells") ?? "")
    .split(";")
    .flatMap((key) => {
      const [lat, lng] = key.split(",").map(Number);
      return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
        ? [{ key, lat, lng }]
        : [];
    })
    .slice(0, MAX_CELLS);
  if (cells.length === 0) {
    return Response.json({ ok: false, error: "Parameter cells kosong" }, { status: 400 });
  }

  const started = Date.now();
  const regions: Record<string, Region | null> = {};
  for (const c of cells) {
    try {
      regions[c.key] = await reverseRegion(c.lat, c.lng);
    } catch {
      regions[c.key] = null;
    }
  }

  const news: Record<string, NewsArticle[]> = {};
  const regencies = [
    ...new Set(
      Object.values(regions).flatMap((r) => (r?.regency && r.countryCode === "id" ? [r.regency] : [])),
    ),
  ];
  await Promise.all(
    regencies.map(async (regency) => {
      try {
        news[regency] = await areaNews(regency);
      } catch {
        news[regency] = [];
      }
    }),
  );

  return jsonResponse(
    request,
    { ok: true, regions, news },
    { headers: { "x-upstream-ms": String(Date.now() - started) } },
  );
}
