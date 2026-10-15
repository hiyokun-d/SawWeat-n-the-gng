"use client";

import { useSyncExternalStore } from "react";

/**
 * Wall clock that ticks once a minute, shared by every component. Null on the
 * server and during hydration, since `new Date()` must not run in prerender.
 */
let now: Date | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    now = new Date();
    timer = setInterval(() => {
      now = new Date();
      for (const l of listeners) l();
    }, 60_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function useNow(): Date | null {
  return useSyncExternalStore(
    subscribe,
    () => now,
    () => null,
  );
}
