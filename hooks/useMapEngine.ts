"use client";

import { useCallback, useEffect, useState } from "react";

export type MapEngine = "maplibre" | "leaflet";

export type MapEngineState =
  // Leaflet is shown while MapLibre initialises underneath
  | { status: "loading" }
  // MapLibre is up and visible
  | { status: "ready" }
  // MapLibre failed (no WebGL, timeout, context lost) — Leaflet stays for the session
  | { status: "fallback"; reason: string };

export const MAPLIBRE_TIMEOUT_MS = 15_000;

/**
 * Two map engines:
 * 1. MapLibre GL — primary. WebGL vector map: rotation, pitch up to 85°, 3D buildings, terrain, lighting.
 * 2. Leaflet — backup. Raster tiles, no WebGL. Shown first while MapLibre loads, and kept if MapLibre
 *    fails (no WebGL, MAPLIBRE_TIMEOUT_MS elapsed, or the WebGL context is lost).
 */
export function useMapEngine(timeoutMs = MAPLIBRE_TIMEOUT_MS) {
  const [state, setState] = useState<MapEngineState>({ status: "loading" });

  const markReady = useCallback(() => {
    // A late load after a timeout fallback is ignored; the fallback is sticky
    setState((s) => (s.status === "loading" ? { status: "ready" } : s));
  }, []);

  const markFailed = useCallback((reason: string) => {
    setState((s) => (s.status === "fallback" ? s : { status: "fallback", reason }));
  }, []);

  useEffect(() => {
    if (state.status !== "loading") return;
    const id = setTimeout(
      () => markFailed(`MapLibre did not load within ${timeoutMs / 1000}s`),
      timeoutMs,
    );
    return () => clearTimeout(id);
  }, [state.status, timeoutMs, markFailed]);

  const engine: MapEngine = state.status === "ready" ? "maplibre" : "leaflet";
  return { engine, state, markReady, markFailed };
}
