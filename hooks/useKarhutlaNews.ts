"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NewsArticle } from "@/lib/news";
import { reportFeed } from "@/lib/apiHealth";

export interface KarhutlaNewsState {
  articles: NewsArticle[];
  loading: boolean;
  error: string | null;
  updatedAt: string;
  hasNews: boolean;
  refresh: () => Promise<void>;
}

export function useKarhutlaNews(): KarhutlaNewsState {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);

  const fetchNews = useCallback(async (isRefresh = false) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    const started = performance.now();
    let res: Response | null = null;
    try {
      const url = isRefresh ? "/api/news?refresh=1" : "/api/news";
      res = await fetch(url, {
        cache: "no-store",
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      if (!data.ok || !Array.isArray(data.articles)) {
        throw new Error(data.error || "Gagal memuat berita terkini");
      }

      setArticles(data.articles);
      setUpdatedAt(data.updatedAt || new Date().toISOString());
      reportFeed("news", {
        ok: true,
        roundTripMs: Math.round(performance.now() - started),
        upstreamMs: Number(res.headers.get("x-upstream-ms")) || null,
        items: data.articles.length,
        error: null,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      // A failed refresh keeps the articles already shown
      setError(err instanceof Error ? err.message : "Gagal memuat berita terkini");
      reportFeed("news", {
        ok: false,
        roundTripMs: Math.round(performance.now() - started),
        upstreamMs: Number(res?.headers.get("x-upstream-ms")) || null,
        items: null,
        error: err instanceof Error ? err.message : "Gagal memuat berita",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchNews(false);
    return () => {
      abortRef.current?.abort();
    };
  }, [fetchNews]);

  const refresh = useCallback(async () => {
    await fetchNews(true);
  }, [fetchNews]);

  return {
    articles,
    loading,
    error,
    updatedAt,
    hasNews: articles.length > 0,
    refresh,
  };
}
