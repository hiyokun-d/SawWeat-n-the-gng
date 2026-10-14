"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  DropletsIcon,
  ExternalLinkIcon,
  FlameIcon,
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
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import NewsPortalModal from "@/components/dashboard/NewsPortalModal";
import { useKarhutlaNews } from "@/hooks/useKarhutlaNews";
import type { NewsArticle } from "@/app/api/news/route";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { useIncidents } from "@/hooks/useIncidents";
import { useMapEngine, type MapEngineState } from "@/hooks/useMapEngine";
import TimelineSlider from "@/components/map/TimelineSlider";
import type { MapStyleId } from "@/lib/basemaps";
import { MAP_STYLES, OSM_TILES } from "@/lib/basemaps";

// Both engines touch `window` on import (Leaflet immediately, MapLibre on map creation),
// so they load client-only. The engine hook keeps Leaflet mounted under MapLibre until
// MapLibre signals ready, then the Leaflet layer fades out to reveal it.
const MapLibreMap = dynamic(() => import("@/components/map/MapLibreMap"), { ssr: false });
const LeafletMap = dynamic(() => import("@/components/map/LeafletMap"), { ssr: false });
import {
  BmkgVillages,
  DEFAULT_ADM4,
  FIRE_STATUS_LABEL,
  FIRE_STATUS_COLOR,
  THREAT_LABEL,
  THREAT_COLOR,
  wibTime,
  compassName,
  type HotspotIncident,
} from "@/lib/gambut";

export default function DashboardPage() {
  const {
    incidents,
    selectedId,
    selectedIncident,
    weather,
    maritime,
    satelliteNotice,
    selectIncident,
    firmsLive,
  } = useIncidents();

  const { engine, state: engineState, markReady, markFailed } = useMapEngine();
  const [mapStyle, setMapStyle] = useState<MapStyleId>("liberty");
  const [panelOpen, setPanelOpen] = useState(false);
  const [newsOpen, setNewsOpen] = useState(false);
  const [hourOffset, setHourOffset] = useState(0);

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

  const activeCount = incidents.filter(
    (i) => i.status === "CONFIRMED_FLAMING" || i.status === "UNVERIFIED_HOTSPOT",
  ).length;
  const smolderingCount = incidents.filter(
    (i) => i.status === "SUSPECTED_SMOLDERING" || i.status === "CONFIRMED_SMOLDERING",
  ).length;

  const mapProps = {
    incidents,
    selectedId,
    hourOffset,
    mapStyle,
    onSelectIncident: selectIncident,
  };

  const sidebar = (
    <SidebarContent
      engineState={engineState}
      mapStyle={mapStyle}
      setMapStyle={setMapStyle}
      weather={weather}
      maritime={maritime}
      incidents={incidents}
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
      <header className="z-20 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b bg-card/95 px-3 py-2.5 backdrop-blur md:px-4">
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
            <h1 className="truncate text-sm font-bold tracking-tight">
              GambutWatch <span className="text-orange-400">Tactical DSS</span>
            </h1>
            <p className="hidden truncate text-[10px] text-muted-foreground sm:block">
              KHG Sungai Kapuas-Sungai Ambawang · Kubu Raya
            </p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="border-orange-500/40 text-orange-300">
            {activeCount} Hotspot Aktif
          </Badge>
          <Badge variant="outline" className="border-amber-500/40 text-amber-300">
            {smolderingCount} Suspected Smoldering
          </Badge>
          {hasNews && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setNewsOpen(true)}
              aria-label={`Buka portal berita karhutla (${newsArticles.length} artikel)`}
              className="h-7 gap-1.5 border-sky-500/40 bg-sky-500/10 px-2.5 text-xs text-sky-200 hover:bg-sky-500/20 hover:text-sky-100"
            >
              <NewspaperIcon className="size-3.5 text-sky-400" />
              <span className="hidden sm:inline">Portal Berita BMKG</span>
              <span className="sm:hidden">Berita</span>
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
            <span className="hidden sm:inline">Buka HUD Lapangan</span>
            <span className="sm:hidden">HUD</span>
            <ExternalLinkIcon className="size-3" />
          </Button>
        </div>
      </header>

      {/* Satellite update notice */}
      <AnimatePresence>
        {satelliteNotice && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="overflow-hidden border-b border-orange-500/30 bg-orange-950/40"
          >
            <div className="flex items-start gap-2 px-3 py-2 text-xs text-orange-200 md:px-4">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-orange-400" />
              <span className="font-medium">UPDATE SATELIT:</span>
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
          className="hidden w-[340px] shrink-0 flex-col overflow-hidden border-r bg-card/60 md:flex"
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

        {/* Map: MapLibre 3D engine primary, Leaflet fallback underneath until ready,
            then fades away to reveal it (same pattern as the original app) */}
        <main className="relative min-w-0 flex-1">
          {engineState.status !== "fallback" && (
            <div className="absolute inset-0 z-0">
              <MapLibreMap {...mapProps} onReady={markReady} onFail={markFailed} />
            </div>
          )}
          <AnimatePresence>
            {engine === "leaflet" && (
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
          {weather && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="pointer-events-none absolute top-3 right-3 z-10 hidden items-center gap-2.5 rounded-xl border border-white/10 bg-slate-950/85 px-3 py-2 text-xs shadow-lg backdrop-blur sm:flex"
            >
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-sky-400/40 bg-sky-500/10">
                <NavigationIcon
                  className="size-4 text-sky-400 transition-transform duration-300"
                  style={{ transform: `rotate(${weather.windVectorDeg}deg)` }}
                />
              </div>
              <div className="flex flex-col text-[11px] leading-tight">
                <span className="font-semibold text-slate-200">
                  Dorongan Angin: {compassName(weather.windVectorDeg)} ({Math.round(weather.windVectorDeg)}°)
                </span>
                <span className="text-slate-400">
                  {Math.round(weather.windSpeedKmh)} km/jam · RH {Math.round(weather.relativeHumidity)}% · {Math.round(weather.temperatureC)}°C
                </span>
              </div>
            </motion.div>
          )}

          {/* Legend */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="pointer-events-none absolute top-36 left-3 z-10 hidden flex-col gap-1 rounded-xl border border-white/10 bg-slate-950/80 p-2.5 text-[10px] backdrop-blur sm:flex"
          >
            <p className="font-semibold text-muted-foreground">Legenda</p>
            <div className="flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-full bg-red-500" />
              Api permukaan aktif
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-full bg-orange-400" />
              Smoldering / bara bawah tanah
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-full bg-yellow-400" />
              Titik api belum terverifikasi
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-5 border-t-2 border-dashed border-yellow-400" />
              Rekomendasi sekat bakar
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
              Desa terpapar
            </div>
          </motion.div>

          <TimelineSlider
            hourOffset={hourOffset}
            onChange={setHourOffset}
            spreadRate={spreadRate}
            threatenedAreaHa={threatenedAreaHa}
          />
        </main>
      </div>

      {/* Footer */}
      <footer className="shrink-0 border-t bg-card/60 px-3 py-1.5 text-center text-[10px] text-muted-foreground md:px-4">
        Sumber data: BMKG (prakiraan cuaca &amp; maritim) · Data hotspot:{" "}
        {firmsLive ? "NASA FIRMS VIIRS near-real-time" : "NASA FIRMS belum aktif"} · Peta:
        OpenFreeMap &amp; OpenStreetMap
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
  engineState: MapEngineState;
  mapStyle: MapStyleId;
  setMapStyle: (id: MapStyleId) => void;
  weather: ReturnType<typeof useIncidents>["weather"];
  maritime: ReturnType<typeof useIncidents>["maritime"];
  incidents: HotspotIncident[];
  selectedId: string | null;
  selectedIncident: HotspotIncident | null;
  selectIncident: (id: string) => void;
  hourOffset: number;
  newsArticles: NewsArticle[];
  hasNews: boolean;
  onOpenNews: () => void;
}

function SidebarContent({
  engineState,
  mapStyle,
  setMapStyle,
  weather,
  maritime,
  incidents,
  selectedId,
  selectedIncident,
  selectIncident,
  hourOffset,
  newsArticles,
  hasNews,
  onOpenNews,
}: SidebarContentProps) {
  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-3 p-3">
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

        {/* Weather telemetry */}
        <section className="space-y-2">
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Telemetri Cuaca <span className="text-orange-400">LIVE</span>
          </h2>
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

        <Separator />

        {/* Incident list */}
        <section className="space-y-2">
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Insiden Aktif ({incidents.length})
          </h2>
          {incidents.length === 0 ? (
            <p className="rounded-md border border-white/10 bg-slate-950/60 px-3 py-4 text-center text-xs text-muted-foreground">
              Belum ada titik api NASA FIRMS terdeteksi di area KHG.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <AnimatePresence mode="popLayout">
                {incidents.map((incident) => (
                  <IncidentCard
                    key={incident.id}
                    incident={incident}
                    selected={incident.id === selectedId}
                    onSelect={() => selectIncident(incident.id)}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </section>

        <Separator />

        {/* AI tactical briefing */}
        <section className="space-y-2">
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Taktik &amp; Briefing
          </h2>
          {selectedIncident ? (
            <BriefingBox incident={selectedIncident} hourOffset={hourOffset} />
          ) : (
            <p className="text-xs text-muted-foreground">Pilih insiden untuk melihat briefing.</p>
          )}
        </section>

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
      </div>
    </ScrollArea>
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
  const threatLevel = incident.nearestVillage.threatLevel;
  const smoldering =
    incident.status === "SUSPECTED_SMOLDERING" || incident.status === "CONFIRMED_SMOLDERING";

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
        className={`size-3 shrink-0 rounded-full ${smoldering ? "smolder-blink" : ""}`}
        style={{ background: statusColor }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs font-semibold">{incident.id}</span>
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
            FRP {incident.frpMegawatt} MW
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className="truncate text-[10px] text-muted-foreground">
            {FIRE_STATUS_LABEL[incident.status]}
          </span>
          <Badge
            variant="outline"
            className="shrink-0 text-[9px]"
            style={{ borderColor: THREAT_COLOR[threatLevel], color: THREAT_COLOR[threatLevel] }}
          >
            {THREAT_LABEL[threatLevel]}
          </Badge>
        </div>
        {(threatLevel === "SIAGA" || threatLevel === "BAHAYA") && (
          <p className="mt-0.5 flex items-center gap-1 text-[10px] text-orange-300">
            <TimerIcon className="size-3" />
            {incident.nearestVillage.name} dalam{" "}
            {incident.firebreak.etaFireArrivalMinutes} menit
          </p>
        )}
      </div>
    </motion.button>
  );
}

function BriefingBox({ incident, hourOffset }: { incident: HotspotIncident; hourOffset: number }) {
  const [apiBrief, setApiBrief] = useState<string | null>(null);
  const [deadlineText, setDeadlineText] = useState<string>("-");
  const step =
    hourOffset === 0
      ? incident.nowcastPolygon
      : (incident.forecastPolygons.find((p) => p.hourOffset === hourOffset) ??
        incident.forecastPolygons[incident.forecastPolygons.length - 1]);
  const village = incident.nearestVillage;
  const fb = incident.firebreak;
  const crew = Math.max(1, Math.round(fb.lengthMeters / 150));
  const smoldering =
    incident.status === "SUSPECTED_SMOLDERING" || incident.status === "CONFIRMED_SMOLDERING";

  useEffect(() => {
    const deadlineIso = new Date(Date.now() + fb.etaFireArrivalMinutes * 60_000).toISOString();
    setDeadlineText(wibTime(deadlineIso));
  }, [fb.etaFireArrivalMinutes]);

  useEffect(() => {
    const controller = new AbortController();
    const center = fb.coordinates[2] ?? fb.coordinates[0];
    const payload = {
      incidentId: incident.id,
      status: incident.status,
      telemetry: {
        windSpeedKmh: incident.weather.windSpeedKmh,
        windDirectionDeg: incident.weather.windDirectionDeg,
        windVectorDeg: incident.weather.windVectorDeg,
        relativeHumidity: incident.weather.relativeHumidity,
        temperatureC: incident.weather.temperatureC,
      },
      firebreak: {
        lengthMeters: fb.lengthMeters,
        etaFireArrivalMinutes: fb.etaFireArrivalMinutes,
        centerLat: center[0],
        centerLng: center[1],
      },
      nearestVillage: {
        name: village.name,
        distanceMeters: village.distanceMeters,
        threatLevel: village.threatLevel,
        safeEvacuationBearingDeg: village.safeEvacuationBearingDeg,
      },
      headFireRate: incident.peatlandInfo.baseSpreadRateR0 * 1.5,
      burnedAreaHa: step.burnedAreaHa,
    };

    fetch("/api/tactical-brief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
      .then((res) => res.json())
      .then((data: { ok?: boolean; brief?: string }) => {
        if (data.ok && data.brief) {
          setApiBrief(data.brief);
        }
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          // silently keep local fallback
        }
      });

    return () => {
      controller.abort();
    };
  }, [incident, hourOffset, fb, village, step.burnedAreaHa]);

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
          <span className="text-xs font-bold">AI TACTICAL BRIEFING</span>
        </div>
        <Badge variant="outline" className="border-orange-500/30 text-[10px] text-orange-300">
          SOP BPBD
        </Badge>
      </div>
      <div className="space-y-1.5 text-xs leading-relaxed">
        {apiBrief ? (
          <p className="text-slate-200">{apiBrief}</p>
        ) : (
          <>
            <p>
              <span className="font-semibold">Status:</span> {FIRE_STATUS_LABEL[incident.status]} ·
              ancaman ke <span className="font-semibold">{village.name}</span>{" "}
              <span style={{ color: THREAT_COLOR[village.threatLevel] }}>
                {THREAT_LABEL[village.threatLevel]}
              </span>{" "}
              (jarak {Math.round(village.distanceMeters)} m).
            </p>
            <p>
              <span className="font-semibold">Kondisi:</span> angin {incident.weather.windSpeedKmh}{" "}
              km/jam dari {compassName(incident.weather.windDirectionDeg)}, kelembapan{" "}
              {Math.round(incident.weather.relativeHumidity)}%
              {smoldering ? " (titik panas tertutup asap: curigai bara bawah tanah)" : ""}. Estimasi
              api tiba di desa <span className="font-semibold">{fb.etaFireArrivalMinutes} menit</span>.
            </p>
            <p>
              <span className="font-semibold">Instruksi:</span> kerahkan {crew} regu MPA untuk memotong
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
        Sumber data: BMKG &amp; Algoritma Perambatan Gambut. Verifikasi lapangan tetap wajib.
      </p>
    </motion.div>
  );
}
