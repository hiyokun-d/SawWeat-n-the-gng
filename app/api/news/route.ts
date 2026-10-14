import { NextResponse } from "next/server";
import { z } from "zod";

export interface NewsArticle {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  snippet: string;
}

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
};

const NEWS_TIMEOUT_MS = 4_500;

function parseRssArticles(xml: string): NewsArticle[] {
  const items = xml.match(/<item>([\s\S]*?)<\/item>/g) ?? [];
  return items.slice(0, 12).map((item, index) => {
    const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/);
    const linkMatch = item.match(/<link>([\s\S]*?)<\/link>/);
    const pubDateMatch = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    const sourceMatch = item.match(/<source[^>]*>([\s\S]*?)<\/source>/);
    const descMatch = item.match(/<description>([\s\S]*?)<\/description>/);

    const rawTitle = titleMatch ? titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : "Berita Karhutla & BMKG";
    const url = linkMatch ? linkMatch[1].trim() : "#";
    const pubDateRaw = pubDateMatch ? pubDateMatch[1].trim() : "";
    const source = sourceMatch ? sourceMatch[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : "Media Nasional";

    let snippet = descMatch
      ? descMatch[1]
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/\s+/g, " ")
          .trim()
      : "";

    if (snippet.length > 200) snippet = `${snippet.slice(0, 197)}...`;

    const isoDate = pubDateRaw && !Number.isNaN(Date.parse(pubDateRaw))
      ? new Date(pubDateRaw).toISOString()
      : new Date().toISOString();

    return {
      id: `news-rss-${index}-${Date.parse(isoDate)}`,
      title: rawTitle,
      source,
      url,
      publishedAt: isoDate,
      snippet: snippet || rawTitle,
    };
  });
}

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

async function fetchFromNewsApi(key: string): Promise<NewsArticle[]> {
  const q = encodeURIComponent("kebakaran hutan OR karhutla OR BMKG");
  const url = `https://newsapi.org/v2/everything?q=${q}&language=id&sortBy=publishedAt&pageSize=10&apiKey=${key}`;
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

async function fetchFromRss(): Promise<NewsArticle[]> {
  const query = encodeURIComponent("kebakaran hutan lahan BMKG OR karhutla Kalimantan Barat");
  const url = `https://news.google.com/rss/search?q=${query}&hl=id&gl=ID&ceid=ID:id`;
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(NEWS_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Google News RSS HTTP ${res.status}`);
  const xml = await res.text();
  return parseRssArticles(xml);
}

export async function GET(request: Request) {
  new URL(request.url).searchParams.get("refresh");

  const apiKey = process.env.NEWS_API_KEY?.trim();

  if (apiKey) {
    try {
      const articles = await fetchFromNewsApi(apiKey);
      if (articles.length > 0) {
        return NextResponse.json(
          { ok: true, source: "newsapi", articles, updatedAt: new Date().toISOString() },
          { headers: CACHE_HEADERS },
        );
      }
    } catch {
      // Fallback to RSS on NewsAPI failure
    }
  }

  try {
    const articles = await fetchFromRss();
    return NextResponse.json(
      { ok: true, source: "rss-bmkg", articles, updatedAt: new Date().toISOString() },
      { headers: CACHE_HEADERS },
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
