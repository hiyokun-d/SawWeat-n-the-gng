"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NewsArticle } from "@/app/api/news/route";

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

    try {
      const url = isRefresh ? "/api/news?refresh=1" : "/api/news";
      const res = await fetch(url, {
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
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      setArticles([]);
      setError(err instanceof Error ? err.message : "Gagal memuat berita terkini");
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
