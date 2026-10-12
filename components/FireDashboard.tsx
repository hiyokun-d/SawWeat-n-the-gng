"use client";

import dynamic from "next/dynamic";
import { liveQuery } from "dexie";
import type { Polygon } from "geojson";
import { AnimatePresence, motion } from "motion/react";
import {
  CircleIcon,
  FlameIcon,
  HandIcon,
  Loader2Icon,
  MousePointer2Icon,
  PentagonIcon,
  RadarIcon,
  SquareIcon,
  Trash2Icon,
  WifiOffIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMapEngine } from "@/hooks/useMapEngine";
import { MAP_STYLES, type MapStyleId } from "@/lib/basemaps";
import { db, type WatchArea } from "@/lib/db";
import {
  FIRMS_SOURCES,
  FiresResponseSchema,
  confidenceColor,
  type BBox,
  type Fire,
} from "@/lib/fire-types";
import { clampBBox, pointInPolygon, polygonBBox } from "@/lib/geo";
import type { DrawMode, FireMapProps } from "./map/types";

// Both map libraries touch `window` on import, so they are client-only.
const LeafletMap = dynamic(() => import("./map/LeafletMap"), { ssr: false });
const MapLibreMap = dynamic(() => import("./map/MapLibreMap"), { ssr: false });

const SOURCE_ITEMS = FIRMS_SOURCES.map((s) => ({ value: s.id, label: s.label }));
const DAY_ITEMS = [1, 2, 3, 4, 5].map((d) => ({
  value: String(d),
  label: d === 1 ? "Last 24 hours" : `Last ${d} days`,
}));
const DRAW_TOOLS: { mode: DrawMode; label: string; icon: React.ElementType }[] = [
  { mode: "static", label: "Pan", icon: MousePointer2Icon },
  { mode: "polygon", label: "Polygon", icon: PentagonIcon },
  { mode: "rectangle", label: "Rectangle", icon: SquareIcon },
  { mode: "circle", label: "Circle", icon: CircleIcon },
  { mode: "freehand", label: "Freehand", icon: HandIcon },
];

// FIRMS gets slow (and huge) for continent-sized boxes
const MAX_SCAN_AREA_DEG2 = 10_000;

type ScanState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; fetchedAt: number; offline: boolean }
  | { status: "error"; message: string };

export default function FireDashboard() {
  const { engine, state: engineState, markReady, markFailed } = useMapEngine();
  const [mapStyle, setMapStyle] = useState<MapStyleId>("liberty");
  const [source, setSource] = useState<string>(FIRMS_SOURCES[0].id);
  const [days, setDays] = useState("1");
  const [drawMode, setDrawMode] = useState<DrawMode>("static");
  const [fires, setFires] = useState<Fire[]>([]);
  const [areas, setAreas] = useState<WatchArea[]>([]);
  const [activeAreaId, setActiveAreaId] = useState<string | null>(null);
  const [selectedFire, setSelectedFire] = useState<Fire | null>(null);
  const [scan, setScan] = useState<ScanState>({ status: "idle" });
  const [focus, setFocus] = useState<FireMapProps["focus"]>(null);
  const viewport = useRef<BBox | null>(null);
  const didInitialScan = useRef(false);
  // Mirrors source/days so scans started from handlers see the new values immediately
  const query = useRef({ source: FIRMS_SOURCES[0].id as string, days: "1" });

  useEffect(() => {
    const sub = liveQuery(() => db.areas.orderBy("createdAt").reverse().toArray()).subscribe({
      next: setAreas,
      error: console.error,
    });
    return () => sub.unsubscribe();
  }, []);

  const activeArea = areas.find((a) => a.id === activeAreaId) ?? null;

  const runScan = useCallback(
    async (bbox: BBox, polygon?: Polygon) => {
      const { source, days } = query.current;
      const key = `${source}|${days}|${bbox.map((n) => n.toFixed(3)).join(",")}`;
      setScan({ status: "loading" });
      setSelectedFire(null);

      const filter = (list: Fire[]) =>
        polygon ? list.filter((f) => pointInPolygon(f.lng, f.lat, polygon)) : list;

      try {
        const qs = new URLSearchParams({ source, days, bbox: bbox.join(",") });
        const res = await fetch(`/api/fires?${qs}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        const data = FiresResponseSchema.parse(json);
        const fetchedAt = Date.now();
        await db.scans.put({ key, response: data, fetchedAt });
        setFires(filter(data.fires));
        setScan({ status: "done", fetchedAt, offline: false });
      } catch (err) {
        // Fall back to the last successful scan of the same box, if any
        const cached = await db.scans.get(key);
        if (cached) {
          setFires(filter(cached.response.fires));
          setScan({ status: "done", fetchedAt: cached.fetchedAt, offline: true });
        } else {
          setScan({ status: "error", message: err instanceof Error ? err.message : String(err) });
        }
      }
    },
    [],
  );

  const scanViewport = useCallback(() => {
    if (!viewport.current) return;
    const bbox = clampBBox(viewport.current);
    const area = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]);
    if (area > MAX_SCAN_AREA_DEG2) {
      setScan({ status: "error", message: "View is too large — zoom in or draw an area." });
      return;
    }
    setActiveAreaId(null);
    runScan(bbox);
  }, [runScan]);

  const scanArea = useCallback(
    (area: WatchArea, fly = true) => {
      setActiveAreaId(area.id);
      if (fly) setFocus({ bbox: area.bbox, nonce: Date.now() });
      runScan(area.bbox, area.geometry);
    },
    [runScan],
  );

  // Re-run the current scan when source / day range changes
  const changeQuery = (next: Partial<{ source: string; days: string }>) => {
    query.current = { ...query.current, ...next };
    setSource(query.current.source);
    setDays(query.current.days);
    if (!didInitialScan.current) return;
    if (activeArea) scanArea(activeArea, false);
    else scanViewport();
  };

  const onViewportChange = useCallback(
    (bbox: BBox) => {
      viewport.current = bbox;
      if (!didInitialScan.current) {
        didInitialScan.current = true;
        scanViewport();
      }
    },
    [scanViewport],
  );

  const onAreaDrawn = useCallback(
    async (geometry: Polygon) => {
      const area: WatchArea = {
        id: crypto.randomUUID(),
        name: `Area ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
        geometry,
        bbox: polygonBBox(geometry),
        createdAt: Date.now(),
      };
      await db.areas.add(area);
      setDrawMode("static");
      scanArea(area, false);
    },
    [scanArea],
  );

  const deleteArea = async (id: string) => {
    await db.areas.delete(id);
    if (id === activeAreaId) setActiveAreaId(null);
  };

  const stats = useMemo(() => {
    const high = fires.filter((f) => f.confidence === "high").length;
    const frp = fires.reduce((sum, f) => sum + (Number.isFinite(f.frp) ? f.frp : 0), 0);
    return { count: fires.length, high, frp };
  }, [fires]);

  // Both engines can be mounted at once (Leaflet on top while MapLibre loads underneath);
  // only the visible one may drive the viewport.
  const engineRef = useRef(engine);
  useEffect(() => {
    engineRef.current = engine;
  }, [engine]);
  const viewportFrom = useCallback(
    (source: typeof engine) => (bbox: BBox) => {
      if (engineRef.current === source) onViewportChange(bbox);
    },
    [onViewportChange],
  );

  const mapProps: Omit<FireMapProps, "onViewportChange"> = {
    fires,
    areas,
    activeAreaId,
    drawMode,
    mapStyle,
    focus,
    onAreaDrawn,
    onFireClick: setSelectedFire,
  };

  return (
    <div className="relative flex h-dvh w-full overflow-hidden bg-background text-foreground">
      {/* Sidebar */}
      <motion.aside
        initial={{ x: -24, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="z-10 flex w-80 shrink-0 flex-col border-r bg-card"
      >
        <div className="flex items-center gap-2 px-4 py-4">
          <FlameIcon className="size-5 text-orange-500" />
          <h1 className="font-heading text-lg font-semibold">FireWatch</h1>
          <Badge variant="outline" className="ml-auto">
            NASA FIRMS
          </Badge>
        </div>
        <Separator />

        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-5 p-4">
            <section className="flex flex-col gap-2">
              <Label>Map</Label>
              <EngineStatus state={engineState} />
              <Tabs value={mapStyle} onValueChange={(v) => setMapStyle(v as MapStyleId)}>
                <TabsList className="w-full">
                  {MAP_STYLES.map((s) => (
                    <TabsTrigger key={s.id} value={s.id} disabled={engine !== "maplibre"}>
                      {s.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </section>

            <section className="flex flex-col gap-2">
              <Label>Satellite source</Label>
              <Select
                items={SOURCE_ITEMS}
                value={source}
                onValueChange={(v) => v && changeQuery({ source: v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCE_ITEMS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select items={DAY_ITEMS} value={days} onValueChange={(v) => v && changeQuery({ days: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAY_ITEMS.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={scanViewport} disabled={scan.status === "loading"}>
                {scan.status === "loading" ? (
                  <Loader2Icon className="animate-spin" />
                ) : (
                  <RadarIcon />
                )}
                Scan current view
              </Button>
            </section>

            <section className="grid grid-cols-3 gap-2">
              <Stat label="Hotspots" value={stats.count.toLocaleString()} />
              <Stat label="High conf." value={stats.high.toLocaleString()} />
              <Stat label="Total FRP" value={`${Math.round(stats.frp).toLocaleString()}`} unit="MW" />
            </section>

            <ScanStatus scan={scan} scope={activeArea?.name ?? "current view"} />

            <section className="flex flex-col gap-2">
              <Label>Draw a watch area</Label>
              <div className="grid grid-cols-5 gap-1">
                {DRAW_TOOLS.map(({ mode, label, icon: Icon }) => (
                  <Button
                    key={mode}
                    size="icon"
                    variant={drawMode === mode ? "default" : "outline"}
                    onClick={() => setDrawMode(mode)}
                    title={label}
                    aria-label={label}
                    className="w-full"
                  >
                    <Icon />
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Areas are saved in your browser (IndexedDB) and scanned for fires inside the shape.
              </p>
            </section>

            <section className="flex flex-col gap-2">
              <Label>Saved areas ({areas.length})</Label>
              <ul className="flex flex-col gap-1">
                <AnimatePresence initial={false}>
                  {areas.map((a) => (
                    <motion.li
                      key={a.id}
                      layout
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div
                        className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-sm transition-colors ${
                          a.id === activeAreaId
                            ? "border-sky-500/60 bg-sky-500/10"
                            : "hover:bg-muted"
                        }`}
                      >
                        <button className="flex-1 truncate text-left" onClick={() => scanArea(a)}>
                          {a.name}
                        </button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`Delete ${a.name}`}
                          onClick={() => deleteArea(a.id)}
                        >
                          <Trash2Icon />
                        </Button>
                      </div>
                    </motion.li>
                  ))}
                </AnimatePresence>
                {areas.length === 0 && (
                  <li className="text-xs text-muted-foreground">No areas yet.</li>
                )}
              </ul>
            </section>

            <Legend />
          </div>
        </ScrollArea>
      </motion.aside>

      {/* Map */}
      <main className="relative min-w-0 flex-1">
        {engineState.status !== "fallback" && (
          <div className="absolute inset-0 z-0">
            <MapLibreMap
              {...mapProps}
              onViewportChange={viewportFrom("maplibre")}
              onReady={markReady}
              onFail={markFailed}
            />
          </div>
        )}
        {/* Leaflet sits on top until MapLibre is ready, then fades away to reveal it */}
        <AnimatePresence>
          {engine === "leaflet" && (
            <motion.div
              key="leaflet"
              className="absolute inset-0 z-[5]"
              exit={{ opacity: 0 }}
              transition={{ duration: 0.8 }}
            >
              <LeafletMap {...mapProps} onViewportChange={viewportFrom("leaflet")} />
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {drawMode !== "static" && (
            <motion.div
              initial={{ y: -12, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -12, opacity: 0 }}
              className="pointer-events-none absolute top-4 left-1/2 z-[1000] -translate-x-1/2 rounded-full bg-black/70 px-4 py-1.5 text-sm text-white backdrop-blur"
            >
              Drawing {drawMode} — click on the map to sketch your area
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {selectedFire && (
            <motion.div
              key={selectedFire.id}
              initial={{ x: 24, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 24, opacity: 0 }}
              className="absolute top-4 right-4 z-[1000] w-72"
            >
              <FireDetails fire={selectedFire} onClose={() => setSelectedFire(null)} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function EngineStatus({ state }: { state: ReturnType<typeof useMapEngine>["state"] }) {
  if (state.status === "ready") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="size-2 rounded-full bg-emerald-500" />
        MapLibre GL · WebGL 3D
      </p>
    );
  }
  if (state.status === "loading") {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2Icon className="size-3.5 animate-spin" />
        Loading 3D map — showing Leaflet preview
      </p>
    );
  }
  return (
    <p className="flex items-start gap-1.5 text-xs text-amber-500">
      <span className="mt-1 size-2 shrink-0 rounded-full bg-amber-500" />
      Leaflet fallback (OpenStreetMap): {state.reason}
    </p>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {children}
    </span>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-lg border bg-background/40 p-2">
      <motion.div
        key={value}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="truncate text-base font-semibold tabular-nums"
      >
        {value}
        {unit && <span className="ml-0.5 text-xs font-normal text-muted-foreground">{unit}</span>}
      </motion.div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function ScanStatus({ scan, scope }: { scan: ScanState; scope: string }) {
  if (scan.status === "idle") return null;
  if (scan.status === "loading")
    return <p className="text-xs text-muted-foreground">Scanning {scope}…</p>;
  if (scan.status === "error") return <p className="text-xs text-destructive">{scan.message}</p>;
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {scan.offline && <WifiOffIcon className="size-3.5 text-amber-500" />}
      {scan.offline ? "Cached result" : "Updated"} for {scope} ·{" "}
      {new Date(scan.fetchedAt).toLocaleTimeString()}
    </p>
  );
}

function Legend() {
  return (
    <section className="flex flex-col gap-2">
      <Label>Confidence</Label>
      <div className="flex gap-3 text-xs">
        {(["high", "nominal", "low"] as const).map((c) => (
          <span key={c} className="flex items-center gap-1.5 capitalize">
            <span className="size-2.5 rounded-full" style={{ background: confidenceColor(c) }} />
            {c}
          </span>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Dot size scales with fire radiative power.</p>
    </section>
  );
}

function FireDetails({ fire, onClose }: { fire: Fire; onClose: () => void }) {
  const rows: [string, string][] = [
    ["Detected", new Date(fire.acquiredAt).toLocaleString()],
    ["Location", `${fire.lat.toFixed(4)}, ${fire.lng.toFixed(4)}`],
    ["Brightness", `${fire.brightness.toFixed(1)} K`],
    ["FRP", `${fire.frp.toFixed(1)} MW`],
    ["Sensor", `${fire.instrument} · ${fire.satellite}`],
    ["Pass", fire.daynight === "D" ? "Day" : "Night"],
  ];
  return (
    <Card size="sm">
      <CardHeader className="flex flex-row items-center gap-2">
        <FlameIcon className="size-4" style={{ color: confidenceColor(fire.confidence) }} />
        <CardTitle>Hotspot</CardTitle>
        <Badge variant="secondary" className="capitalize">
          {fire.confidence}
        </Badge>
        <Button size="icon-xs" variant="ghost" className="ml-auto" onClick={onClose} aria-label="Close">
          <XIcon />
        </Button>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-right tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
