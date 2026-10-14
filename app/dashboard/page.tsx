"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  ActivityIcon,
  AlertTriangleIcon,
  ClockIcon,
  ExternalLinkIcon,
  FlameIcon,
  MapPinIcon,
  RadioIcon,
  SatelliteIcon,
  ShieldAlertIcon,
  SmartphoneIcon,
  ThermometerIcon,
  TimerIcon,
  TriangleAlertIcon,
  WavesIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";

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
    simulateNewHotspot,
    simulateHotspotLost,
    firmsLive,
  } = useIncidents();

  const { engine, state: engineState, markReady, markFailed } = useMapEngine();
  const [mapStyle, setMapStyle] = useState<MapStyleId>("liberty");
  const [panelOpen, setPanelOpen] = useState(false);
  const [hourOffset, setHourOffset] = useState(0);

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
          {!firmsLive && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => simulateNewHotspot()}
                className="h-7 gap-1.5 px-2 text-xs"
              >
                <SatelliteIcon className="size-3.5" />
                <span className="hidden sm:inline">Simulasi: Hotspot Baru</span>
                <span className="sm:hidden">Baru</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => simulateHotspotLost()}
                className="h-7 gap-1.5 px-2 text-xs"
              >
                <AlertTriangleIcon className="size-3.5" />
                <span className="hidden sm:inline">Simulasi: Hotspot Hilang</span>
                <span className="sm:hidden">Hilang</span>
              </Button>
            </>
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
        {firmsLive ? "NASA FIRMS VIIRS near-real-time" : "simulasi (fallback)"} · Peta:
        OpenFreeMap &amp; OpenStreetMap
      </footer>
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
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-muted-foreground">
                    {BmkgVillages[0].name} ({DEFAULT_ADM4})
                  </span>
                  <span className="text-xs text-muted-foreground">{wibTime(weather.updatedAt)}</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Metric
                    icon={<ActivityIcon className="size-3.5" />}
                    label="Angin"
                    value={`${Math.round(weather.windSpeedKmh)}`}
                    unit="km/jam"
                  />
                  <Metric
                    icon={<MapPinIcon className="size-3.5" />}
                    label="Push"
                    value={`${Math.round(weather.windDirectionDeg)}°`}
                    unit="derajat"
                  />
                  <Metric
                    icon={<ThermometerIcon className="size-3.5" />}
                    label="Kelembapan"
                    value={`${Math.round(weather.relativeHumidity)}`}
                    unit="% RH"
                  />
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-muted-foreground">
                    Suhu udara {Math.round(weather.temperatureC)}°C
                  </span>
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

function Metric({
  icon,
  label,
  value,
  unit,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit: string;
}) {
  return (
    <div className="rounded-md bg-white/5 p-2 text-center">
      <div className="mb-0.5 flex items-center justify-center gap-1 text-muted-foreground">
        {icon}
        <span className="text-[10px]">{label}</span>
      </div>
      <p className="text-lg leading-none font-bold tabular-nums">{value}</p>
      <p className="text-[9px] text-muted-foreground">{unit}</p>
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
  const step =
    hourOffset === 0
      ? incident.nowcastPolygon
      : (incident.forecastPolygons.find((p) => p.hourOffset === hourOffset) ??
        incident.forecastPolygons[incident.forecastPolygons.length - 1]);
  const village = incident.nearestVillage;
  const fb = incident.firebreak;
  const crew = Math.max(1, Math.round(fb.lengthMeters / 150));
  const deadlineIso = new Date(Date.now() + fb.etaFireArrivalMinutes * 60_000).toISOString();
  const smoldering =
    incident.status === "SUSPECTED_SMOLDERING" || incident.status === "CONFIRMED_SMOLDERING";

  return (
    <motion.div
      key={`${incident.id}-${hourOffset}-${incident.status}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="rounded-lg border border-white/10 bg-slate-950/70 p-3"
    >
      <div className="mb-2 flex items-center gap-1.5">
        <ShieldAlertIcon className="size-4 text-orange-400" />
        <span className="text-xs font-bold">AI TACTICAL BRIEFING</span>
      </div>
      <div className="space-y-1.5 text-xs leading-relaxed">
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
          tuntas sebelum pukul {wibTime(deadlineIso)}. Setelah memotong, batu-bata api yang
          tersapu harus dipastikan padam.
        </p>
        <p>
          <span className="font-semibold">Luas terancam:</span> {step.burnedAreaHa.toFixed(1)} ha
          pada t+{hourOffset} jam.
        </p>
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">
        Sumber data: BMKG. Briefing digenerate otomatis, verifikasi lapangan tetap wajib.
      </p>
    </motion.div>
  );
}
