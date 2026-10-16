"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  DropletsIcon,
  ExternalLinkIcon,
  FlameIcon,
  ListIcon,
  MonitorPlayIcon,
  NavigationIcon,
  NewspaperIcon,
  RadioIcon,
  ShieldAlertIcon,
  SmartphoneIcon,
  ThermometerIcon,
  TimerIcon,
  TriangleAlertIcon,
  WavesIcon,
  WindIcon,
} from "lucide-react";
import { ViewTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import NewsPortalModal from "@/components/dashboard/NewsPortalModal";
import { AirCard, FilterPanel, ImpactPanel } from "@/components/dashboard/ImpactPanels";
import PresentationMode, { type Cut, type PresentationLayers } from "@/components/dashboard/PresentationMode";
import BootSequence from "@/components/dashboard/BootSequence";
import { useCrises } from "@/hooks/useCrises";
import { DangerAreaList } from "@/components/dashboard/DangerAreas";
import { buildDangerAreas, type DangerArea } from "@/lib/dangerAreas";
import type { CameraShot } from "@/components/map/types";
import { useKarhutlaNews } from "@/hooks/useKarhutlaNews";
import type { NewsArticle } from "@/lib/news";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { cellKey, useIncidents, type FirmsState, type HotspotFilter } from "@/hooks/useIncidents";
import { useNow } from "@/hooks/useNow";
import { FEED_LABEL, useApiHealth, type FeedId } from "@/lib/apiHealth";
import { headFireRate, moistureRetardation, weatherAtHour } from "@/lib/simulationEngine";
import { useMapEngine, type MapEngineState } from "@/hooks/useMapEngine";
import TimelineSlider from "@/components/map/TimelineSlider";
import type { MapStyleId } from "@/lib/basemaps";
import { MAP_STYLES } from "@/lib/basemaps";

// Both engines touch `window` on import (Leaflet immediately, MapLibre on map creation),
// so they load client-only. Leaflet is only loaded if MapLibre fails (no WebGL, timeout).
const MapLibreMap = dynamic(() => import("@/components/map/MapLibreMap"), { ssr: false });
const LeafletMap = dynamic(() => import("@/components/map/LeafletMap"), { ssr: false });
import {
  BmkgVillages,
  DEFAULT_ADM4,
  FIRE_STATUS_LABEL,
  FIRE_STATUS_COLOR,
  FIRE_STATUS_ORDER,
  THREAT_LABEL,
  THREAT_COLOR,
  wibTime,
  compassName,
  isSmoldering,
  type FireStatus,
  type HotspotIncident,
  type WeatherSource,
} from "@/lib/gambut";

/** Short labels for the top-bar counters (full labels live in FIRE_STATUS_LABEL). */
const STATUS_SHORT: Record<FireStatus, string> = {
  CONFIRMED_FLAMING: "Api aktif",
  CONFIRMED_SMOLDERING: "Smoldering",
  SUSPECTED_SMOLDERING: "Suspek smoldering",
  UNVERIFIED_HOTSPOT: "Belum verifikasi",
  EXTINGUISHED: "Padam",
};

const LIST_PAGE = 30;

const noop = () => {};

/** No input for this long starts the presentation as a screensaver. */
const IDLE_MS = 3 * 60_000;

/** Sidebar split by job: act on a fire, see the toll, read conditions, tune the map, check the feeds. */
const SIDEBAR_TABS = [
  { id: "area", label: "Area" },
  { id: "insiden", label: "Insiden" },
  { id: "dampak", label: "Dampak" },
  { id: "cuaca", label: "Cuaca" },
  { id: "peta", label: "Peta" },
  { id: "info", label: "Info" },
] as const;
type SidebarTab = (typeof SIDEBAR_TABS)[number]["id"];

export default function DashboardPage() {
  const {
    incidents,
    hotspots,
    air,
    filter,
    setFilter,
    viewStats,
    population,
    regions,
    areaNews,
    statusCounts,
    pendingWeather,
    overflow,
    selectedId,
    focusId,
    selectedIncident,
    weather,
    weatherSource,
    weatherError,
    incidentWeatherSource,
    maritime,
    satelliteNotice,
    selectIncident,
    setViewport,
    firms,
  } = useIncidents();

  const { state: engineState, markReady, markFailed } = useMapEngine();
  const [mapStyle, setMapStyle] = useState<MapStyleId>("dark");
  const [panelOpen, setPanelOpen] = useState(false);
  const [newsOpen, setNewsOpen] = useState(false);
  const [hourOffset, setHourOffset] = useState(0);
  const [legendOpen, setLegendOpen] = useState(false);
  const [tab, setTab] = useState<SidebarTab>("area");
  // "manual" from the button (full screen, exits only on Esc/close), "idle" as screensaver (any input exits)
  const [tour, setTour] = useState<null | "manual" | "idle">(null);
  const [cut, setCut] = useState<Cut>("full");
  const [tourLayers, setTourLayers] = useState<PresentationLayers | null>(null);
  const [camera, setCamera] = useState<CameraShot | null>(null);
  const [booting, setBooting] = useState(true);
  const crises = useCrises();

  const startTour = (c: Cut) => {
    setCut(c);
    setTour("manual");
    document.documentElement.requestFullscreen?.().catch(() => {
      // Full screen is optional (blocked in some embeds)
    });
  };
  const exitTour = useCallback(() => {
    setTour(null);
    setCamera(null);
    setTourLayers(null);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, []);

  // Screensaver: start after IDLE_MS without input; while idle-started, any input ends it
  useEffect(() => {
    const idle = () => setTour((t) => t ?? "idle");
    let timer = window.setTimeout(idle, IDLE_MS);
    const onInput = () => {
      window.clearTimeout(timer);
      if (tour === "idle") exitTour();
      timer = window.setTimeout(idle, IDLE_MS);
    };
    const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, onInput, { passive: true }));
    return () => {
      window.clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, onInput));
    };
  }, [tour, exitTour]);

  // Leaving full screen with the browser's own control also ends a manual tour
  useEffect(() => {
    const onFs = () => {
      if (!document.fullscreenElement && tour === "manual") exitTour();
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, [tour, exitTour]);

  const {
    articles: newsArticles,
    loading: newsLoading,
    hasNews,
    refresh: refreshNews,
    updatedAt: newsUpdatedAt,
  } = useKarhutlaNews();

  const selected = selectedIncident;
  const selectedStep =
    selected === null
      ? null
      : hourOffset === 0
        ? selected.nowcastPolygon
        : (selected.forecastPolygons.find((p) => p.hourOffset === hourOffset) ??
          selected.forecastPolygons[selected.forecastPolygons.length - 1]);
  const threatenedAreaHa = selectedStep?.burnedAreaHa ?? 0;
  const spreadRate =
    selected && selected.forecastPolygons.length > 0
      ? Math.max(
          1,
          (selected.forecastPolygons[selected.forecastPolygons.length - 1].maxSpreadRadiusM -
            selected.nowcastPolygon.maxSpreadRadiusM) /
            12,
        )
      : 0;

  const dangerAreas = useMemo(
    () => buildDangerAreas({ incidents, regions, areaNews, air, population, cellOf: cellKey }),
    [incidents, regions, areaNews, air, population],
  );

  const tourReady = useMemo(() => {
    const named = dangerAreas.filter((a) => !a.id.startsWith("cell:")).length;
    const news = dangerAreas.reduce((n, a) => n + a.news.length, 0);
    const pop = Object.keys(population).length;
    const parts = [
      dangerAreas.length ? named / dangerAreas.length : 0,
      Math.min(1, pop / Math.min(20, Math.max(1, incidents.length))),
      incidents.length ? 1 - pendingWeather / (incidents.length + pendingWeather) : 0,
    ];
    return { named, news, population: pop, ratio: parts.reduce((a, b) => a + b, 0) / parts.length };
  }, [dangerAreas, population, incidents.length, pendingWeather]);

  const mapProps = {
    incidents,
    hotspots,
    air,
    selectedId,
    // During the tour the script drives the camera, not selections
    focusId: tour ? null : focusId,
    camera,
    chromeless: tour !== null,
    hourOffset,
    mapStyle,
    crises: crises.data?.events,
    showCrises: tourLayers?.crises,
    showSatellites: tourLayers?.satellites,
    onSelectIncident: selectIncident,
    // The tour keeps the data it preloaded: camera flights must not swap the fire set
    onViewportChange: tour ? noop : setViewport,
  };

  // Wind shown on the map widget: the selected fire's forecast at the timeline hour
  const widgetNow = useNow();
  const widgetWind =
    selected && widgetNow ? weatherAtHour(selected.weather, widgetNow, hourOffset) : weather;

  // Not rendered during the tour: it is hidden, and re-rendering it on every hour tick costs CPU
  const sidebar = tour ? null : (
    <SidebarContent
      tab={tab}
      setTab={setTab}
      engineState={engineState}
      mapStyle={mapStyle}
      setMapStyle={setMapStyle}
      weather={weather}
      weatherSource={weatherSource}
      weatherError={weatherError}
      maritime={maritime}
      incidents={incidents}
      pendingWeather={pendingWeather}
      overflow={overflow}
      firms={firms}
      incidentWeatherSource={incidentWeatherSource}
      air={air}
      filter={filter}
      setFilter={setFilter}
      shownHotspots={hotspots.length}
      dangerAreas={dangerAreas}
      viewStats={viewStats}
      population={population}
      selectedId={selectedId}
      selectedIncident={selectedIncident}
      selectIncident={selectIncident}
      hourOffset={hourOffset}
      newsArticles={newsArticles}
      hasNews={hasNews}
      onOpenNews={() => setNewsOpen(true)}
    />
  );

  return (
    <div className="flex h-screen min-h-screen w-full flex-col overflow-hidden bg-background text-foreground">
      {/* Top bar */}
      <header
        hidden={tour !== null}
        className="z-20 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b bg-card/95 px-3 py-2.5 backdrop-blur md:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label={panelOpen ? "Tutup panel" : "Buka panel"}
            onClick={() => setPanelOpen((v) => !v)}
          >
            <RadioIcon />
          </Button>
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-orange-600/20">
            <FlameIcon className="size-4 text-orange-400" />
          </div>
          <div className="min-w-0">
            <ViewTransition name="gw-brand" share="gw-morph" default="none">
              <h1 className="truncate text-sm font-bold tracking-tight">
                GambutWatch <span className="text-orange-400">Tactical DSS</span>
              </h1>
            </ViewTransition>
            <p className="hidden truncate text-[10px] text-muted-foreground sm:block">
              Fokus Indonesia · titik api NASA FIRMS seluruh dunia
            </p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {/* Every status in one strip: Indonesia count, label on wide screens, world total in the tooltip */}
          <ul
            className="flex items-center divide-x divide-white/10 rounded-md border border-white/10 text-xs tabular-nums"
            aria-label="Jumlah titik api Indonesia per status"
          >
            {FIRE_STATUS_ORDER.map((status) => (
              <li
                key={status}
                className="flex items-center gap-1.5 px-2 py-1"
                title={`${FIRE_STATUS_LABEL[status]}: ${statusCounts.indonesia[status].toLocaleString(
                  "id-ID",
                )} di Indonesia, ${statusCounts.world[status].toLocaleString("id-ID")} di seluruh dunia`}
              >
                <span
                  className={`inline-block size-2 rounded-full ${isSmoldering(status) ? "smolder-blink" : ""}`}
                  style={{ background: FIRE_STATUS_COLOR[status] }}
                />
                <span className="text-slate-100">{statusCounts.indonesia[status].toLocaleString("id-ID")}</span>
                <span className="hidden text-muted-foreground 2xl:inline">{STATUS_SHORT[status]}</span>
                <span className="sr-only 2xl:hidden">{STATUS_SHORT[status]}</span>
              </li>
            ))}
          </ul>
          <div
            className="flex items-center rounded-md border border-white/10"
            title={`Data dimuat di latar: ${tourReady.named}/${dangerAreas.length} area bernama, ${tourReady.news} berita, penduduk ${tourReady.population} titik. Adegan tanpa data lengkap dilewati.`}
          >
            <MonitorPlayIcon className="ml-2 size-3.5 text-slate-300" aria-hidden />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => startTour("short")}
              disabled={incidents.length === 0}
              className="h-7 px-2 text-xs"
              aria-label="Presentasi ringkas 60 detik: urgensi dan zona prioritas"
            >
              60 dtk
            </Button>
            <span className="h-4 w-px bg-white/10" aria-hidden />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => startTour("full")}
              disabled={incidents.length === 0}
              className="h-7 px-2 text-xs"
              aria-label="Presentasi lengkap: semua data, krisis, berita dan respons"
            >
              Lengkap
            </Button>
            {/* Fills as area names, news and population finish preloading */}
            <span
              className="relative mr-2 h-1 w-6 overflow-hidden rounded-full bg-white/15"
              role="img"
              aria-label={`Data presentasi ${Math.round(tourReady.ratio * 100)}% siap`}
            >
              <span
                className="absolute inset-y-0 left-0 bg-emerald-400 transition-[width] duration-500"
                style={{ width: `${tourReady.ratio * 100}%` }}
              />
            </span>
          </div>
          {hasNews && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setNewsOpen(true)}
              aria-label={`Buka portal berita karhutla (${newsArticles.length} artikel)`}
              className="h-7 gap-1.5 border-sky-500/40 bg-sky-500/10 px-2.5 text-xs text-sky-200 hover:bg-sky-500/20 hover:text-sky-100"
            >
              <NewspaperIcon className="size-3.5 text-sky-400" />
              <span className="hidden xl:inline">Berita</span>
              <span className="rounded-full bg-sky-950 px-1 py-0 text-[10px] font-semibold text-sky-300 border border-sky-500/30">
                {newsArticles.length}
              </span>
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-2 text-xs"
            nativeButton={false}
            render={<Link href="/hud" />}
          >
            <SmartphoneIcon className="size-3.5" />
            <span>HUD</span>
            <ExternalLinkIcon className="size-3" />
          </Button>
        </div>
      </header>

      {/* Satellite update notice */}
      <AnimatePresence>
        {/* The routine FIRMS summary lives in Info; the banner is only for outages */}
        {firms.status === "error" && satelliteNotice && !tour && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="overflow-hidden border-b border-orange-500/30 bg-orange-950/40"
          >
            <div className="flex items-start gap-2 px-3 py-2 text-xs text-orange-200 md:px-4">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-orange-400" />
              <span className="shrink-0 font-medium">NASA FIRMS:</span>
              <span>{satelliteNotice}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative flex min-h-0 flex-1">
        {/* Desktop sidebar */}
        <motion.aside
          initial={{ x: -24, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className={`hidden w-[340px] shrink-0 flex-col overflow-hidden border-r bg-card/60 ${tour ? "" : "md:flex"}`}
        >
          {sidebar}
        </motion.aside>

        {/* Mobile drawer */}
        <AnimatePresence>
          {panelOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setPanelOpen(false)}
                className="fixed inset-0 z-40 bg-black/60 md:hidden"
              />
              <motion.aside
                initial={{ x: "-100%" }}
                animate={{ x: 0 }}
                exit={{ x: "-100%" }}
                transition={{ type: "spring", damping: 30, stiffness: 300 }}
                className="fixed inset-y-0 left-0 z-50 flex w-[88%] max-w-sm flex-col overflow-hidden border-r bg-card shadow-2xl md:hidden"
              >
                <div className="flex items-center justify-between border-b px-3 py-2">
                  <span className="text-xs font-semibold text-muted-foreground">Panel Dasbor</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setPanelOpen(false)}
                  >
                    Tutup
                  </Button>
                </div>
                {sidebar}
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        {/* Map: MapLibre 3D engine primary; Leaflet replaces it only after a failure */}
        <main className="relative min-w-0 flex-1">
          {engineState.status !== "fallback" && (
            <div className="absolute inset-0 z-0">
              <MapLibreMap {...mapProps} onReady={markReady} onFail={markFailed} />
            </div>
          )}
          <AnimatePresence>
            {/* Leaflet only when MapLibre has actually failed: mounting it underneath during load
                doubled the tile downloads and drew every fire twice behind the boot screen */}
            {engineState.status === "fallback" && (
              <motion.div
                key="leaflet"
                className="absolute inset-0 z-[5]"
                exit={{ opacity: 0 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
              >
                <LeafletMap {...mapProps} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Wind direction & telemetry widget overlay */}
          {widgetWind && !tour && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="pointer-events-none absolute top-3 right-3 z-10 hidden items-center gap-2.5 rounded-xl border border-white/10 bg-slate-950/85 px-3 py-2 text-xs shadow-lg backdrop-blur sm:flex"
            >
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-sky-400/40 bg-sky-500/10">
                <NavigationIcon
                  className="size-4 text-sky-400 transition-transform duration-300"
                  style={{ transform: `rotate(${widgetWind.windVectorDeg}deg)` }}
                />
              </div>
              <div className="flex flex-col text-[11px] leading-tight">
                <span className="font-semibold text-slate-200">
                  {selected ? `Angin di ${selected.id}` : "Angin Rasau Jaya"}
                  {hourOffset > 0 ? ` (prakiraan t+${hourOffset} jam)` : ""}: ke{" "}
                  {compassName(widgetWind.windVectorDeg)} ({Math.round(widgetWind.windVectorDeg)}°)
                </span>
                <span className="text-slate-400">
                  {Math.round(widgetWind.windSpeedKmh)} km/jam · RH{" "}
                  {Math.round(widgetWind.relativeHumidity)}% · {Math.round(widgetWind.temperatureC)}°C
                </span>
              </div>
            </motion.div>
          )}

          {/* Legend: collapsed to one button so the map stays readable */}
          <div className={`absolute top-16 left-3 z-10 hidden ${tour ? "" : "sm:block"}`}>
            <Button
              size="sm"
              variant="outline"
              aria-expanded={legendOpen}
              aria-controls="map-legend"
              onClick={() => setLegendOpen((v) => !v)}
              className="h-7 border-white/10 bg-slate-950/80 px-2 text-[11px] backdrop-blur"
            >
              <ListIcon className="size-3.5" />
              Legenda
            </Button>
            <AnimatePresence>
              {legendOpen && (
                <motion.div
                  id="map-legend"
                  initial={{ opacity: 0, y: -4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.98 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className="mt-1.5 flex max-h-[55vh] flex-col gap-1 overflow-y-auto rounded-xl border border-white/10 bg-slate-950/90 p-2.5 text-[10px] backdrop-blur"
                >
                  {FIRE_STATUS_ORDER.map((status) => (
                    <div key={status} className="flex items-center gap-1.5">
                      <span
                        className="inline-block size-2.5 rounded-full"
                        style={{ background: FIRE_STATUS_COLOR[status] }}
                      />
                      {FIRE_STATUS_LABEL[status]}
                    </div>
                  ))}
                  <div className="flex items-center gap-1.5">
                    <span className="inline-flex w-2.5 justify-center">
                      <span className="inline-block size-1 rounded-full bg-slate-400 opacity-60" />
                    </span>
                    Titik kecil: di luar Indonesia
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block h-0.5 w-5 border-t-2 border-dashed border-yellow-400" />
                    Rekomendasi sekat bakar
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block size-2.5 rounded-full border-2 border-orange-300" />
                    Cincin berdenyut: terdeteksi 3 jam terakhir
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-4 rounded-sm bg-slate-500/50" />
                    Arah asap (model angin)
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-4 rounded-sm border border-red-500/60 bg-red-500/20" />
                    Kotak kualitas udara (warna AQI)
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block h-0.5 w-5 border-t-2 border-dashed border-emerald-500" />
                    Arah evakuasi dari desa terancam
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block h-0.5 w-5 bg-sky-500" />
                    Vektor dorongan angin &amp; kepala api
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-4 rounded-sm border border-lime-700 bg-[#1a2e05]/40" />
                    Batas KHG
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block size-2.5 rounded-full bg-sky-400" />
                    Desa (cincin: tingkat ancaman)
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {booting && (
            <BootSequence mapReady={engineState.status !== "loading"} onDone={() => setBooting(false)} />
          )}

          {tour && (
            <PresentationMode
              cut={cut}
              crises={crises.data}
              news={newsArticles}
              setLayers={setTourLayers}
              areas={dangerAreas}
              viewStats={viewStats}
              incidents={incidents}
              statusCounts={statusCounts}
              firms={firms}
              air={air}
              hourOffset={hourOffset}
              setHourOffset={setHourOffset}
              selectIncident={selectIncident}
              setCamera={setCamera}
              onExit={exitTour}
            />
          )}

          {!tour && (
          <TimelineSlider
            hourOffset={hourOffset}
            onChange={setHourOffset}
            spreadRate={spreadRate}
            threatenedAreaHa={threatenedAreaHa}
          />
          )}
        </main>
      </div>

      {/* Footer */}
      <footer hidden={tour !== null} className="shrink-0 border-t bg-card/60 px-3 py-1.5 text-center text-[10px] text-muted-foreground md:px-4">
        Sumber data: BMKG (prakiraan cuaca &amp; maritim), Open-Meteo · Data hotspot: NASA FIRMS
        (VIIRS S-NPP, NOAA-20, NOAA-21, MODIS Terra/Aqua) · Batas Indonesia: geoBoundaries ·
        Peta &amp; permukiman: OpenFreeMap &amp; OpenStreetMap
      </footer>

      <NewsPortalModal
        open={newsOpen}
        onClose={() => setNewsOpen(false)}
        articles={newsArticles}
        loading={newsLoading}
        onRefresh={refreshNews}
        updatedAt={newsUpdatedAt}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ sidebar */

interface SidebarContentProps {
  tab: SidebarTab;
  setTab: (t: SidebarTab) => void;
  engineState: MapEngineState;
  mapStyle: MapStyleId;
  setMapStyle: (id: MapStyleId) => void;
  weather: ReturnType<typeof useIncidents>["weather"];
  weatherSource: WeatherSource | null;
  weatherError: string | null;
  maritime: ReturnType<typeof useIncidents>["maritime"];
  incidents: HotspotIncident[];
  pendingWeather: number;
  overflow: number;
  firms: FirmsState;
  incidentWeatherSource: ReturnType<typeof useIncidents>["incidentWeatherSource"];
  air: ReturnType<typeof useIncidents>["air"];
  dangerAreas: DangerArea[];
  viewStats: ReturnType<typeof useIncidents>["viewStats"];
  population: ReturnType<typeof useIncidents>["population"];
  filter: HotspotFilter;
  setFilter: (f: HotspotFilter) => void;
  shownHotspots: number;
  selectedId: string | null;
  selectedIncident: HotspotIncident | null;
  selectIncident: (id: string) => void;
  hourOffset: number;
  newsArticles: NewsArticle[];
  hasNews: boolean;
  onOpenNews: () => void;
}

function SidebarContent({
  tab,
  setTab,
  engineState,
  mapStyle,
  setMapStyle,
  weather,
  weatherSource,
  weatherError,
  maritime,
  incidents,
  pendingWeather,
  overflow,
  firms,
  incidentWeatherSource,
  air,
  dangerAreas,
  viewStats,
  population,
  filter,
  setFilter,
  shownHotspots,
  selectedId,
  selectedIncident,
  selectIncident,
  hourOffset,
  newsArticles,
  hasNews,
  onOpenNews,
}: SidebarContentProps) {
  const [shown, setShown] = useState(LIST_PAGE);
  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as SidebarTab)}
      className="flex h-full min-h-0 flex-col gap-0"
    >
      <TabsList className="mx-3 mt-3 w-[calc(100%-1.5rem)] shrink-0">
        {SIDEBAR_TABS.map((t) => (
          <TabsTrigger key={t.id} value={t.id} className="px-1 text-[11px]">
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-3">
          <TabsContent value="area" className="flex flex-col gap-3">
            <DangerAreaList areas={dangerAreas} hourOffset={hourOffset} onFocus={selectIncident} />
          </TabsContent>

          <TabsContent value="insiden" className="flex flex-col gap-3">
            {/* AI tactical briefing */}
            <section className="space-y-2">
              <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Udara, Taktik &amp; Briefing
              </h2>
              {selectedIncident && (
                <AirCard air={air[cellKey(selectedIncident.originLat, selectedIncident.originLng)]} />
              )}
              {selectedIncident ? (
                <BriefingBox
                  incident={selectedIncident}
                  hourOffset={hourOffset}
                  weatherSource={incidentWeatherSource[selectedIncident.id]}
                />
              ) : (
                <p className="text-xs text-muted-foreground">Pilih insiden untuk melihat briefing.</p>
              )}
            </section>

            <Separator />

            {/* Incident list */}
            <section className="space-y-2">
              <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Insiden di Area Peta ({incidents.length})
              </h2>
              <p className="text-[10px] text-muted-foreground">
                Diurutkan: Indonesia dulu, lalu status, ancaman desa, dan FRP. Geser atau perbesar peta
                untuk memilih area.
              </p>
              {firms.status === "loading" ? (
                <p className="rounded-md border border-white/10 bg-slate-950/60 px-3 py-4 text-center text-xs text-muted-foreground">
                  Memuat titik api NASA FIRMS dari semua satelit...
                </p>
              ) : incidents.length === 0 ? (
                <p className="rounded-md border border-white/10 bg-slate-950/60 px-3 py-4 text-center text-xs text-muted-foreground">
                  {firms.status === "error"
                    ? (firms.reason ?? "NASA FIRMS tidak merespons.")
                    : pendingWeather > 0
                      ? `${pendingWeather} titik api menunggu prakiraan cuaca area sebelum disimulasikan.`
                      : "Tidak ada titik api NASA FIRMS di area peta ini. Perkecil peta untuk melihat wilayah lain."}
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  <AnimatePresence mode="popLayout" initial={false}>
                    {incidents.slice(0, shown).map((incident) => (
                      <IncidentCard
                        key={incident.id}
                        incident={incident}
                            selected={incident.id === selectedId}
                        onSelect={() => selectIncident(incident.id)}
                      />
                    ))}
                  </AnimatePresence>
                  {incidents.length > shown && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-[44px] text-xs sm:min-h-8"
                      onClick={() => setShown((n) => n + LIST_PAGE)}
                    >
                      Tampilkan {Math.min(LIST_PAGE, incidents.length - shown)} insiden lagi
                    </Button>
                  )}
                </div>
              )}
              {(pendingWeather > 0 && incidents.length > 0) || overflow > 0 ? (
                <p className="text-[10px] text-muted-foreground">
                  {pendingWeather > 0 && incidents.length > 0
                    ? `${pendingWeather} titik lagi menunggu prakiraan cuaca. `
                    : ""}
                  {overflow > 0
                    ? `${overflow.toLocaleString("id-ID")} titik lain di area ini tampil di peta tanpa simulasi; perbesar peta untuk mensimulasikannya.`
                    : ""}
                </p>
              ) : null}
            </section>
          </TabsContent>

          <TabsContent value="dampak" className="flex flex-col gap-3">
            <ImpactPanel
              incidents={incidents}
              hourOffset={hourOffset}
              air={air}
              areas={dangerAreas}
              viewStats={viewStats}
              population={population}
            />
          </TabsContent>

          <TabsContent value="cuaca" className="flex flex-col gap-3">
            {/* Weather telemetry */}
            <section className="space-y-2">
              <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Telemetri Cuaca{" "}
                <span className="text-orange-400">
                  {weatherSource === "bmkg" ? "BMKG" : weatherSource === "open-meteo" ? "Open-Meteo" : ""}
                </span>
              </h2>
              {!weather && (
                <p className="rounded-md border border-white/10 bg-slate-950/60 px-3 py-3 text-xs text-muted-foreground">
                  {weatherError ?? "Memuat prakiraan BMKG..."}
                </p>
              )}
              {weather && (
                <Card className="border-white/10 bg-slate-950/60">
                  <CardContent className="space-y-2.5 p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate text-xs text-muted-foreground">
                        {BmkgVillages[0].name} ({DEFAULT_ADM4})
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {wibTime(weather.updatedAt)}
                      </span>
                    </div>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
                      <dt className="flex items-center gap-1.5 text-muted-foreground">
                        <WindIcon className="size-3.5" />
                        Angin
                      </dt>
                      <dd className="text-right font-semibold tabular-nums">
                        {Math.round(weather.windSpeedKmh)} km/jam
                      </dd>
                      <dt className="flex items-center gap-1.5 text-muted-foreground">
                        <NavigationIcon
                          className="size-3.5 text-sky-400 transition-transform duration-300"
                          style={{ transform: `rotate(${weather.windVectorDeg}deg)` }}
                        />
                        Dorongan
                      </dt>
                      <dd className="text-right font-semibold tabular-nums">
                        {compassName(weather.windVectorDeg)}{" "}
                        <span className="text-muted-foreground">
                          {Math.round(weather.windVectorDeg)}°
                        </span>
                      </dd>
                      <dt className="flex items-center gap-1.5 text-muted-foreground">
                        <DropletsIcon className="size-3.5" />
                        Kelembapan
                      </dt>
                      <dd className="text-right font-semibold tabular-nums">
                        {Math.round(weather.relativeHumidity)} % RH
                      </dd>
                      <dt className="flex items-center gap-1.5 text-muted-foreground">
                        <ThermometerIcon className="size-3.5" />
                        Suhu udara
                      </dt>
                      <dd className="text-right font-semibold tabular-nums">
                        {Math.round(weather.temperatureC)}°C
                      </dd>
                    </dl>
                    <div className="flex justify-end">
                      <Badge
                        variant="outline"
                        className={
                          weather.relativeHumidity < 60
                            ? "border-red-500/40 text-red-300"
                            : weather.relativeHumidity < 75
                              ? "border-amber-500/40 text-amber-300"
                              : "border-sky-500/40 text-sky-300"
                        }
                      >
                        {weather.relativeHumidity < 60
                          ? "Kering: risiko tinggi"
                          : weather.relativeHumidity < 75
                            ? "Cukup lembap"
                            : "Lembap"}
                      </Badge>
                    </div>
                    <ForecastStrip weather={weather} />
                    {maritime && (
                      <div className="flex items-start gap-2 rounded-md bg-sky-950/40 p-2 text-[11px] text-sky-200">
                        <WavesIcon className="mt-0.5 size-3.5 shrink-0 text-sky-400" />
                        <span>
                          {maritime.name} ({maritime.code}) · {maritime.weather} · angin{" "}
                          {Math.round(maritime.windSpeedKmh)} km/jam dari {maritime.windFrom} ·
                          gelombang{" "}
                          {maritime.waveHeightM !== null ? `${maritime.waveHeightM.toFixed(1)} m` : "-"}
                        </span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </section>
          </TabsContent>

          <TabsContent value="peta" className="flex flex-col gap-3">
            {/* Map: engine status + style tabs (same layout as the original app) */}
            <section className="space-y-2">
              <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Peta
              </h2>
              <EngineStatus state={engineState} />
              <Tabs value={mapStyle} onValueChange={(v) => setMapStyle(v as MapStyleId)}>
                <TabsList className="w-full">
                  {MAP_STYLES.map((s) => (
                    <TabsTrigger key={s.id} value={s.id}>
                      {s.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              {engineState.status === "fallback" && (
                <p className="text-[10px] text-muted-foreground">
                  Gaya peta hanya tersedia pada mesin 3D; peta cadangan memakai raster
                  OpenStreetMap.
                </p>
              )}
            </section>

            <Separator />

            <FilterPanel filter={filter} onChange={setFilter} shown={shownHotspots} />
          </TabsContent>

          <TabsContent value="info" className="flex flex-col gap-3">
            <DataStatus firms={firms} />

            {hasNews && newsArticles.length > 0 && (
              <>
                <Separator />
                <section className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      Warta Karhutla &amp; BMKG
                    </h2>
                    <Badge
                      variant="outline"
                      className="border-sky-500/30 bg-sky-500/10 px-1.5 py-0 text-[10px] text-sky-300"
                    >
                      {newsArticles.length} Warta
                    </Badge>
                  </div>
                  <div className="flex flex-col gap-2">
                    {newsArticles.slice(0, 2).map((article) => (
                      <div
                        key={article.id}
                        className="rounded-lg border border-white/10 bg-slate-950/60 p-2.5 transition-colors hover:border-slate-700"
                      >
                        <div className="mb-1 flex items-center justify-between gap-1">
                          <span className="text-[10px] font-medium text-sky-400">
                            {article.source}
                          </span>
                          <time dateTime={article.publishedAt} className="text-[9px] text-muted-foreground">
                            {wibTime(article.publishedAt)}
                          </time>
                        </div>
                        <a
                          href={article.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="line-clamp-2 text-xs font-medium text-slate-200 hover:text-sky-300 hover:underline"
                        >
                          {article.title}
                        </a>
                      </div>
                    ))}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onOpenNews}
                      className="h-8 w-full min-h-[44px] sm:min-h-[32px] text-xs border-sky-500/30 bg-sky-950/40 text-sky-200 hover:bg-sky-900/60"
                    >
                      <NewspaperIcon className="mr-1.5 size-3.5 text-sky-400" />
                      Buka Portal Berita ({newsArticles.length})
                    </Button>
                  </div>
                </section>
              </>
            )}

            <Separator />

            {/* Field HUD sync (automatic) */}
            <section className="space-y-2">
              <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Sinkronisasi Lapangan
              </h2>
              <div className="rounded-md border border-white/10 bg-slate-950/60 px-3 py-2 text-[11px] text-muted-foreground">
                Buka /hud di perangkat lapangan (tablet/HP MPA): briefing dan status verifikasi
                tersinkron otomatis antar tab pada origin yang sama (BroadcastChannel + local
                storage sebagai cadangan offline).
              </div>
            </section>
          </TabsContent>
        </div>
      </ScrollArea>
    </Tabs>
  );
}

/* ------------------------------------------------------------------ widgets */

function EngineStatus({ state }: { state: MapEngineState }) {
  const label =
    state.status === "ready"
      ? "MapLibre GL · WebGL 3D"
      : state.status === "fallback"
        ? `Peta cadangan Leaflet (${state.reason})`
        : "Memuat mesin peta 3D…";
  const color =
    state.status === "ready"
      ? "text-emerald-400"
      : state.status === "fallback"
        ? "text-amber-400"
        : "text-sky-400";
  return (
    <div className="flex items-center gap-2 rounded-md border border-white/10 bg-slate-950/60 px-2.5 py-1.5">
      <span className={`size-2 shrink-0 rounded-full bg-current ${color}`} />
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}

function IncidentCard({
  incident,
  selected,
  onSelect,
}: {
  incident: HotspotIncident;
  selected: boolean;
  onSelect: () => void;
}) {
  const statusColor = FIRE_STATUS_COLOR[incident.status];
  const village = incident.nearestVillage;
  const threatLevel = village?.threatLevel ?? null;

  return (
    <motion.button
      layout
      type="button"
      onClick={onSelect}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={`flex w-full items-center gap-2.5 rounded-lg border p-2.5 text-left transition-colors ${
        selected
          ? "border-orange-500/60 bg-orange-950/30"
          : "border-white/10 bg-slate-950/60 hover:bg-slate-900"
      }`}
    >
      <span
        className={`size-3 shrink-0 rounded-full ${isSmoldering(incident.status) ? "smolder-blink" : ""}`}
        style={{ background: statusColor }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs font-semibold">
            {village?.name ?? incident.id}
            {!incident.inIndonesia && (
              <span className="ml-1 font-normal text-muted-foreground">(luar Indonesia)</span>
            )}
          </span>
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
            FRP {incident.frpMegawatt} MW
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className="truncate text-[10px] text-muted-foreground">
            <span className="sr-only">{FIRE_STATUS_LABEL[incident.status]}, </span>
            {incident.satellites.length} satelit · {incident.detectionCount} piksel
          </span>
          {threatLevel && (
            <Badge
              variant="outline"
              className="shrink-0 text-[9px]"
              style={{ borderColor: THREAT_COLOR[threatLevel], color: THREAT_COLOR[threatLevel] }}
            >
              {THREAT_LABEL[threatLevel]}
            </Badge>
          )}
        </div>
        {village && (threatLevel === "SIAGA" || threatLevel === "BAHAYA") && (
          <p className="mt-0.5 flex items-center gap-1 text-[10px] text-orange-300">
            <TimerIcon className="size-3" />
            {village.name} dalam {Math.round(village.etaMinutes)} menit
          </p>
        )}
      </div>
    </motion.button>
  );
}

/** Forecast wind for the next 12 hours: where the push will turn. */
function ForecastStrip({ weather }: { weather: NonNullable<ReturnType<typeof useIncidents>["weather"]> }) {
  const now = useNow();
  if (!now || !weather.forecast || weather.forecast.length < 2) return null;
  const hours = [0, 3, 6, 9, 12];
  return (
    <div>
      <p className="mb-1 text-[10px] text-muted-foreground">Prakiraan dorongan angin</p>
      <ol className="grid grid-cols-5 gap-1 text-center text-[10px]">
        {hours.map((h) => {
          const w = weatherAtHour(weather, now, h);
          return (
            <li key={h} className="rounded-md bg-slate-900/80 px-1 py-1.5">
              <span className="block text-muted-foreground">{h === 0 ? "kini" : `+${h}j`}</span>
              <NavigationIcon
                className="mx-auto my-0.5 size-3.5 text-sky-400"
                style={{ transform: `rotate(${w.windVectorDeg}deg)` }}
                aria-label={`ke ${compassName(w.windVectorDeg)}`}
              />
              <span className="block font-semibold tabular-nums">{Math.round(w.windSpeedKmh)}</span>
              <span className="block text-muted-foreground tabular-nums">
                {w.precipitationMmH > 0.1 ? `${w.precipitationMmH.toFixed(1)}mm` : `${Math.round(w.relativeHumidity)}%`}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-1 text-[10px] text-muted-foreground">km/jam · RH, atau hujan mm/jam</p>
    </div>
  );
}

const FEED_ORDER: FeedId[] = ["firms", "bmkg", "grid", "maritime", "news", "place"];

function formatMs(ms: number | null): string {
  if (ms === null) return "cache";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}

/** Per-feed connection status: data received, browser round trip, server-to-provider time. */
function DataStatus({ firms }: { firms: FirmsState }) {
  const health = useApiHealth();
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Status Sumber Data
      </h2>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-left text-[10px] text-muted-foreground">
            <th className="pb-1 font-normal">Sumber</th>
            <th className="pb-1 text-right font-normal" title="Browser ke server aplikasi dan kembali">
              Respons
            </th>
            <th className="pb-1 text-right font-normal" title="Server aplikasi ke penyedia data">
              Penyedia
            </th>
          </tr>
        </thead>
        <tbody>
          {FEED_ORDER.map((id) => {
            const h = health[id];
            return (
              <tr key={id} className="border-t border-white/5" title={h?.error ?? undefined}>
                <td className="py-1">
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`size-2 shrink-0 rounded-full ${
                        !h ? "bg-slate-600" : h.ok ? "bg-emerald-400" : "bg-red-500"
                      }`}
                    />
                    <span className="truncate">{FEED_LABEL[id]}</span>
                    {h?.ok && h.items !== null && (
                      <span className="text-muted-foreground tabular-nums">
                        {h.items.toLocaleString("id-ID")}
                      </span>
                    )}
                  </span>
                  {h && !h.ok && <span className="block truncate text-[10px] text-red-300">{h.error}</span>}
                </td>
                <td className="py-1 text-right tabular-nums">{h ? formatMs(h.roundTripMs) : "-"}</td>
                <td className="py-1 text-right tabular-nums text-muted-foreground">
                  {h ? formatMs(h.upstreamMs) : "-"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {firms.sources.length > 0 && (
        <ul className="space-y-0.5 text-[10px] text-muted-foreground">
          {firms.sources.map((src) => (
            <li key={src.id} className="flex justify-between gap-2">
              <span>
                <span className={src.ok ? "text-emerald-400" : "text-red-400"}>{src.ok ? "OK" : "GAGAL"}</span>{" "}
                {src.label}
              </span>
              <span className="tabular-nums">{src.detections.toLocaleString("id-ID")} piksel</span>
            </li>
          ))}
          {firms.fetchedAt && <li>Data FIRMS ditarik {wibTime(firms.fetchedAt)}</li>}
        </ul>
      )}
      <p className="text-[10px] text-muted-foreground">
        &quot;Penyedia&quot; berisi cache bila server memakai data yang sudah ditarik.
      </p>
    </section>
  );
}

function BriefingBox({
  incident,
  hourOffset,
  weatherSource,
}: {
  incident: HotspotIncident;
  hourOffset: number;
  weatherSource?: { source: "bmkg" | "open-meteo"; place?: string | null };
}) {
  const [apiBrief, setApiBrief] = useState<{ key: string; text: string } | null>(null);
  const now = useNow();
  const step =
    hourOffset === 0
      ? incident.nowcastPolygon
      : (incident.forecastPolygons.find((p) => p.hourOffset === hourOffset) ??
        incident.forecastPolygons[incident.forecastPolygons.length - 1]);
  const village = incident.nearestVillage;
  const fb = incident.firebreak;
  const crew = Math.max(1, Math.round(fb.lengthMeters / 150));
  const smoldering = isSmoldering(incident.status);
  const w = incident.weather;
  const headRate = Math.round(
    headFireRate(
      incident.peatlandInfo.baseSpreadRateR0,
      moistureRetardation(w.relativeHumidity),
      w.windVectorDeg,
      w.windSpeedKmh,
    ),
  );

  const deadlineText = now
    ? wibTime(new Date(now.getTime() + fb.etaFireArrivalMinutes * 60_000).toISOString())
    : "-";

  // Refetch only when the briefing inputs change, not on every recomputed object
  const briefKey = [
    incident.id,
    incident.status,
    hourOffset,
    w.updatedAt,
    fb.lengthMeters,
    fb.etaFireArrivalMinutes,
    village?.name ?? "-",
    village?.threatLevel ?? "-",
  ].join("|");
  const payloadRef = useRef<unknown>(null);
  const center = fb.coordinates[2] ?? fb.coordinates[0];
  const payload = {
    incidentId: incident.id,
    status: incident.status,
    telemetry: {
      windSpeedKmh: w.windSpeedKmh,
      windDirectionDeg: w.windDirectionDeg,
      windVectorDeg: w.windVectorDeg,
      relativeHumidity: w.relativeHumidity,
      temperatureC: w.temperatureC,
    },
    firebreak: {
      lengthMeters: fb.lengthMeters,
      etaFireArrivalMinutes: fb.etaFireArrivalMinutes,
      centerLat: center[0],
      centerLng: center[1],
      notes: fb.tacticalNotes,
    },
    nearestVillage: village
      ? {
          name: village.name,
          distanceMeters: village.distanceMeters,
          threatLevel: village.threatLevel,
          safeEvacuationBearingDeg: village.safeEvacuationBearingDeg,
        }
      : null,
    headFireRate: headRate,
    burnedAreaHa: step.burnedAreaHa,
    hourOffset,
  };
  // Declared before the fetch effect, so it runs first and the fetch reads this render's payload
  useEffect(() => {
    payloadRef.current = payload;
  });

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/tactical-brief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloadRef.current),
      signal: controller.signal,
    })
      .then((res) => res.json())
      .then((data: { ok?: boolean; brief?: string }) => {
        if (data.ok && data.brief) setApiBrief({ key: briefKey, text: data.brief });
      })
      .catch(() => {
        // the local summary below stays on screen
      });
    return () => controller.abort();
  }, [briefKey]);

  // A brief written for another incident or hour is never shown
  const brief = apiBrief?.key === briefKey ? apiBrief.text : null;

  return (
    <motion.div
      key={`${incident.id}-${hourOffset}-${incident.status}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="rounded-lg border border-white/10 bg-slate-950/70 p-3"
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <ShieldAlertIcon className="size-4 text-orange-400" />
          <span className="text-xs font-bold">BRIEFING TAKTIS</span>
        </div>
        <Badge variant="outline" className="border-orange-500/30 text-[10px] text-orange-300">
          SOP BPBD
        </Badge>
      </div>
      <div className="space-y-1.5 text-xs leading-relaxed">
        {brief ? (
          <p className="text-slate-200">{brief}</p>
        ) : (
          <>
            <p>
              <span className="font-semibold">Status:</span> {FIRE_STATUS_LABEL[incident.status]}
              {village ? (
                <>
                  {" "}· ancaman ke <span className="font-semibold">{village.name}</span>{" "}
                  <span style={{ color: THREAT_COLOR[village.threatLevel] }}>
                    {THREAT_LABEL[village.threatLevel]}
                  </span>{" "}
                  (jarak {Math.round(village.distanceMeters)} m).
                </>
              ) : (
                " · mencari permukiman terdekat..."
              )}
            </p>
            <p>
              <span className="font-semibold">Kondisi:</span> angin {Math.round(w.windSpeedKmh)} km/jam
              dari {compassName(w.windDirectionDeg)}, kelembapan {Math.round(w.relativeHumidity)}%
              {smoldering ? " (titik panas hilang dari satelit: curigai bara bawah tanah)" : ""}.
            </p>
            <p>
              <span className="font-semibold">Proyeksi:</span> {fb.tacticalNotes}
            </p>
            <p>
              <span className="font-semibold">Instruksi:</span> kerahkan {crew} regu untuk memotong
              jalur sekat bakar sepanjang {Math.round(fb.lengthMeters)} m di garis kuning peta,
              tuntas sebelum pukul {deadlineText}.
            </p>
            <p>
              <span className="font-semibold">Luas terancam:</span> {step.burnedAreaHa.toFixed(1)} ha
              pada t+{hourOffset} jam.
            </p>
          </>
        )}
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">
        Cuaca:{" "}
        {weatherSource
          ? `${weatherSource.source === "bmkg" ? "BMKG" : "Open-Meteo"}${weatherSource.place ? ` (${weatherSource.place})` : ""}`
          : "-"}
        . Titik api: NASA FIRMS, {incident.satellites.join(", ")}. Proyeksi model, verifikasi lapangan
        tetap wajib.
      </p>
    </motion.div>
  );
}
