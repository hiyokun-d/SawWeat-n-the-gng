"use client";

import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import { ChevronLeftIcon, ChevronRightIcon, NavigationIcon, PauseIcon, PlayIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cellKey, type FirmsState, type ViewStats } from "@/hooks/useIncidents";
import {
  aqiBand,
  aqiTextColor,
  compassName,
  FIRE_STATUS_COLOR,
  FIRE_STATUS_LABEL,
  FIRE_STATUS_ORDER,
  THREAT_COLOR,
  type AirQuality,
  type FireStatus,
  type HotspotIncident,
} from "@/lib/gambut";
import { stepPolygonFor, weatherAtHour } from "@/lib/simulationEngine";
import { type DangerArea } from "@/lib/dangerAreas";
import {
  CRISIS_LABEL,
  GOV_ACTION_LABEL,
  SEVERITY_COLOR,
  SEVERITY_LABEL,
  type CrisesPayload,
  type GovAction,
} from "@/lib/crises";
import { FIRE_SATELLITES, FLEET_COST } from "@/lib/satellites";
import {
  NewsWire,
  OrbitFunnel,
  PeatSection,
  PmVersusWho,
  ResponseBoard,
  SatelliteFleet,
  SpreadPolar,
  YearContext,
  CONTEXT,
} from "./Explainers";
import type { NewsArticle } from "@/lib/news";
import type { CameraShot } from "@/components/map/types";
import { INDONESIA_CENTER } from "@/components/map/types";
import { CRISIS_ICON } from "@/components/map/crisisMarkers";
import { HourBars, StatusBar } from "./DangerAreas";

/** English headlines get English digit grouping (11,678 not 11.678) so no reader misreads a decimal. */
const fmt = (n: number, digits = 0) =>
  n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

const COMPASS_EN = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
const compassEn = (deg: number) => COMPASS_EN[Math.round((((deg % 360) + 360) % 360) / 45) % 8];


export type Cut = "short" | "full";

type SceneKind =
  | "intro"
  | "satellites"
  | "context"
  | "peat"
  | "urgency"
  | "response"
  | "area"
  | "fire"
  | "air"
  | "crises"
  | "news"
  | "government"
  | "voices"
  | "close";

interface Scene {
  kind: SceneKind;
  ms: number;
  areaId?: string;
  incidentId?: string;
  rank?: number;
}

/** Camera flight before the spread playback starts in a fire scene. */
const FLIGHT_MS = 3500;
const HOUR_STEP_MS = 700;
const FIRE_MS = FLIGHT_MS + 13 * HOUR_STEP_MS + 1500;
const SHORT_TOTAL_MS = 60_000;

export interface PresentationLayers {
  crises: boolean;
  satellites: boolean;
}

export interface PresentationModeProps {
  cut: Cut;
  areas: DangerArea[];
  viewStats: ViewStats;
  incidents: HotspotIncident[];
  statusCounts: { world: Record<FireStatus, number>; indonesia: Record<FireStatus, number> };
  firms: FirmsState;
  air: Record<string, AirQuality>;
  crises: CrisesPayload | null;
  news: NewsArticle[];
  hourOffset: number;
  setHourOffset: (h: number) => void;
  selectIncident: (id: string) => void;
  setCamera: (shot: CameraShot) => void;
  setLayers: (layers: PresentationLayers) => void;
  onExit: () => void;
  /** Recording: no controls, no loop; called once after the last scene. */
  recording?: boolean;
  onFinished?: () => void;
  /** Shown on the closing card (music attribution is required by its license). */
  musicCredit?: string;
}

/** An area gets a scene once it is named and its air is measured; headcounts show only where WorldPop answered. */
function complete(a: DangerArea): boolean {
  return !a.id.startsWith("cell:") && a.air?.usAqi != null;
}

function buildScript(p: PresentationModeProps): Scene[] {
  const ready = p.areas.filter(complete);
  const crisesOk = (p.crises?.events.length ?? 0) > 0;
  const airOk = ready.length > 0;
  if (p.cut === "short") {
    const zones = ready.slice(0, 3);
    const fixed: Scene[] = [
      { kind: "intro", ms: 6000 },
      { kind: "urgency", ms: 8000 },
    ];
    const tail: Scene[] = [...(airOk ? [{ kind: "air" as const, ms: 7000 }] : []), { kind: "close", ms: 9000 }];
    const used = [...fixed, ...tail].reduce((s, x) => s + x.ms, 0);
    const zoneMs = zones.length ? Math.min(14_000, Math.floor((SHORT_TOTAL_MS - used) / zones.length)) : 0;
    // Whatever the zones do not use goes to the closing card, so the cut is always 60 s
    tail[tail.length - 1].ms += SHORT_TOTAL_MS - used - zoneMs * zones.length;
    return [
      ...fixed,
      ...zones.map((a, rank) => ({ kind: "area" as const, ms: zoneMs, areaId: a.id, rank })),
      ...tail,
    ];
  }
  // Full briefing, about 3:20 to sit inside its music track; scenes without data drop out
  const zones = ready.slice(0, 5);
  const hidden = p.statusCounts.indonesia.SUSPECTED_SMOLDERING + p.statusCounts.indonesia.CONFIRMED_SMOLDERING;
  return [
    { kind: "intro", ms: 8000 },
    ...(p.firms.sources.length ? [{ kind: "satellites" as const, ms: 11_000 }] : []),
    { kind: "context", ms: 11_000 },
    ...(hidden > 0 ? [{ kind: "peat" as const, ms: 12_000 }] : []),
    { kind: "urgency", ms: 10_000 },
    ...zones.flatMap((a, rank): Scene[] => {
      const top = rank < 2 ? a.incidents.find((i) => i.status !== "EXTINGUISHED") : undefined;
      return [
        { kind: "area", ms: 10_000, areaId: a.id, rank },
        ...(top ? [{ kind: "fire" as const, ms: FIRE_MS, areaId: a.id, incidentId: top.id }] : []),
      ];
    }),
    ...(airOk ? [{ kind: "air" as const, ms: 11_000 }] : []),
    ...(zones.length ? [{ kind: "response" as const, ms: 11_000 }] : []),
    ...(crisesOk ? [{ kind: "crises" as const, ms: 12_000 }] : []),
    ...(p.news.length ? [{ kind: "news" as const, ms: 11_000 }] : []),
    ...(p.crises?.government.length ? [{ kind: "government" as const, ms: 10_000 }] : []),
    ...(p.crises?.voices.length ? [{ kind: "voices" as const, ms: 9000 }] : []),
    { kind: "close", ms: 9000 },
  ];
}

const LAYERS: Record<SceneKind, PresentationLayers> = {
  intro: { crises: false, satellites: true },
  satellites: { crises: false, satellites: true },
  context: { crises: false, satellites: false },
  peat: { crises: false, satellites: false },
  urgency: { crises: false, satellites: false },
  response: { crises: false, satellites: false },
  area: { crises: false, satellites: false },
  fire: { crises: false, satellites: false },
  air: { crises: false, satellites: false },
  crises: { crises: true, satellites: false },
  news: { crises: false, satellites: false },
  government: { crises: false, satellites: false },
  voices: { crises: false, satellites: false },
  close: { crises: false, satellites: true },
};

/** Chapter names, English first (judges), Indonesian second (the people it is for). */
const CHAPTER: Record<SceneKind, [string, string]> = {
  intro: ["Right now", "Saat ini"],
  satellites: ["Eyes in orbit", "Mata di orbit"],
  context: ["This year", "Tahun ini"],
  peat: ["Fire you cannot see", "Api yang tak terlihat"],
  response: ["Holding the line", "Menahan laju api"],
  urgency: ["The next 12 hours", "12 jam ke depan"],
  area: ["Priority zone", "Zona prioritas"],
  fire: ["Spread forecast", "Proyeksi rambatan"],
  air: ["The air people breathe", "Udara yang dihirup warga"],
  crises: ["Everything else", "Krisis lain"],
  news: ["Newsrooms", "Pemberitaan"],
  government: ["Government response", "Respons pemerintah"],
  voices: ["Public voices", "Suara publik"],
  close: ["What we do", "Yang kami kerjakan"],
};

function centroid(a: DangerArea): [number, number] {
  const lat = a.incidents.reduce((s, i) => s + i.originLat, 0) / a.incidents.length;
  const lng = a.incidents.reduce((s, i) => s + i.originLng, 0) / a.incidents.length;
  return [lng, lat];
}

/**
 * Cinematic tour for pitches, wall screens and the exported videos. The
 * script is fixed when the tour starts from the data already preloaded in
 * the background; a scene whose data has not arrived is left out instead of
 * being shown half empty.
 */
export default function PresentationMode(props: PresentationModeProps) {
  const { areas, incidents, hourOffset, setHourOffset, selectIncident, setCamera, setLayers, onExit, recording, onFinished } =
    props;
  const reduced = (useReducedMotion() ?? false) && !recording;
  const [scenes] = useState<Scene[]>(() => buildScript(props));
  // The recorder logs the script and what it was built from, so a dropped scene is explainable
  useEffect(() => {
    (window as Window & { __gwScript?: unknown }).__gwScript = {
      scenes: scenes.map((x) => x.kind),
      areas: props.areas.length,
      completeAreas: props.areas.filter(complete).length,
      crises: props.crises?.events.length ?? null,
      news: props.news.length,
    };
    // Once per tour
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [portrait, setPortrait] = useState(false);
  const seq = useRef(0);
  const scene = scenes[index];
  const finished = useRef(false);

  useEffect(() => {
    const check = () => setPortrait(window.innerHeight > window.innerWidth * 1.1);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const areaById = useMemo(() => new Map(areas.map((a) => [a.id, a])), [areas]);
  const incidentById = useMemo(() => new Map(incidents.map((i) => [i.id, i])), [incidents]);

  const go = useCallback(
    (delta: number) =>
      setIndex((i) => {
        const next = i + delta;
        if (recording && next >= scenes.length) {
          if (!finished.current) {
            finished.current = true;
            queueMicrotask(() => onFinished?.());
          }
          return i;
        }
        return (next + scenes.length) % scenes.length;
      }),
    [scenes.length, recording, onFinished],
  );

  // Camera, layers and selection when a scene starts; a second, slower shot keeps the frame alive
  useEffect(() => {
    const timers: number[] = [];
    const shot = (s: Omit<CameraShot, "seq" | "duration">, ms: number, at = 0) => {
      const fire = () => {
        seq.current += 1;
        setCamera({ ...s, seq: seq.current, duration: reduced ? 0 : ms });
      };
      if (at === 0) fire();
      else timers.push(window.setTimeout(fire, at));
    };
    setHourOffset(0);
    setLayers(LAYERS[scene.kind]);
    // Portrait frames are narrow: pull back so the same area fits the width
    const z = (zoom: number) => (portrait ? zoom - 0.9 : zoom);
    const ms = scene.ms;
    switch (scene.kind) {
      case "intro":
        shot({ center: [100, 0], zoom: 1.5, pitch: 0, bearing: 0 }, 0);
        shot({ center: INDONESIA_CENTER, zoom: z(4.3), pitch: 15, bearing: 0 }, ms - 1200, 300);
        break;
      case "satellites":
        shot({ center: [118, -2], zoom: 2.1, pitch: 0, bearing: 0 }, 2500);
        shot({ center: [135, -2], zoom: 2.3, pitch: 0, bearing: 0 }, ms - 2600, 2500);
        break;
      case "context":
        shot({ center: [112, -1.5], zoom: z(4.9), pitch: 38, bearing: -20 }, 3200);
        shot({ center: [114, -1.5], zoom: z(5.1), pitch: 44, bearing: -6 }, ms - 3200, 3200);
        break;
      case "peat":
      case "response": {
        const a = areas.find(complete);
        if (a) {
          const c = centroid(a);
          const close = scene.kind === "peat";
          shot({ center: c, zoom: z(close ? 10.4 : 7.4), pitch: close ? 64 : 48, bearing: close ? 40 : -25 }, 3800);
          shot({ center: c, zoom: z(close ? 10.8 : 7.7), pitch: close ? 66 : 52, bearing: close ? 62 : -8 }, ms - 3800, 3800);
        }
        break;
      }
      case "urgency":
        shot({ center: INDONESIA_CENTER, zoom: z(4.8), pitch: 45, bearing: -12 }, 3200);
        shot({ center: [INDONESIA_CENTER[0] + 2, INDONESIA_CENTER[1]], zoom: z(4.9), pitch: 50, bearing: 4 }, ms - 3200, 3200);
        break;
      case "area": {
        const a = areaById.get(scene.areaId!);
        if (a) {
          const c = centroid(a);
          const b = ((scene.rank ?? 0) * 37) % 60 - 30;
          shot({ center: c, zoom: z(8.6), pitch: 52, bearing: b }, 3800);
          shot({ center: c, zoom: z(9.1), pitch: 58, bearing: b + 18 }, ms - 3800, 3800);
        }
        break;
      }
      case "fire": {
        const i = incidentById.get(scene.incidentId!);
        if (i) {
          selectIncident(i.id);
          // Look along the wind so the spread grows away from the viewer
          shot({ center: [i.originLng, i.originLat], zoom: z(12.2), pitch: 62, bearing: i.weather.windVectorDeg }, FLIGHT_MS);
        }
        break;
      }
      case "air":
        shot({ center: [110, -1], zoom: z(5), pitch: 30, bearing: 8 }, 3200);
        break;
      case "crises":
        shot({ center: [118, -3], zoom: z(4.3), pitch: 0, bearing: 0 }, 3000);
        break;
      case "news":
      case "government":
      case "voices": {
        const a = areas.find(complete);
        const c = a ? centroid(a) : INDONESIA_CENTER;
        const offset = scene.kind === "news" ? -14 : scene.kind === "government" ? 10 : 28;
        shot({ center: c, zoom: z(6.4), pitch: 55, bearing: offset }, 3500);
        shot({ center: c, zoom: z(6.8), pitch: 58, bearing: offset + 14 }, ms - 3500, 3500);
        break;
      }
      case "close":
        shot({ center: [117, -2], zoom: portrait ? 1.6 : 2.3, pitch: 0, bearing: 0 }, 5000);
        break;
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
    // Scene start only; refreshed data mid-scene must not re-fly the camera
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, portrait]);

  // Scene clock: one timeout per scene plus an hour ticker in fire scenes. Pausing keeps the remaining time.
  const remaining = useRef(0);
  const startedAt = useRef(0);
  useEffect(() => {
    remaining.current = scene.ms;
  }, [index, scene.ms]);
  useEffect(() => {
    if (paused) return;
    startedAt.current = performance.now();
    const end = window.setTimeout(() => go(1), remaining.current);
    let ticker = 0;
    if (scene.kind === "fire") {
      ticker = window.setInterval(() => {
        const t = scene.ms - remaining.current + (performance.now() - startedAt.current);
        if (t > FLIGHT_MS) setHourOffset(Math.min(12, Math.floor((t - FLIGHT_MS) / HOUR_STEP_MS)));
      }, HOUR_STEP_MS / 2);
    }
    return () => {
      window.clearTimeout(end);
      window.clearInterval(ticker);
      remaining.current = Math.max(0, remaining.current - (performance.now() - startedAt.current));
    };
  }, [index, paused, go, scene, setHourOffset]);

  useEffect(() => {
    if (recording) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
      else if (e.key === " ") {
        e.preventDefault();
        setPaused((p) => !p);
      } else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onExit, recording]);

  const area = scene.areaId ? areaById.get(scene.areaId) : undefined;
  const chapter = CHAPTER[scene.kind];
  const dataAt = props.firms.fetchedAt ? new Date(props.firms.fetchedAt) : null;

  return (
    <div className="pointer-events-none absolute inset-0 z-30" role="region" aria-label="Mode presentasi">
      {/* Scrims: top for the brand line, bottom for the story; the map stays clear in between */}
      <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-slate-950/85 to-transparent" />
      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/95 via-slate-950/60 to-transparent ${
          portrait ? "h-[72%]" : "h-[62%]"
        }`}
      />

      {/* Brand + data timestamp: every frame says what it is and when the data is from */}
      <div className={`absolute top-0 left-0 flex items-center gap-3 ${portrait ? "p-8" : "p-6"}`}>
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-60 motion-reduce:animate-none" />
          <span className="relative inline-flex size-2.5 rounded-full bg-red-500" />
        </span>
        <div className="leading-tight">
          <p className={`font-bold tracking-tight text-white ${portrait ? "text-2xl" : "text-lg"}`}>GambutWatch</p>
          {dataAt && (
            <p className={`text-slate-300 tabular-nums ${portrait ? "text-base" : "text-xs"}`}>
              Live data · NASA FIRMS{" "}
              {dataAt.toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} WIB
            </p>
          )}
        </div>
      </div>

      {!recording && (
        <div className="pointer-events-auto absolute top-3 right-3 flex items-center gap-1 rounded-lg border border-white/10 bg-slate-950/70 p-1 backdrop-blur">
          <span className="px-2 text-xs tabular-nums text-slate-300">
            {index + 1}/{scenes.length}
          </span>
          <Button size="icon-sm" variant="ghost" aria-label="Adegan sebelumnya" onClick={() => go(-1)}>
            <ChevronLeftIcon />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={paused ? "Lanjutkan presentasi" : "Jeda presentasi"}
            onClick={() => setPaused((p) => !p)}
          >
            {paused ? <PlayIcon /> : <PauseIcon />}
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Adegan berikutnya" onClick={() => go(1)}>
            <ChevronRightIcon />
          </Button>
          <Button size="sm" variant="ghost" onClick={onExit} className="gap-1 text-xs">
            <XIcon className="size-3.5" />
            Keluar (Esc)
          </Button>
        </div>
      )}

      <div className={`absolute ${portrait ? "inset-x-8 bottom-12" : "inset-x-10 bottom-8"}`}>
        <AnimatePresence mode="wait">
          <motion.div
            key={index}
            initial="hidden"
            animate="show"
            exit="exit"
            variants={sceneVariants(reduced)}
          >
            <motion.p variants={item(reduced)} className={`font-semibold text-orange-300 ${portrait ? "text-xl" : "text-sm"}`}>
              <span className="tabular-nums text-orange-400/80">{String(index + 1).padStart(2, "0")}</span>
              <span className="mx-2 text-white/30">/</span>
              {chapter[0]} <span className="font-normal text-orange-200/70">· {chapter[1]}</span>
            </motion.p>
            <SceneBody
              scene={scene}
              area={area}
              props={props}
              portrait={portrait}
              reduced={reduced}
              incident={scene.incidentId ? incidentById.get(scene.incidentId) : undefined}
              hourOffset={hourOffset}
            />
          </motion.div>
        </AnimatePresence>

        {/* Progress: one segment per scene, width proportional to its length */}
        <div className={`flex gap-1 ${portrait ? "mt-8" : "mt-5"}`} aria-hidden>
          {scenes.map((s, i) => (
            <div key={i} className="h-1 overflow-hidden rounded-full bg-white/15" style={{ flexGrow: s.ms }}>
              {i < index && <div className="h-full w-full bg-white/80" />}
              {i === index && (
                <div
                  key={index}
                  className="h-full bg-orange-300"
                  style={{
                    animation: `gw-progress ${s.ms}ms linear forwards`,
                    animationPlayState: paused ? "paused" : "running",
                  }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
      <style>{`@keyframes gw-progress { from { width: 0% } to { width: 100% } }`}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ motion */

// Scene change: the old story blurs away upward, the new one is wiped in from the left
// line by line. The wipe follows reading direction, so the eye lands where text begins.
const EASE = [0.2, 0.8, 0.2, 1] as const;
function sceneVariants(reduced: boolean): Variants {
  return {
    hidden: {},
    show: { transition: { staggerChildren: reduced ? 0 : 0.09, delayChildren: reduced ? 0 : 0.1 } },
    exit: reduced
      ? { opacity: 0, transition: { duration: 0.2 } }
      : { opacity: 0, y: -14, filter: "blur(6px)", transition: { duration: 0.4, ease: "easeIn" } },
  };
}
function item(reduced: boolean): Variants {
  return reduced
    ? { hidden: { opacity: 0 }, show: { opacity: 1 } }
    : {
        hidden: { opacity: 0, y: 18, clipPath: "inset(0 100% 0 0)" },
        show: { opacity: 1, y: 0, clipPath: "inset(0 0% 0 0)", transition: { duration: 0.7, ease: EASE } },
      };
}

/* ------------------------------------------------------------------ scenes */

interface BodyProps {
  scene: Scene;
  area: DangerArea | undefined;
  incident: HotspotIncident | undefined;
  props: PresentationModeProps;
  portrait: boolean;
  reduced: boolean;
  hourOffset: number;
}

function SceneBody(b: BodyProps) {
  const { scene, props: p, portrait, reduced } = b;
  const it = item(reduced);
  // The full briefing teaches with diagrams, so its side column is wider than the short cut's
  const full = p.cut === "full";
  const grid = portrait
    ? "flex flex-col gap-6"
    : `grid items-end gap-8 ${full ? "lg:grid-cols-[1fr_27rem]" : "lg:grid-cols-[1fr_24rem]"}`;
  const ic = p.statusCounts.indonesia;
  const burningNow = ic.CONFIRMED_FLAMING + ic.UNVERIFIED_HOTSPOT;
  const hiddenNow = ic.SUSPECTED_SMOLDERING + ic.CONFIRMED_SMOLDERING;

  if (scene.kind === "intro") {
    const indo = Object.values(p.statusCounts.indonesia).reduce((a, x) => a + x, 0);
    const flaming = p.statusCounts.indonesia.CONFIRMED_FLAMING + p.statusCounts.indonesia.UNVERIFIED_HOTSPOT;
    return (
      <div className={grid}>
        <div>
          <Headline it={it} portrait={portrait} en={<><CountUp value={indo} reduced={reduced} /> fire events across Indonesia</>} id="kejadian api terpantau satelit di seluruh Indonesia" />
          <motion.div variants={it} className="mt-4 max-w-xl">
            <StatusBar byStatus={p.statusCounts.indonesia} />
          </motion.div>
          <motion.ul variants={it} className={`mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-slate-200 ${portrait ? "text-lg" : "text-sm"}`}>
            {FIRE_STATUS_ORDER.map((s) => (
              <li key={s} className="flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ background: FIRE_STATUS_COLOR[s] }} />
                <span className="font-semibold tabular-nums">{fmt(p.statusCounts.indonesia[s])}</span>
                {FIRE_STATUS_LABEL[s]}
              </li>
            ))}
          </motion.ul>
        </div>
        {full ? (
          <Panel it={it} portrait={portrait} title="From orbit to fire event · Dari orbit ke titik api">
            <OrbitFunnel
              pixels={p.firms.detections}
              events={Object.values(p.statusCounts.world).reduce((a, x) => a + x, 0)}
              indonesia={indo}
              burning={burningNow}
              hidden={hiddenNow}
              portrait={portrait}
            />
            <Source>NASA FIRMS near-real-time · fused by GambutWatch</Source>
          </Panel>
        ) : (
          <Panel it={it} portrait={portrait} title="Burning or unverified now · Menyala atau belum diverifikasi">
            <p className={`font-bold tabular-nums text-red-400 ${portrait ? "text-6xl" : "text-5xl"}`}>
              <CountUp value={flaming} reduced={reduced} />
            </p>
            <Source>
              NASA FIRMS · {FIRE_SATELLITES.length} satellites · {fmt(p.firms.detections)} detection pixels
            </Source>
          </Panel>
        )}
      </div>
    );
  }

  if (scene.kind === "satellites") {
    const detections = Object.fromEntries(p.firms.sources.map((x) => [x.id, x.detections]));
    return (
      <div className={grid}>
        <div>
          <Headline it={it} portrait={portrait} en={`${FIRE_SATELLITES.length} satellites watch every fire`} id="lima satelit memantau setiap titik api, posisinya dihitung dari orbit aslinya" />
          <motion.p variants={it} className={`mt-3 max-w-2xl text-slate-300 ${portrait ? "text-lg" : "text-base"}`}>
            Each pass sweeps a 2,300 to 3,000 km strip. The dots on the globe are where each satellite is overhead right now,
            beaming toward Indonesia when it is in range.
          </motion.p>
          <motion.p variants={it} className={`mt-2 max-w-2xl text-slate-400 ${portrait ? "text-base" : "text-sm"}`}>
            Setiap lintasan menyapu jalur 2.300 sampai 3.000 km. Data api ini sampai ke kita gratis lewat NASA FIRMS.
          </motion.p>
        </div>
        <Panel it={it} portrait={portrait} title={`Who sends us the data · ${p.firms.keyed ? "24 h world, 72 h Indonesia" : "last 24 h"}`}>
          <SatelliteFleet satellites={FIRE_SATELLITES} detections={detections} costs={FLEET_COST} portrait={portrait} />
          <Source>CelesTrak orbits · NASA, NOAA, GAO mission costs</Source>
        </Panel>
      </div>
    );
  }

  if (scene.kind === "context") {
    return (
      <div className={grid}>
        <div>
          <Headline
            it={it}
            portrait={portrait}
            en={<><CountUp value={Math.round(CONTEXT.ha2026)} reduced={reduced} /> hectares burned this year, up 69%</>}
            id="hektare terbakar Januari sampai Juli 2026, naik 69% dari periode yang sama 2025"
          />
          <motion.p variants={it} className={`mt-3 max-w-2xl text-slate-300 ${portrait ? "text-lg" : "text-base"}`}>
            In 2015 the fires burned 2.6 million hectares and cost Indonesia US$16.1 billion. The haze closed schools and
            airports across the region. This season is heading the same way.
          </motion.p>
        </div>
        <Panel it={it} portrait={portrait} title="Burned area · Luas terbakar">
          <YearContext portrait={portrait} />
          <Source>SiPongi, Kementerian Kehutanan (Jan-Jul 2026) · World Bank, The Cost of Fire (2016)</Source>
        </Panel>
      </div>
    );
  }

  if (scene.kind === "peat") {
    return (
      <div className={grid}>
        <div>
          <Headline it={it} portrait={portrait} en="Peat keeps burning underground, out of the satellite's sight" id="Gambut terus membara di bawah tanah, tak terlihat satelit" />
          <motion.p variants={it} className={`mt-3 max-w-2xl text-slate-300 ${portrait ? "text-lg" : "text-base"}`}>
            When the flames die down the ember keeps moving through the peat and smoke hides it. A fire that vanishes from the
            satellite is not out. We keep it on watch as suspected smoldering until a field team confirms it.
          </motion.p>
        </div>
        <Panel it={it} portrait={portrait} title="Peat cross-section · Penampang gambut">
          <PeatSection burning={burningNow} hidden={hiddenNow} portrait={portrait} />
          <Source>NASA FIRMS status fusion · GambutWatch spread model (R0 per peat depth)</Source>
        </Panel>
      </div>
    );
  }

  if (scene.kind === "response") {
    const zones = p.areas.filter(complete).slice(0, 5);
    const km = zones.reduce((sum, a) => sum + a.firebreakKm, 0);
    const crews = zones.reduce((sum, a) => sum + a.crews, 0);
    const co2 = zones.reduce((sum, a) => sum + a.emissionsTph.co2, 0);
    return (
      <div className={grid}>
        <div>
          <Headline it={it} portrait={portrait} en={<><CountUp value={Math.round(km)} reduced={reduced} /> km of firebreak, {fmt(crews)} crews</>} id={`sekat bakar dan regu yang dibutuhkan untuk menahan api di ${zones.length} zona prioritas sebelum tiba`} />
          <motion.p variants={it} className={`mt-3 max-w-2xl text-slate-300 ${portrait ? "text-lg" : "text-base"}`}>
            The line sits where the fire will be in three hours, so crews have time to cut it. Every hour of delay moves it
            further out.
          </motion.p>
        </div>
        <Panel it={it} portrait={portrait} title="Firebreak per zone · Sekat bakar per zona">
          <ResponseBoard rows={zones.map((a) => ({ name: a.regency, km: a.firebreakKm, crews: a.crews }))} co2Tph={co2} portrait={portrait} />
          <Source>GambutWatch firebreak model · peat emission factors (modeled)</Source>
        </Panel>
      </div>
    );
  }

  if (scene.kind === "urgency") {
    const live = p.incidents.filter((i) => i.status !== "EXTINGUISHED" && i.inIndonesia);
    const byHour = Array.from({ length: 13 }, (_, h) => live.reduce((s, i) => s + stepPolygonFor(i, h).burnedAreaHa, 0));
    const ready = p.areas.filter((a) => a.inIndonesia && complete(a));
    const villages = new Set(ready.flatMap((a) => a.villages.filter((v) => v.threatLevel !== "AMAN").map((v) => v.name)));
    const counted = ready.filter((a) => a.peopleDanger !== null);
    const danger = counted.reduce((s, a) => s + (a.peopleDanger ?? 0), 0);
    const smoke = counted.reduce((s, a) => s + (a.peopleSmoke ?? 0), 0);
    return (
      <div className={grid}>
        <div>
          <Headline it={it} portrait={portrait} en={<><CountUp value={Math.round(byHour[12])} reduced={reduced} /> hectares could burn by tomorrow</>} id={`hektare terancam dalam 12 jam dari ${fmt(live.length)} titik api yang disimulasikan`} />
          <BigStats
            it={it}
            portrait={portrait}
            items={[
              // A zero here is true but reads as "no risk"; the people counts carry the message instead
              ...(villages.size > 0 ? [{ en: "villages in the fire path", id: "desa di jalur api", value: fmt(villages.size) }] : []),
              ...(counted.length
                ? [
                    { en: "people in danger zones", id: `warga di zona bahaya, ${counted.length} area`, value: fmt(danger) },
                    { en: "people under the smoke", id: "warga di bawah asap", value: fmt(smoke) },
                  ]
                : []),
              { en: "priority zones", id: "zona prioritas dengan data lengkap", value: fmt(ready.length) },
            ]}
          />
        </div>
        <Panel it={it} portrait={portrait} title="Projected burned area · Proyeksi luas terbakar">
          <HourBars values={byHour} hourOffset={12} height={portrait ? 110 : 76} label="Proyeksi luas terbakar per jam" />
          <Source>Spread model on BMKG / Open-Meteo wind{counted.length ? " · WorldPop 2020" : ""}</Source>
        </Panel>
      </div>
    );
  }

  if (scene.kind === "area") {
    const a = b.area;
    if (!a) return <Headline it={it} portrait={portrait} en="This area is no longer in the data" id="Data area ini tidak lagi tersedia" />;
    const band = aqiBand(a.air!.usAqi!);
    const v = a.villages.find((x) => x.threatLevel !== "AMAN") ?? a.villages[0];
    return (
      <div className={grid}>
        <div className="min-w-0">
          <motion.p variants={it} className={`text-slate-300 ${portrait ? "text-xl" : "text-sm"}`}>
            #{(scene.rank ?? 0) + 1} · {[a.province, a.inIndonesia ? null : a.country].filter(Boolean).join(", ")}
          </motion.p>
          <Headline it={it} portrait={portrait} en={a.regency} id={`${fmt(a.incidents.length)} titik api, ${fmt(a.areaHaByHour[12])} ha terancam dalam 12 jam`} />
          <BigStats
            it={it}
            portrait={portrait}
            items={[
              ...(a.peopleDanger !== null ? [{ en: "people in danger", id: "warga zona bahaya", value: fmt(a.peopleDanger) }] : []),
              ...(a.peopleSmoke !== null ? [{ en: "under smoke", id: "di bawah asap", value: fmt(a.peopleSmoke) }] : []),
              { en: "fire points", id: "titik api", value: fmt(a.incidents.length) },
              { en: `AQI, ${band.label}`, id: `PM2.5 ${fmt(a.air!.pm25 ?? 0)} µg/m³`, value: fmt(a.air!.usAqi!), color: aqiTextColor(a.air!.usAqi!) },
              { en: "firebreak crews", id: `sekat ${fmt(a.firebreakKm, 1)} km`, value: fmt(a.crews) },
            ]}
          />
          {v && (
            <motion.p variants={it} className={`mt-4 max-w-3xl text-slate-100 ${portrait ? "text-xl" : "text-base"}`}>
              <span className="mr-2 inline-block size-2.5 rounded-full align-middle" style={{ background: THREAT_COLOR[v.threatLevel] }} />
              {v.name}:{" "}
              {Number.isFinite(v.etaMinutes) ? `fire arrives in ${fmt(v.etaMinutes / 60, 1)} h` : "outside the 48 h reach"}, evacuate{" "}
              {compassEn(v.evacuationBearingDeg)}
              <span className="text-slate-400"> · evakuasi ke {compassName(v.evacuationBearingDeg)}</span>
            </motion.p>
          )}
        </div>
        <Panel it={it} portrait={portrait} title={`News from ${a.regency} · Berita`}>
          {a.news.length === 0 ? (
            <p className="text-sm text-slate-400">No fire news for this area in the last 30 days.</p>
          ) : (
            <ul className="space-y-2.5">
              {a.news.slice(0, portrait ? 3 : 3).map((n) => (
                <li key={n.id} className={`leading-snug text-slate-100 ${portrait ? "text-lg" : "text-sm"}`}>
                  <span className="line-clamp-2">{n.title}</span>
                  <span className="text-xs text-slate-400">
                    {n.source} · {new Date(n.publishedAt).toLocaleDateString("id-ID")}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3">
            <HourBars values={a.areaHaByHour} hourOffset={12} height={portrait ? 56 : 36} label={`Proyeksi luas ${a.regency}`} />
          </div>
        </Panel>
      </div>
    );
  }

  if (scene.kind === "fire") {
    const incident = b.incident;
    if (!incident) return <Headline it={it} portrait={portrait} en="This fire is no longer in the data" id="Data titik api ini tidak lagi tersedia" />;
    const village = incident.nearestVillage;
    const step = stepPolygonFor(incident, b.hourOffset);
    const w = weatherAtHour(incident.weather, new Date(), b.hourOffset);
    const air = p.air[cellKey(incident.originLat, incident.originLng)];
    const byHour = Array.from({ length: 13 }, (_, h) => stepPolygonFor(incident, h).burnedAreaHa);
    return (
      <div className={grid}>
        <div>
          <Headline
            it={it}
            portrait={portrait}
            en={village ? `Fire heading for ${village.name}` : `Fire in ${b.area?.regency ?? "the priority zone"}`}
            id={`${FIRE_STATUS_LABEL[incident.status]} · ${incident.satellites.join(", ")}`}
          />
          <motion.div variants={it} className={`mt-4 flex flex-wrap items-end gap-x-8 gap-y-3 ${portrait ? "gap-x-10" : ""}`}>
            <Figure portrait={portrait} label="Forecast" value={`t+${b.hourOffset} h`} />
            <Figure portrait={portrait} label="Burned area" value={`${step.burnedAreaHa.toFixed(1)} ha`} color="#f87171" />
            <div>
              <p className={`text-slate-300 ${portrait ? "text-base" : "text-xs"}`}>Wind · Angin</p>
              <p className={`flex items-center gap-2 font-bold tabular-nums text-sky-300 ${portrait ? "text-5xl" : "text-3xl"}`}>
                <NavigationIcon className="size-6 transition-transform duration-500" style={{ transform: `rotate(${w.windVectorDeg}deg)` }} />
                {Math.round(w.windSpeedKmh)} km/h
              </p>
            </div>
            {village && (
              <Figure
                portrait={portrait}
                label={`Reaches ${village.name}`}
                value={Number.isFinite(village.etaMinutes) ? `${fmt(village.etaMinutes / 60, 1)} h` : "> 48 h"}
                color={THREAT_COLOR[village.threatLevel]}
              />
            )}
          </motion.div>
          <motion.p variants={it} className={`mt-3 max-w-2xl text-slate-200 ${portrait ? "text-lg" : "text-sm"}`}>
            Firebreak {fmt(incident.firebreak.lengthMeters)} m (yellow line), fire reaches it in {fmt(incident.firebreak.etaFireArrivalMinutes)} min.
            {village ? ` Evacuate toward the ${compassEn(village.safeEvacuationBearingDeg)} (green arrow).` : ""}
            {air?.usAqi != null ? ` Air: AQI ${Math.round(air.usAqi)}.` : ""}
          </motion.p>
        </div>
        <Panel it={it} portrait={portrait} title={full ? "Spread by direction, this fire now · Laju per arah" : "Burned area per hour · Luas terbakar per jam"}>
          {full && (
            <div className="mb-3">
              <SpreadPolar
                r0={incident.peatlandInfo.baseSpreadRateR0}
                rh={w.relativeHumidity}
                windKmh={w.windSpeedKmh}
                windDeg={w.windVectorDeg}
                portrait={portrait}
              />
            </div>
          )}
          <HourBars values={byHour} hourOffset={b.hourOffset} height={portrait ? 90 : full ? 44 : 64} label="Luas terbakar per jam" />
          <Source>BMKG / Open-Meteo wind forecast · GambutWatch spread model</Source>
        </Panel>
      </div>
    );
  }

  if (scene.kind === "air") {
    const ready = p.areas.filter(complete);
    const unhealthy = ready.filter((a) => a.air!.usAqi! > 150);
    const worst = [...ready].sort((x, y) => y.air!.usAqi! - x.air!.usAqi!).slice(0, portrait ? 4 : 5);
    const smoke = ready.reduce((s, a) => s + (a.peopleSmoke ?? 0), 0);
    const smokeKnown = ready.some((a) => a.peopleSmoke !== null);
    return (
      <div className={grid}>
        <div>
          <Headline it={it} portrait={portrait} en={<><CountUp value={unhealthy.length} reduced={reduced} /> fire zones breathe unhealthy air</>} id={`area api dengan udara tidak sehat (AQI di atas 150)${smokeKnown ? `, ${fmt(smoke)} warga di bawah asap` : ""}`} />
          <motion.p variants={it} className={`mt-3 max-w-2xl text-slate-300 ${portrait ? "text-lg" : "text-sm"}`}>
            The brown haze on the map is measured PM2.5 from the Copernicus atmosphere model, not a drawing. Kabut cokelat di peta adalah PM2.5 terukur.
          </motion.p>
        </div>
        {full && worst[0]?.air?.pm25 != null ? (
          <Panel it={it} portrait={portrait} title="Against the WHO limit · Dibanding batas WHO">
            <PmVersusWho pm25={worst[0].air!.pm25!} forecast={worst[0].air!.forecast} place={worst[0].regency} portrait={portrait} />
            <Source>Copernicus CAMS via Open-Meteo · WHO Air Quality Guidelines 2021 (24-h PM2.5 15 µg/m³)</Source>
          </Panel>
        ) : (
        <Panel it={it} portrait={portrait} title="Worst air · Udara terburuk">
          <ul className="space-y-1.5">
            {worst.map((a) => {
              return (
                <li key={a.id} className={`flex justify-between gap-3 ${portrait ? "text-lg" : "text-sm"}`}>
                  <span className="truncate text-slate-100">{a.regency}</span>
                  <span className="shrink-0 tabular-nums" style={{ color: aqiTextColor(a.air!.usAqi!) }}>
                    AQI {Math.round(a.air!.usAqi!)} · PM2.5 {fmt(a.air!.pm25 ?? 0)}
                  </span>
                </li>
              );
            })}
          </ul>
          <Source>Open-Meteo Air Quality (Copernicus CAMS)</Source>
        </Panel>
        )}
      </div>
    );
  }

  if (scene.kind === "crises" && p.crises) {
    const events = p.crises.events;
    const provinces = new Set(events.map((e) => e.province));
    const top = events.slice(0, portrait ? 5 : 6);
    return (
      <div className={grid}>
        <div>
          <Headline it={it} portrait={portrait} en="Fire is not the only emergency" id={`${fmt(events.length)} krisis aktif di ${fmt(provinces.size)} provinsi, 14 hari terakhir`} />
          <motion.p variants={it} className={`mt-3 max-w-2xl text-slate-300 ${portrait ? "text-lg" : "text-sm"}`}>
            Fuel shortages, floods, eruptions, drought and outages compete for the same responders. Ring color = severity.
          </motion.p>
        </div>
        <Panel it={it} portrait={portrait} title="Most severe · Paling parah">
          <ul className="space-y-2">
            {top.map((e) => {
              const Icon = CRISIS_ICON[e.kind];
              return (
                <li key={e.id} className={`flex items-start gap-2.5 ${portrait ? "text-lg" : "text-sm"}`}>
                  <span
                    className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border-2 bg-slate-950"
                    style={{ borderColor: SEVERITY_COLOR[e.severity] }}
                  >
                    <Icon className="size-3.5 text-slate-100" />
                  </span>
                  <span className="min-w-0">
                    <span className="text-slate-100">
                      {CRISIS_LABEL[e.kind].en}, {e.province}
                    </span>
                    <span className="block text-xs text-slate-400">
                      {SEVERITY_LABEL[e.severity].en} · {e.basis === "official" ? e.source : `news: ${e.source}`}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          <Source>BMKG · GDACS · Google News (pinned at the province named)</Source>
        </Panel>
      </div>
    );
  }

  if (scene.kind === "news" && full) {
    // Every real article the briefing loaded: national feed plus each area's local coverage
    const seen = new Set<string>();
    const all = [...p.news, ...p.areas.flatMap((a) => a.news)].filter((n) => (seen.has(n.url) ? false : (seen.add(n.url), true)));
    return (
      <div className={grid}>
        <div>
          <Headline it={it} portrait={portrait} en="The newsrooms are sounding the alarm" id={`${fmt(all.length)} berita karhutla dari media Indonesia, 14 hari terakhir`} />
          <motion.p variants={it} className={`mt-3 max-w-2xl text-slate-300 ${portrait ? "text-lg" : "text-base"}`}>
            Coverage keeps the response accountable. GambutWatch ties each story to the district it is about, so a crew
            lead sees the local reporting next to the fire.
          </motion.p>
        </div>
        <Panel it={it} portrait={portrait} title="Coverage wire · Arus pemberitaan">
          <NewsWire articles={all} portrait={portrait} limit={portrait ? 3 : 4} />
          <Source>Google News Indonesia · filtered to Indonesian forest and land fires</Source>
        </Panel>
      </div>
    );
  }

  if (scene.kind === "news") {
    const list = p.news.slice(0, portrait ? 4 : 5);
    return (
      <div className={grid}>
        <div>
          <Headline it={it} portrait={portrait} en="What newsrooms report today" id={`${fmt(p.news.length)} berita karhutla terbaru dari media Indonesia`} />
        </div>
        <Panel it={it} portrait={portrait} title="Latest · Terbaru">
          <NewsList list={list.map((n) => ({ id: n.id, title: n.title, meta: `${n.source} · ${timeAgo(n.publishedAt)}` }))} portrait={portrait} />
          <Source>Google News Indonesia · filtered to Indonesian forest and land fires</Source>
        </Panel>
      </div>
    );
  }

  if (scene.kind === "government" && p.crises) {
    const gov = p.crises.government;
    const counts = new Map<GovAction, number>();
    for (const g of gov) counts.set(g.action, (counts.get(g.action) ?? 0) + 1);
    const sorted = [...counts.entries()].sort((x, y) => y[1] - x[1]);
    return (
      <div className={grid}>
        <div>
          <Headline it={it} portrait={portrait} en="What the government is doing" id={`${fmt(gov.length)} langkah pemerintah diberitakan dalam 14 hari`} />
          <motion.ul variants={it} className="mt-4 flex flex-wrap gap-2">
            {sorted.map(([action, n]) => (
              <li key={action} className={`rounded-md border border-white/15 bg-white/5 px-2.5 py-1 text-slate-100 ${portrait ? "text-lg" : "text-sm"}`}>
                <span className="font-semibold tabular-nums text-orange-300">{n}</span> {GOV_ACTION_LABEL[action].en}
                <span className="text-slate-400"> · {GOV_ACTION_LABEL[action].id}</span>
              </li>
            ))}
          </motion.ul>
        </div>
        <Panel it={it} portrait={portrait} title="Reported actions · Aksi yang diberitakan">
          <NewsList
            list={gov.slice(0, portrait ? 4 : 4).map((g) => ({ id: g.id, title: g.title, meta: `${GOV_ACTION_LABEL[g.action].en} · ${g.source} · ${timeAgo(g.publishedAt)}` }))}
            portrait={portrait}
          />
          <Source>Google News Indonesia</Source>
        </Panel>
      </div>
    );
  }

  if (scene.kind === "voices" && p.crises) {
    const voices = p.crises.voices;
    const who = [...new Set(voices.map((v) => v.who))];
    return (
      <div className={grid}>
        <div>
          <Headline it={it} portrait={portrait} en="Who is raising the alarm" id={`${who.join(", ")} · dari pemberitaan 30 hari terakhir`} />
        </div>
        <Panel it={it} portrait={portrait} title="Public voices in the news · Suara publik">
          <NewsList list={voices.slice(0, 4).map((v) => ({ id: v.id, title: v.title, meta: `${v.who} · ${v.source} · ${timeAgo(v.publishedAt)}` }))} portrait={portrait} />
          <Source>Quoted in news coverage; social platforms are not scraped</Source>
        </Panel>
      </div>
    );
  }

  // close
  const crisesN = p.crises?.events.length ?? 0;
  return (
    <div className={grid}>
      <div>
        <Headline it={it} portrait={portrait} en="We cannot stop every fire. We can stop it reaching people." id="Kami tidak mencegah api. Kami memperkecil dampaknya bagi warga." />
        <motion.ul variants={it} className={`mt-4 grid max-w-3xl gap-x-8 gap-y-1.5 text-slate-100 ${portrait ? "text-lg" : "text-sm sm:grid-cols-2"}`}>
          <li>Spread forecast 12 h ahead on live wind</li>
          <li>Firebreak line placed before the fire arrives</li>
          <li>Evacuation direction for every threatened village</li>
          <li>Air quality and headcounts under the smoke</li>
          {crisesN > 0 && <li>{fmt(crisesN)} other national crises on the same map</li>}
        </motion.ul>
      </div>
      <Panel it={it} portrait={portrait} title="Data · Sumber">
        <p className={`leading-relaxed text-slate-300 ${portrait ? "text-base" : "text-xs"}`}>
          NASA FIRMS · BMKG · Open-Meteo · Copernicus CAMS · WorldPop · OpenStreetMap · geoBoundaries · GDACS · CelesTrak · Google News
        </p>
        {p.musicCredit && <p className={`mt-2 text-slate-400 ${portrait ? "text-sm" : "text-[11px]"}`}>{p.musicCredit}</p>}
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function timeAgo(iso: string): string {
  const h = Math.max(0, (Date.now() - Date.parse(iso)) / 3_600_000);
  if (h < 1) return "< 1 h ago";
  if (h < 48) return `${Math.round(h)} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

function Headline({ en, id, portrait, it }: { en: React.ReactNode; id: React.ReactNode; portrait: boolean; it: Variants }) {
  return (
    <>
      <motion.h2
        variants={it}
        className={`mt-1.5 leading-[1.05] font-bold tracking-tight text-balance text-white ${portrait ? "text-6xl" : "text-4xl sm:text-6xl"}`}
      >
        {en}
      </motion.h2>
      <motion.p variants={it} className={`mt-2 max-w-3xl text-slate-300 ${portrait ? "text-2xl" : "text-lg"}`}>
        {id}
      </motion.p>
    </>
  );
}

function Panel({
  title,
  children,
  portrait,
  it,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  portrait: boolean;
  it: Variants;
}) {
  // The one glass surface in the tour: it sits over a moving map and must stay legible on any frame
  return (
    <motion.div
      variants={it}
      className={`rounded-xl border border-white/10 bg-slate-950/75 backdrop-blur ${portrait ? "p-5" : "p-4"}`}
    >
      <p className={`mb-2.5 font-semibold text-slate-300 ${portrait ? "text-base" : "text-xs"}`}>{title}</p>
      {children}
    </motion.div>
  );
}

function NewsList({ list, portrait }: { list: { id: string; title: string; meta: string }[]; portrait: boolean }) {
  return (
    <ul className="space-y-2.5">
      {list.map((n, i) => (
        <motion.li
          key={n.id}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.5 + i * 0.35, duration: 0.5, ease: EASE }}
          className={`leading-snug text-slate-100 ${portrait ? "text-lg" : "text-sm"}`}
        >
          <span className="line-clamp-2">{n.title}</span>
          <span className="text-xs text-slate-400">{n.meta}</span>
        </motion.li>
      ))}
    </ul>
  );
}

function Figure({ label, value, color, portrait }: { label: string; value: string; color?: string; portrait: boolean }) {
  return (
    <div>
      <p className={`text-slate-300 ${portrait ? "text-base" : "text-xs"}`}>{label}</p>
      <p className={`font-bold tabular-nums ${portrait ? "text-5xl" : "text-3xl"}`} style={{ color: color ?? "#fff" }}>
        {value}
      </p>
    </div>
  );
}

function BigStats({
  items,
  portrait,
  it,
}: {
  items: { en: string; id: string; value: string; color?: string }[];
  portrait: boolean;
  it: Variants;
}) {
  return (
    <motion.dl variants={it} className={`mt-5 flex flex-wrap gap-y-4 ${portrait ? "gap-x-10" : "gap-x-10"}`}>
      {items.map((s) => (
        <div key={s.en}>
          <dd className={`font-bold tabular-nums ${portrait ? "text-5xl" : "text-4xl"}`} style={{ color: s.color ?? "#fff" }}>
            {s.value}
          </dd>
          <dt className={`text-slate-200 ${portrait ? "text-base" : "text-sm"}`}>{s.en}</dt>
          <dt className={`text-slate-400 ${portrait ? "text-sm" : "text-xs"}`}>{s.id}</dt>
        </div>
      ))}
    </motion.dl>
  );
}

function Source({ children }: { children: React.ReactNode }) {
  return <p className="mt-2.5 text-[11px] text-slate-400">{children}</p>;
}

/** Number that counts up when its scene opens (static under reduced motion). */
function CountUp({ value, reduced }: { value: number; reduced: boolean }) {
  const [shown, setShown] = useState(reduced ? value : 0);
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      // rAF timestamps can predate `start` by a frame; a negative p would count below zero
      const p = Math.min(1, Math.max(0, (now - start) / 1400));
      setShown(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, reduced]);
  return <span className="tabular-nums">{fmt(reduced ? value : shown)}</span>;
}
