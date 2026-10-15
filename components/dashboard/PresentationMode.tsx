"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  NavigationIcon,
  NewspaperIcon,
  PauseIcon,
  PlayIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cellKey, type FirmsState, type ViewStats } from "@/hooks/useIncidents";
import {
  AQI_BANDS,
  aqiBand,
  compassName,
  FIRE_STATUS_COLOR,
  FIRE_STATUS_LABEL,
  FIRE_STATUS_ORDER,
  THREAT_COLOR,
  THREAT_LABEL,
  type AirQuality,
  type FireStatus,
  type HotspotIncident,
} from "@/lib/gambut";
import { stepPolygonFor, weatherAtHour } from "@/lib/simulationEngine";
import { KG_PER_MJ, PEAT_EMISSION_G_PER_KG, type DangerArea } from "@/lib/dangerAreas";
import type { CameraShot } from "@/components/map/types";
import { INDONESIA_CENTER } from "@/components/map/types";
import { fmt, HourBars, StatusBar } from "./DangerAreas";

type Scene =
  | { kind: "intro"; ms: number }
  | { kind: "overview"; ms: number }
  | { kind: "area"; ms: number; areaId: string; rank: number }
  | { kind: "fire"; ms: number; areaId: string; id: string }
  | { kind: "air"; ms: number }
  | { kind: "world"; ms: number };

/** Camera flight before the spread playback starts in a fire scene. */
const FLIGHT_MS = 4000;
const HOUR_STEP_MS = 800;
const FIRE_MS = FLIGHT_MS + 13 * HOUR_STEP_MS + 2000;

export interface PresentationModeProps {
  areas: DangerArea[];
  viewStats: ViewStats;
  incidents: HotspotIncident[];
  statusCounts: { world: Record<FireStatus, number>; indonesia: Record<FireStatus, number> };
  firms: FirmsState;
  air: Record<string, AirQuality>;
  hourOffset: number;
  setHourOffset: (h: number) => void;
  selectIncident: (id: string) => void;
  setCamera: (shot: CameraShot) => void;
  onExit: () => void;
}

/**
 * Cinematic tour for briefings and wall screens. Every danger area gets its
 * own scene (figures, charts, villages, local news) followed by its most
 * urgent fire with the projected spread playing hour by hour. The data set
 * is frozen while the tour runs, so everything shown was preloaded.
 */
export default function PresentationMode(props: PresentationModeProps) {
  const { areas, incidents, air, hourOffset, setHourOffset, selectIncident, setCamera, onExit } = props;
  const reduced = useReducedMotion() ?? false;

  // The script is fixed when the tour starts so scenes do not reshuffle mid-show
  const [scenes] = useState<Scene[]>(() => [
    { kind: "intro", ms: 10000 },
    { kind: "overview", ms: 12000 },
    ...areas.flatMap((a, rank): Scene[] => {
      const top = a.incidents.find((i) => i.status !== "EXTINGUISHED");
      return [
        { kind: "area", ms: 14000, areaId: a.id, rank },
        ...(top ? [{ kind: "fire" as const, ms: FIRE_MS, areaId: a.id, id: top.id }] : []),
      ];
    }),
    { kind: "air", ms: 11000 },
    { kind: "world", ms: 9000 },
  ]);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const seq = useRef(0);
  const scene = scenes[index];

  const areaById = useMemo(() => new Map(areas.map((a) => [a.id, a])), [areas]);
  const incidentById = useMemo(() => new Map(incidents.map((i) => [i.id, i])), [incidents]);

  const go = useCallback(
    (delta: number) => setIndex((i) => (i + delta + scenes.length) % scenes.length),
    [scenes.length],
  );

  // Camera + selection when a scene starts
  useEffect(() => {
    const shot = (s: Omit<CameraShot, "seq" | "duration">, ms = 4500) => {
      seq.current += 1;
      setCamera({ ...s, seq: seq.current, duration: reduced ? 0 : ms });
    };
    setHourOffset(0);
    if (scene.kind === "intro") shot({ center: INDONESIA_CENTER, zoom: 4.4, pitch: 20, bearing: 0 });
    if (scene.kind === "overview") shot({ center: INDONESIA_CENTER, zoom: 4.8, pitch: 40, bearing: -15 });
    if (scene.kind === "air") shot({ center: INDONESIA_CENTER, zoom: 4.6, pitch: 30, bearing: 10 });
    if (scene.kind === "world") shot({ center: [110, 5], zoom: 1.6, pitch: 0, bearing: 0 });
    if (scene.kind === "area") {
      const a = areaById.get(scene.areaId);
      if (a) {
        const lat = a.incidents.reduce((s, i) => s + i.originLat, 0) / a.incidents.length;
        const lng = a.incidents.reduce((s, i) => s + i.originLng, 0) / a.incidents.length;
        shot({ center: [lng, lat], zoom: 9, pitch: 45, bearing: (scene.rank * 37) % 60 - 30 });
      }
    }
    if (scene.kind === "fire") {
      const i = incidentById.get(scene.id);
      if (i) {
        selectIncident(i.id);
        // Look along the wind so the spread grows away from the viewer
        shot(
          { center: [i.originLng, i.originLat], zoom: 12.4, pitch: 62, bearing: i.weather.windVectorDeg },
          FLIGHT_MS,
        );
      }
    }
    // Scene start only; refreshed data mid-scene must not re-fly the camera
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // Scene clock: one timeout per scene plus an hour ticker in fire scenes. Pausing
  // keeps the remaining time; the progress bar is a CSS animation, not React state.
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
  }, [go, onExit]);

  const area = "areaId" in scene ? areaById.get(scene.areaId) : undefined;

  return (
    <div className="pointer-events-none absolute inset-0 z-30" role="region" aria-label="Mode presentasi">
      <div className="absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-black/70 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-[60%] bg-gradient-to-t from-black/85 via-black/40 to-transparent" />

      {/* Controls + scene counter */}
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

      <div className="absolute inset-x-4 bottom-5 sm:inset-x-8 sm:bottom-7">
        <AnimatePresence mode="wait">
          <motion.div
            key={index}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -12 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          >
            {scene.kind === "area" ? (
              area ? (
                <AreaScene area={area} rank={scene.rank} total={areas.length} reduced={reduced} />
              ) : (
                <Headline>Data area ini tidak lagi tersedia</Headline>
              )
            ) : scene.kind === "fire" ? (
              <FireScene
                incident={incidentById.get(scene.id)}
                area={area}
                air={air}
                hourOffset={hourOffset}
              />
            ) : (
              <OverviewScene kind={scene.kind} {...props} reduced={reduced} />
            )}
          </motion.div>
        </AnimatePresence>

        {/* Progress: one segment per scene; the current one fills by CSS animation */}
        <div className="mt-4 flex gap-1" aria-hidden>
          {scenes.map((s, i) => (
            <div key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-white/15">
              {i < index && <div className="h-full w-full bg-white/80" />}
              {i === index && (
                <div
                  key={index}
                  className="h-full bg-white/80"
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

/* ------------------------------------------------------------------ scenes */

function OverviewScene({
  kind,
  statusCounts,
  firms,
  viewStats,
  areas,
  incidents,
  air,
  reduced,
}: PresentationModeProps & { kind: "intro" | "overview" | "air" | "world"; reduced: boolean }) {
  if (kind === "intro" || kind === "world") {
    const counts = kind === "intro" ? statusCounts.indonesia : statusCounts.world;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const maxSat = Math.max(1, ...firms.sources.map((s) => s.detections));
    return (
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div>
          <Kicker>{kind === "intro" ? "Indonesia hari ini" : "Seluruh dunia"}</Kicker>
          <Headline>
            <CountUp value={total} reduced={reduced} /> kejadian api terpantau satelit
          </Headline>
          <div className="mt-3 max-w-xl">
            <StatusBar byStatus={counts} />
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-slate-200">
            {FIRE_STATUS_ORDER.map((s) => (
              <li key={s} className="flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ background: FIRE_STATUS_COLOR[s] }} />
                <span className="font-semibold tabular-nums">{fmt(counts[s])}</span>
                {FIRE_STATUS_LABEL[s]}
              </li>
            ))}
          </ul>
        </div>
        <Panel title="Piksel deteksi per satelit">
          <ul className="space-y-1.5 text-xs">
            {firms.sources.map((s) => (
              <li key={s.id}>
                <div className="flex justify-between text-slate-200">
                  <span>{s.label}</span>
                  <span className="tabular-nums">{fmt(s.detections)}</span>
                </div>
                <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <motion.div
                    className="h-full bg-orange-400"
                    initial={{ width: 0 }}
                    animate={{ width: `${(s.detections / maxSat) * 100}%` }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                  />
                </div>
              </li>
            ))}
          </ul>
          <Source>NASA FIRMS near-real-time · {fmt(firms.detections)} piksel</Source>
        </Panel>
      </div>
    );
  }

  if (kind === "overview") {
    const live = incidents.filter((i) => i.status !== "EXTINGUISHED");
    const byHour = Array.from({ length: 13 }, (_, h) => live.reduce((s, i) => s + stepPolygonFor(i, h).burnedAreaHa, 0));
    const villages = areas.flatMap((a) => a.villages).filter((v) => v.threatLevel !== "AMAN");
    const danger = areas.reduce((s, a) => s + (a.peopleDanger ?? 0), 0);
    const smoke = areas.reduce((s, a) => s + (a.peopleSmoke ?? 0), 0);
    const biomass = (viewStats.totalFrp * KG_PER_MJ * 3600) / 1000;
    return (
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div>
          <Kicker>
            Dampak 12 jam ke depan · {areas.length} area · {live.length} titik tersimulasi
          </Kicker>
          <Headline>
            <CountUp value={Math.round(byHour[12])} reduced={reduced} /> ha terancam terbakar
          </Headline>
          <BigStats
            items={[
              { label: "desa dalam jalur api", value: fmt(villages.length) },
              { label: "warga di zona bahaya", value: fmt(danger) },
              { label: "warga di bawah asap", value: fmt(smoke) },
              { label: "ton CO₂ per jam", value: fmt((biomass * PEAT_EMISSION_G_PER_KG.co2) / 1000) },
            ]}
          />
        </div>
        <Panel title="Proyeksi luas terbakar per jam">
          <HourBars values={byHour} hourOffset={12} height={70} label="Proyeksi luas terbakar" />
          <Source>Model perambatan + prakiraan BMKG / Open-Meteo · WorldPop 2020</Source>
        </Panel>
      </div>
    );
  }

  // Air
  const cells = [...new Set(incidents.map((i) => cellKey(i.originLat, i.originLng)))];
  const airs = cells.flatMap((k) => (air[k]?.usAqi != null ? [air[k]] : []));
  const bands = AQI_BANDS.map((b) => ({ b, n: airs.filter((a) => aqiBand(a.usAqi!) === b).length }));
  const worstAreas = [...areas]
    .filter((a) => a.air?.usAqi != null)
    .sort((x, y) => y.air!.usAqi! - x.air!.usAqi!)
    .slice(0, 5);
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div>
        <Kicker>Kualitas udara di {airs.length} area api</Kicker>
        <Headline>
          <CountUp value={airs.filter((a) => a.usAqi! > 150).length} reduced={reduced} /> area dengan udara
          tidak sehat
        </Headline>
        <div className="mt-3 flex h-3 max-w-xl overflow-hidden rounded-full bg-white/10">
          {bands.map(({ b, n }) =>
            n > 0 ? (
              <motion.span
                key={b.label}
                initial={{ width: 0 }}
                animate={{ width: `${(n / Math.max(1, airs.length)) * 100}%` }}
                transition={{ duration: 0.8 }}
                style={{ background: b.color }}
              />
            ) : null,
          )}
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-4 text-xs text-slate-300">
          {bands
            .filter((x) => x.n > 0)
            .map(({ b, n }) => (
              <li key={b.label} className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: b.color }} />
                {n} {b.label}
              </li>
            ))}
        </ul>
      </div>
      <Panel title="Udara terburuk">
        <ul className="space-y-1 text-sm">
          {worstAreas.map((a) => (
            <li key={a.id} className="flex justify-between gap-2">
              <span className="truncate text-slate-200">{a.regency}</span>
              <span className="tabular-nums" style={{ color: aqiBand(a.air!.usAqi!).color }}>
                AQI {Math.round(a.air!.usAqi!)}
              </span>
            </li>
          ))}
        </ul>
        <Source>Open-Meteo Air Quality (Copernicus CAMS)</Source>
      </Panel>
    </div>
  );
}

function AreaScene({ area: a, rank, total, reduced }: { area: DangerArea; rank: number; total: number; reduced: boolean }) {
  const band = a.air?.usAqi != null ? aqiBand(a.air.usAqi) : null;
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_24rem]">
      <div className="min-w-0">
        <Kicker>
          Area berbahaya {rank + 1} dari {total} · {[a.province, a.inIndonesia ? null : a.country].filter(Boolean).join(", ")}
        </Kicker>
        <Headline>{a.regency}</Headline>
        <div className="mt-2 max-w-xl">
          <StatusBar byStatus={a.byStatus} />
        </div>
        <BigStats
          items={[
            { label: "titik api", value: fmt(a.incidents.length) },
            { label: "ha terancam +12 jam", value: fmt(a.areaHaByHour[12]) },
            { label: "warga zona bahaya", value: a.peopleDanger === null ? "-" : fmt(a.peopleDanger) },
            { label: "warga di bawah asap", value: a.peopleSmoke === null ? "-" : fmt(a.peopleSmoke) },
            { label: "regu sekat bakar", value: fmt(a.crews) },
          ]}
        />
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {band && (
            <span style={{ color: band.color }}>
              AQI <CountUp value={Math.round(a.air!.usAqi!)} reduced={reduced} /> {band.label}
            </span>
          )}
          <span className="text-slate-300">CO₂ {fmt(a.emissionsTph.co2)} t/jam</span>
          <span className="text-slate-300">sekat bakar {fmt(a.firebreakKm, 1)} km</span>
        </div>
        {a.villages.length > 0 && (
          <ul className="mt-3 flex max-w-3xl flex-wrap gap-x-4 gap-y-1 text-sm">
            {a.villages.slice(0, 6).map((v) => (
              <li key={v.name} className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: THREAT_COLOR[v.threatLevel] }} />
                <span className="text-slate-100">{v.name}</span>
                <span className="text-slate-400">
                  {Number.isFinite(v.etaMinutes) ? `${fmt(v.etaMinutes / 60, 1)} j` : "> 48 j"}, evakuasi ke{" "}
                  {compassName(v.evacuationBearingDeg)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Panel title={<span className="flex items-center gap-1.5"><NewspaperIcon className="size-3.5" /> Berita tentang {a.regency}</span>}>
        {a.news.length === 0 ? (
          <p className="text-xs text-slate-400">
            {a.inIndonesia ? "Belum ada berita karhutla 30 hari terakhir." : "Berita dicari untuk wilayah Indonesia."}
          </p>
        ) : (
          <ul className="space-y-2">
            {a.news.slice(0, 4).map((n, i) => (
              <motion.li
                key={n.id}
                initial={reduced ? false : { opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.6 + i * 0.25 }}
                className="text-sm leading-snug text-slate-100"
              >
                <span className="line-clamp-2">{n.title}</span>
                <span className="text-[11px] text-slate-400">
                  {n.source} · {new Date(n.publishedAt).toLocaleDateString("id-ID")}
                </span>
              </motion.li>
            ))}
          </ul>
        )}
        <div className="mt-3">
          <HourBars values={a.areaHaByHour} hourOffset={12} height={36} label={`Proyeksi luas ${a.regency}`} />
        </div>
      </Panel>
    </div>
  );
}

function FireScene({
  incident,
  area,
  air,
  hourOffset,
}: {
  incident: HotspotIncident | undefined;
  area: DangerArea | undefined;
  air: Record<string, AirQuality>;
  hourOffset: number;
}) {
  if (!incident) return <Headline>Data titik api ini tidak lagi tersedia</Headline>;
  const village = incident.nearestVillage;
  const step = stepPolygonFor(incident, hourOffset);
  const w = weatherAtHour(incident.weather, new Date(), hourOffset);
  const a = air[cellKey(incident.originLat, incident.originLng)];
  const byHour = Array.from({ length: 13 }, (_, h) => stepPolygonFor(incident, h).burnedAreaHa);
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
      <div>
        <Kicker>
          {area?.regency ?? "Titik api"} · {FIRE_STATUS_LABEL[incident.status]} · {incident.satellites.join(", ")}
        </Kicker>
        <Headline>{village ? `Api mengarah ke ${village.name}` : `Titik api ${incident.id}`}</Headline>
        <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-3">
          <Figure label="Proyeksi" value={`t+${hourOffset} jam`} />
          <Figure label="Luas terbakar" value={`${step.burnedAreaHa.toFixed(1)} ha`} color="#f87171" />
          <div>
            <p className="text-xs text-slate-300">Angin</p>
            <p className="flex items-center gap-2 text-3xl font-bold tabular-nums text-sky-300">
              <NavigationIcon
                className="size-6 transition-transform duration-500"
                style={{ transform: `rotate(${w.windVectorDeg}deg)` }}
              />
              {Math.round(w.windSpeedKmh)} km/jam
            </p>
          </div>
          {village && (
            <Figure
              label={`Tiba di ${village.name}`}
              value={Number.isFinite(village.etaMinutes) ? `${fmt(village.etaMinutes / 60, 1)} jam` : "> 48 jam"}
              color={THREAT_COLOR[village.threatLevel]}
            />
          )}
          <Figure label="FRP" value={`${fmt(incident.frpMegawatt)} MW`} />
        </div>
        <p className="mt-3 max-w-2xl text-sm text-slate-200">
          Sekat bakar {incident.firebreak.lengthMeters} m (garis kuning), tiba dalam{" "}
          {fmt(incident.firebreak.etaFireArrivalMinutes)} menit.
          {village
            ? ` ${THREAT_LABEL[village.threatLevel]}: evakuasi warga ke arah ${compassName(village.safeEvacuationBearingDeg)} (panah hijau).`
            : ""}
          {a?.usAqi != null ? ` Udara: AQI ${Math.round(a.usAqi)}, ${aqiBand(a.usAqi).advice}` : ""}
        </p>
      </div>
      <Panel title="Pertumbuhan area terbakar">
        <HourBars values={byHour} hourOffset={hourOffset} height={64} label="Luas terbakar per jam" />
        <Source>Prakiraan angin BMKG / Open-Meteo · model perambatan GambutWatch</Source>
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function Panel({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="self-end rounded-xl border border-white/10 bg-slate-950/70 p-3 backdrop-blur">
      <p className="mb-2 text-xs font-semibold text-slate-300">{title}</p>
      {children}
    </div>
  );
}

function Kicker({ children }: { children: React.ReactNode }) {
  return <p className="text-sm font-medium text-orange-300">{children}</p>;
}

function Headline({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-1 text-3xl leading-tight font-bold text-balance text-white drop-shadow sm:text-5xl">
      {children}
    </h2>
  );
}

function Figure({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <p className="text-xs text-slate-300">{label}</p>
      <p className="text-3xl font-bold tabular-nums" style={{ color: color ?? "#fff" }}>
        {value}
      </p>
    </div>
  );
}

function BigStats({ items }: { items: { label: string; value: string }[] }) {
  return (
    <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
      {items.map((it) => (
        <div key={it.label}>
          <dd className="text-3xl font-bold tabular-nums text-white">{it.value}</dd>
          <dt className="text-xs text-slate-300">{it.label}</dt>
        </div>
      ))}
    </dl>
  );
}

function Source({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-[11px] text-slate-400">{children}</p>;
}

/** Number that counts up when its scene opens (static under reduced motion). */
function CountUp({ value, reduced }: { value: number; reduced: boolean }) {
  const [shown, setShown] = useState(reduced ? value : 0);
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 1200);
      setShown(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, reduced]);
  return <span className="tabular-nums">{fmt(reduced ? value : shown)}</span>;
}
