"use client";

import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import PresentationMode, { type Cut, type PresentationLayers } from "@/components/dashboard/PresentationMode";
import type { CameraShot } from "@/components/map/types";
import { cellKey, useIncidents } from "@/hooks/useIncidents";
import { useCrises } from "@/hooks/useCrises";
import { useKarhutlaNews } from "@/hooks/useKarhutlaNews";
import { buildDangerAreas } from "@/lib/dangerAreas";
import { useApiHealth } from "@/lib/apiHealth";

const MapLibreMap = dynamic(() => import("@/components/map/MapLibreMap"), { ssr: false });

/** Waits this long at most for slow feeds; scenes without their data are then left out. */
const MAX_WAIT_MS = 90_000;
/** A recording has no audience waiting, so it holds out longer for complete data. */
const MAX_WAIT_RECORDING_MS = 180_000;
/** Areas with every figure loaded that the full cut wants before it starts. */
const WANT_AREAS = 5;

const noop = () => {};

declare global {
  interface Window {
    __gwStarted?: number;
    __gwDone?: boolean;
  }
}

/**
 * Stand-alone presentation (and the page the video recorder drives). It
 * loads every feed for the whole of Indonesia in the background, shows what
 * is still arriving, and starts the tour only once the data is in, so the
 * script is written from complete data rather than from what one view saw.
 */
export default function PresentClient() {
  const params = useSearchParams();
  const router = useRouter();
  const cut: Cut = params.get("cut") === "short" ? "short" : "full";
  const recording = params.get("record") === "1";
  const musicCredit = params.get("music") ?? undefined;

  const inc = useIncidents();
  const crises = useCrises();
  const news = useKarhutlaNews();
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [hourOffset, setHourOffset] = useState(0);
  const [camera, setCamera] = useState<CameraShot | null>(null);
  const [layers, setLayers] = useState<PresentationLayers>({ crises: false, satellites: true });
  const [started, setStarted] = useState(false);
  const [startedAt] = useState(() => performance.now());
  const [now, setNow] = useState(startedAt);

  const areas = useMemo(
    () =>
      buildDangerAreas({
        incidents: inc.incidents,
        regions: inc.regions,
        areaNews: inc.areaNews,
        air: inc.air,
        population: inc.population,
        cellOf: cellKey,
      }),
    [inc.incidents, inc.regions, inc.areaNews, inc.air, inc.population],
  );

  const named = areas.filter((a) => !a.id.startsWith("cell:"));
  const health = useApiHealth();
  const completeAreas = named.filter((a) => a.air?.usAqi != null).length;
  const counted = named.filter((a) => a.peopleDanger !== null).length;
  // WorldPop outages are common; once it has failed, wait no longer for headcounts
  const populationSettled = counted >= Math.min(WANT_AREAS, named.length) || health.population?.ok === false;
  const checks = [
    { label: "Fire detections · NASA FIRMS", done: inc.firms.status !== "loading" },
    { label: "Wind & humidity per area · BMKG / Open-Meteo", done: inc.incidents.length > 0 && inc.pendingWeather === 0 },
    { label: "Named areas & local news", done: named.length > 0 && named.length >= Math.min(areas.length, 8) },
    { label: "Air in priority zones · Copernicus CAMS", done: named.length > 0 && completeAreas >= Math.min(WANT_AREAS, named.length) },
    { label: "People in danger zones · WorldPop", done: named.length > 0 && populationSettled },
    { label: "National crises, government, voices", done: crises.status !== "loading" },
    { label: "Karhutla news", done: !news.loading },
    { label: "3D map", done: mapReady },
  ];
  const allDone = checks.every((c) => c.done);
  // The recorder logs which feed held the start back
  useEffect(() => {
    (window as Window & { __gwChecks?: string[] }).__gwChecks = checks.filter((c) => !c.done).map((c) => c.label);
  });
  const maxWait = recording ? MAX_WAIT_RECORDING_MS : MAX_WAIT_MS;
  const timedOut = now - startedAt > maxWait;

  useEffect(() => {
    if (started) return;
    const t = window.setInterval(() => setNow(performance.now()), 500);
    return () => window.clearInterval(t);
  }, [started]);

  useEffect(() => {
    // Weather lands a beat after the fires; a short settle lets the last batch arrive
    if (started || !mapReady || inc.firms.status === "loading") return;
    if (allDone || timedOut) {
      const t = window.setTimeout(() => {
        setStarted(true);
        window.__gwStarted = performance.now();
      }, allDone ? 1200 : 0);
      return () => window.clearTimeout(t);
    }
  }, [allDone, timedOut, started, mapReady, inc.firms.status]);

  const exit = useCallback(() => router.push("/"), [router]);
  const finish = useCallback(() => {
    window.__gwDone = true;
  }, []);

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-slate-950 text-slate-100">
      <div className="absolute inset-0">
        <MapLibreMap
          incidents={inc.incidents}
          hotspots={inc.hotspots}
          air={inc.air}
          selectedId={inc.selectedId}
          focusId={null}
          camera={camera}
          chromeless
          hourOffset={hourOffset}
          mapStyle="dark"
          crises={crises.data?.events}
          showCrises={layers.crises}
          showSatellites={layers.satellites}
          onSelectIncident={inc.selectIncident}
          // The background loader's viewport stays on Indonesia whatever the camera does
          onViewportChange={noop}
          onReady={() => setMapReady(true)}
          onFail={(r) => setMapError(r)}
        />
      </div>

      <AnimatePresence>
        {!started && (
          <motion.div
            key="prep"
            className="absolute inset-0 z-40 flex items-center bg-gradient-to-r from-slate-950 via-slate-950/80 to-slate-950/10 px-8 sm:px-16"
            exit={{ opacity: 0, transition: { duration: 0.9 } }}
            role="status"
            aria-live="polite"
          >
            <div className="w-full max-w-lg">
              <p className="text-3xl font-bold tracking-tight">GambutWatch</p>
              <p className="mt-1 text-lg text-slate-200">
                {cut === "short" ? "60-second briefing" : "Full briefing"} · loading every feed for Indonesia
              </p>
              <p className="text-sm text-slate-400">Memuat semua data Indonesia di latar. Adegan tanpa data lengkap dilewati.</p>
              {mapError ? (
                <p className="mt-6 text-sm text-orange-300">Peta 3D tidak bisa dimuat: {mapError}</p>
              ) : (
                <ul className="mt-7 space-y-2.5">
                  {checks.map((c) => (
                    <li key={c.label} className="flex items-center gap-3 text-sm">
                      <span
                        className={`grid size-4 shrink-0 place-items-center rounded-full border ${
                          c.done ? "border-emerald-400 bg-emerald-400/20" : "border-white/25"
                        }`}
                        aria-hidden
                      >
                        {c.done ? (
                          <span className="size-1.5 rounded-full bg-emerald-300" />
                        ) : (
                          <span className="size-1.5 animate-pulse rounded-full bg-slate-400 motion-reduce:animate-none" />
                        )}
                      </span>
                      <span className={c.done ? "text-slate-100" : "text-slate-400"}>{c.label}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-6 text-xs text-slate-400 tabular-nums">
                {inc.incidents.length.toLocaleString("id-ID")} fires simulated · {completeAreas} complete areas ·{" "}
                {((now - startedAt) / 1000).toFixed(0)} s
                {!allDone && ` · starts by ${maxWait / 1000} s with what is ready`}
              </p>
              {!recording && (
                <button
                  type="button"
                  onClick={() => setStarted(true)}
                  disabled={!mapReady || inc.incidents.length === 0}
                  className="mt-4 rounded-md border border-white/15 px-3 py-2 text-sm text-slate-100 hover:bg-white/10 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
                >
                  Start with what is ready
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {started && (
        <PresentationMode
          cut={cut}
          areas={areas}
          viewStats={inc.viewStats}
          incidents={inc.incidents}
          statusCounts={inc.statusCounts}
          firms={inc.firms}
          air={inc.air}
          crises={crises.data}
          news={news.articles}
          hourOffset={hourOffset}
          setHourOffset={setHourOffset}
          selectIncident={inc.selectIncident}
          setCamera={setCamera}
          setLayers={setLayers}
          onExit={exit}
          recording={recording}
          onFinished={finish}
          musicCredit={musicCredit}
        />
      )}
    </div>
  );
}
