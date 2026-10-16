"use client";

import { useEffect, useSyncExternalStore } from "react";
import { trackedJson } from "@/lib/apiHealth";
import type { CrisesPayload } from "@/lib/crises";

const REFRESH_MS = 15 * 60_000;

export interface CrisesState {
  status: "loading" | "ok" | "error";
  data: CrisesPayload | null;
}

// One fetch shared by every component on the page (dashboard, presentation, map)
let shared: CrisesState = { status: "loading", data: null };
let inflight: Promise<void> | null = null;
let lastAt = 0;
const listeners = new Set<() => void>();

function set(next: CrisesState) {
  shared = next;
  for (const l of listeners) l();
}

function load(): Promise<void> {
  inflight ??= trackedJson<CrisesPayload>("crises", "/api/crises", {
    isOk: (j) => j.ok === true,
    count: (j) => j.events?.length ?? null,
  })
    .then((data) => {
      lastAt = Date.now();
      // A failed refresh keeps showing the last good answer
      if (data.ok || !shared.data) set({ status: data.ok ? "ok" : "error", data });
    })
    .catch(() => {
      if (!shared.data) set({ status: "error", data: null });
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const SERVER: CrisesState = { status: "loading", data: null };

/** National crises, government response and public voices (refreshed every 15 minutes). */
export function useCrises(): CrisesState {
  const state = useSyncExternalStore(subscribe, () => shared, () => SERVER);
  useEffect(() => {
    const due = () => Date.now() - lastAt > REFRESH_MS - 5_000;
    if (due()) void load();
    // Several components mount this hook; only the first due tick fetches
    const timer = window.setInterval(() => due() && void load(), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return state;
}
