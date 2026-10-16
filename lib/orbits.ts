"use client";

import { trackedJson } from "@/lib/apiHealth";
import type { SatellitesPayload, SatelliteTrack } from "@/lib/satellites";

/** Refetch before the server's 110-minute sample window runs out. */
const REFRESH_MS = 60 * 60_000;
/** Ground track drawn behind and ahead of each satellite, minutes. */
const TRACK_PAST_MIN = 40;
const TRACK_AHEAD_MIN = 20;

export interface OrbitModel {
  startMs: number;
  stepMs: number;
  sats: SatelliteTrack[];
  fetchedAt: string;
}

let model: Promise<OrbitModel | null> | null = null;
let loadedAt = 0;

/** Sampled positions from /api/satellites (SGP4 runs on the server). */
export function loadOrbits(): Promise<OrbitModel | null> {
  if (model && Date.now() - loadedAt > REFRESH_MS) model = null;
  model ??= trackedJson<SatellitesPayload>("satellites", "/api/satellites", {
    isOk: (j) => j.ok === true,
    count: (j) => j.sats?.length ?? null,
  })
    .then((j) => {
      loadedAt = Date.now();
      return j.ok ? { startMs: Date.parse(j.start), stepMs: j.stepS * 1000, sats: j.sats, fetchedAt: j.fetchedAt } : null;
    })
    .catch(() => {
      model = null;
      return null;
    });
  return model;
}

/** Linear interpolation between the two samples around `at`, across the antimeridian if needed. */
export function positionAt(m: OrbitModel, s: SatelliteTrack, at: number): { lng: number; lat: number; altKm: number } | null {
  const f = (at - m.startMs) / m.stepMs;
  const i = Math.floor(f);
  if (i < 0 || i + 1 >= s.lat.length) return null;
  const k = f - i;
  let dLng = s.lng[i + 1] - s.lng[i];
  if (dLng > 180) dLng -= 360;
  if (dLng < -180) dLng += 360;
  let lng = s.lng[i] + dLng * k;
  if (lng > 180) lng -= 360;
  if (lng < -180) lng += 360;
  return { lng, lat: s.lat[i] + (s.lat[i + 1] - s.lat[i]) * k, altKm: s.altKm[i] + (s.altKm[i + 1] - s.altKm[i]) * k };
}

/** Ground track around `at`, longitudes unwrapped and anchored to the satellite's current world copy. */
export function trackAround(m: OrbitModel, s: SatelliteTrack, at: number): [number, number][] {
  const from = Math.max(0, Math.floor((at - TRACK_PAST_MIN * 60_000 - m.startMs) / m.stepMs));
  const to = Math.min(s.lat.length - 1, Math.ceil((at + TRACK_AHEAD_MIN * 60_000 - m.startMs) / m.stepMs));
  const now = Math.min(to, Math.max(from, Math.round((at - m.startMs) / m.stepMs)));
  const coords: [number, number][] = [];
  let offset = 0;
  let offsetNow = 0;
  for (let i = from; i <= to; i++) {
    if (i > from && Math.abs(s.lng[i] - s.lng[i - 1]) > 180) offset += s.lng[i] < s.lng[i - 1] ? 360 : -360;
    if (i === now) offsetNow = offset;
    coords.push([s.lng[i] + offset, s.lat[i]]);
  }
  for (const c of coords) c[0] -= offsetNow;
  return coords;
}
