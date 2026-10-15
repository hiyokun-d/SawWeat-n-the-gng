import { NextResponse } from "next/server";
import { z } from "zod";
import { isIndonesianForestFire, searchKarhutlaNews, type NewsArticle } from "@/lib/news";

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
};

const NEWS_TIMEOUT_MS = 4_500;

const NewsApiArticleSchema = z.object({
  title: z.string(),
  description: z.string().nullable().optional(),
  url: z.string(),
  publishedAt: z.string(),
  source: z.object({ name: z.string() }),
});

const NewsApiResponseSchema = z.object({
  status: z.string(),
  articles: z.array(NewsApiArticleSchema),
});

const MAX_ARTICLES = 12;

async function fetchFromNewsApi(key: string): Promise<NewsArticle[]> {
  const q = encodeURIComponent('karhutla OR "kebakaran hutan" OR "kebakaran lahan" OR "lahan gambut"');
  const url = `https://newsapi.org/v2/everything?q=${q}&language=id&sortBy=publishedAt&pageSize=50&apiKey=${key}`;
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(NEWS_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`NewsAPI status ${res.status}`);
  const json: unknown = await res.json();
  const parsed = NewsApiResponseSchema.safeParse(json);
  if (!parsed.success) throw new Error("Format NewsAPI tidak sesuai");

  return parsed.data.articles.map((a, i) => ({
    id: `newsapi-${i}-${Date.parse(a.publishedAt) || i}`,
    title: a.title,
    source: a.source.name,
    url: a.url,
    publishedAt: a.publishedAt,
    snippet: a.description ?? a.title,
  }));
}

/** Indonesian forest and land fire (karhutla) news only, newest first. */
export async function GET(request: Request) {
  new URL(request.url).searchParams.get("refresh");

  const apiKey = process.env.NEWS_API_KEY?.trim();
  const started = Date.now();
  const headers = () => ({ ...CACHE_HEADERS, "x-upstream-ms": String(Date.now() - started) });
  const relevant = (list: NewsArticle[]) =>
    list
      .filter(isIndonesianForestFire)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, MAX_ARTICLES);

  if (apiKey) {
    try {
      const articles = relevant(await fetchFromNewsApi(apiKey));
      if (articles.length > 0) {
        return NextResponse.json(
          { ok: true, source: "newsapi", articles, updatedAt: new Date().toISOString() },
          { headers: headers() },
        );
      }
    } catch {
      // Fallback to RSS on NewsAPI failure
    }
  }

  try {
    const articles = relevant(
      await searchKarhutlaNews(
        'karhutla OR "kebakaran hutan" OR "kebakaran lahan" OR "lahan gambut terbakar" when:14d',
        50,
      ),
    );
    return NextResponse.json(
      { ok: true, source: "google-news-rss", articles, updatedAt: new Date().toISOString() },
      { headers: headers() },
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        source: "fallback",
        articles: [],
        error: err instanceof Error ? err.message : "Gagal memuat portal berita karhutla",
      },
      { status: 502 },
    );
  }
}
