"use client";

import { useSyncExternalStore } from "react";

/**
 * Connection health per data feed: did the last call return data, how long
 * the browser waited for our API route, and how long that route waited on
 * the upstream provider (the `x-upstream-ms` header the routes set).
 */

export type FeedId = "firms" | "bmkg" | "grid" | "air" | "maritime" | "news" | "place" | "areas" | "population" | "crises" | "satellites";

export interface FeedHealth {
  ok: boolean;
  /** Browser to our API route and back, ms. */
  roundTripMs: number;
  /** Our server to the provider, ms; null when the answer came from the server cache. */
  upstreamMs: number | null;
  /** Items the call delivered (fires, articles, forecast areas), when meaningful. */
  items: number | null;
  at: string;
  error: string | null;
}

export const FEED_LABEL: Record<FeedId, string> = {
  firms: "NASA FIRMS",
  bmkg: "BMKG cuaca",
  grid: "Cuaca per area",
  air: "Kualitas udara",
  maritime: "BMKG maritim",
  news: "Berita karhutla",
  place: "Permukiman OSM",
  areas: "Wilayah & berita area",
  population: "Penduduk WorldPop",
  crises: "Krisis nasional",
  satellites: "Orbit satelit (CelesTrak)",
};

let snapshot: Partial<Record<FeedId, FeedHealth>> = {};
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function reportFeed(id: FeedId, health: Omit<FeedHealth, "at">) {
  snapshot = { ...snapshot, [id]: { ...health, at: new Date().toISOString() } };
  emit();
}

/**
 * fetch + timing. Resolves with the parsed JSON (or throws) and records the
 * outcome; `count` turns the JSON into an item count, `isOk` decides whether
 * the payload counts as data received.
 */
export async function trackedJson<T = unknown>(
  id: FeedId,
  url: string,
  options: { count?: (json: T) => number | null; isOk?: (json: T, res: Response) => boolean } = {},
): Promise<T> {
  const started = performance.now();
  try {
    const res = await fetch(url, { cache: "no-store" });
    const json = (await res.json()) as T;
    const upstream = res.headers.get("x-upstream-ms");
    const ok = options.isOk ? options.isOk(json, res) : res.ok;
    const errorText =
      typeof json === "object" && json !== null && "error" in json
        ? String((json as { error: unknown }).error)
        : typeof json === "object" && json !== null && "reason" in json && (json as { reason: unknown }).reason
          ? String((json as { reason: unknown }).reason)
          : `HTTP ${res.status}`;
    reportFeed(id, {
      ok,
      roundTripMs: Math.round(performance.now() - started),
      upstreamMs: upstream !== null && upstream !== "" ? Number(upstream) : null,
      items: options.count ? options.count(json) : null,
      error: ok ? null : errorText,
    });
    return json;
  } catch (err) {
    reportFeed(id, {
      ok: false,
      roundTripMs: Math.round(performance.now() - started),
      upstreamMs: null,
      items: null,
      error: err instanceof Error ? err.message : "Jaringan gagal",
    });
    throw err;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const EMPTY: Partial<Record<FeedId, FeedHealth>> = {};

export function useApiHealth(): Partial<Record<FeedId, FeedHealth>> {
  return useSyncExternalStore(subscribe, () => snapshot, () => EMPTY);
}
