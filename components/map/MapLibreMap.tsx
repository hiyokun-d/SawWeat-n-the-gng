"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import type { FeatureCollection, Point, Polygon } from "geojson";
import {
  BoxIcon,
  Building2Icon,
  CompassIcon,
  GlobeIcon,
  MountainSnowIcon,
  RotateCwIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { TerraDraw } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import { Button } from "@/components/ui/button";
import { FIRMS_ATTRIBUTION, getMapStyle } from "@/lib/basemaps";
import type { Fire } from "@/lib/fire-types";
import { addTerrainLayers, setTerrainEnabled } from "@/lib/terrain";
import { createTerraDraw } from "./terra";
import { INITIAL_CENTER, INITIAL_ZOOM, type FireMapProps } from "./types";

// MapLibre derives its worker URL from import.meta.url, which is not an http URL once
// bundled, so the worker never starts (and GeoJSON sources never render). Point it at the
// file explicitly; Turbopack emits it as a static asset.
maplibregl.setWorkerUrl(
  new URL("../../node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href,
);

export interface MapLibreMapProps extends FireMapProps {
  onReady: () => void;
  onFail: (reason: string) => void;
}

const CONFIDENCE_COLOR: maplibregl.ExpressionSpecification = [
  "match",
  ["get", "confidence"],
  "high", "#dc2626",
  "nominal", "#f97316",
  "#facc15",
];
const BASE_RADIUS: maplibregl.ExpressionSpecification = [
  "min", 12, ["+", 3, ["sqrt", ["max", ["get", "frp"], 0]]],
];

const HOME_CAMERA = { center: INITIAL_CENTER, zoom: INITIAL_ZOOM + 0.5, pitch: 40, bearing: -12 };
const PULSE_MS = 1600;
const GROW_MS = 1400;

export default function MapLibreMap(props: MapLibreMapProps) {
  const { fires, areas, activeAreaId, drawMode, mapStyle, focus } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const appliedStyle = useRef(mapStyle);
  // Bumped every time a style finishes loading and our overlays are (re)installed;
  // data/paint effects depend on it so they re-apply after a style switch.
  const [styleVersion, setStyleVersion] = useState(0);
  const ready = styleVersion > 0;
  const [globe, setGlobe] = useState(true);
  const [terrain, setTerrain] = useState(true);
  const [buildings, setBuildings] = useState(true);
  const [columns, setColumns] = useState(true);
  const [orbit, setOrbit] = useState(false);
  const env = useRef({ globe, terrain, buildings, columns });
  const cb = useRef(props);
  useEffect(() => {
    cb.current = props;
    env.current = { globe, terrain, buildings, columns };
  });

  useEffect(() => {
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current!,
        style: getMapStyle(appliedStyle.current).url,
        // Start zoomed out on the globe; the load handler flies in
        center: [INITIAL_CENTER[0] - 40, INITIAL_CENTER[1] + 10],
        zoom: 1.2,
        maxPitch: 85,
        attributionControl: { compact: true, customAttribution: FIRMS_ATTRIBUTION },
      });
    } catch (err) {
      cb.current.onFail(err instanceof Error ? err.message : "WebGL unavailable");
      return;
    }
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    mapRef.current = map;

    map.on("webglcontextlost", () => cb.current.onFail("WebGL context lost"));
    map.on("error", (e) => console.warn("[maplibre]", e.error?.message));

    // Fires for the initial style and again after every setStyle()
    map.on("style.load", () => {
      installOverlays(map, env.current);
      const draw = createTerraDraw(
        new TerraDrawMapLibreGLAdapter({ map }),
        (g) => cb.current.onAreaDrawn(g),
      );
      draw.start();
      draw.setMode(cb.current.drawMode);
      drawRef.current = draw;
      setStyleVersion((v) => v + 1);
    });

    // Ready as soon as the first style is in and our layers are installed. (The `load` event
    // also waits for every tile, which can take far longer on slow GPUs/networks.)
    map.once("style.load", () => {
      cb.current.onReady();
      // The first moveend (when the intro flight lands) reports the viewport
      map.on("moveend", () => {
        const b = map.getBounds();
        cb.current.onViewportChange([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
      });
      map.flyTo({ ...HOME_CAMERA, duration: 4500, curve: 1.6, essential: true });
    });

    // Layer-scoped handlers survive style switches (matched by layer id at event time)
    for (const layer of ["fw-fires", "fw-fire-columns"]) {
      map.on("click", layer, (e) => {
        const raw = e.features?.[0]?.properties?.fire;
        if (!raw) return;
        const fire = JSON.parse(raw) as Fire;
        cb.current.onFireClick(fire);
        setOrbit(false);
        map.flyTo({
          center: [fire.lng, fire.lat],
          zoom: Math.max(map.getZoom(), 10.5),
          pitch: 62,
          bearing: map.getBearing() + 35,
          duration: 2600,
          essential: true,
        });
      });
      map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
    }

    // Any manual interaction cancels the orbit
    for (const ev of ["mousedown", "touchstart", "wheel"] as const) {
      map.on(ev, () => setOrbit(false));
    }

    return () => {
      drawRef.current?.stop();
      drawRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Style switch: Terra Draw must unregister while its layers still exist; everything is
  // re-installed in the style.load handler.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || appliedStyle.current === mapStyle) return;
    appliedStyle.current = mapStyle;
    drawRef.current?.stop();
    drawRef.current = null;
    map.setStyle(getMapStyle(mapStyle).url, { diff: false });
  }, [mapStyle, ready]);

  useEffect(() => {
    if (ready) mapRef.current?.setProjection({ type: globe ? "globe" : "mercator" });
  }, [globe, ready, styleVersion]);

  useEffect(() => {
    if (ready && mapRef.current) setTerrainEnabled(mapRef.current, terrain);
  }, [terrain, ready, styleVersion]);

  useEffect(() => {
    if (ready) setVisible(mapRef.current, "fw-buildings", buildings);
  }, [buildings, ready, styleVersion]);

  useEffect(() => {
    if (ready) setVisible(mapRef.current, "fw-fire-columns", columns);
  }, [columns, ready, styleVersion]);

  // Pulse animation for high-confidence fires
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    let raf = 0;
    const tick = (now: number) => {
      if (map.getLayer("fw-fires-pulse")) {
        const t = (now % PULSE_MS) / PULSE_MS;
        map.setPaintProperty("fw-fires-pulse", "circle-radius", ["+", BASE_RADIUS, t * 16]);
        map.setPaintProperty("fw-fires-pulse", "circle-opacity", 0.55 * (1 - t));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready]);

  // Slow camera orbit
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !orbit) return;
    if (map.getPitch() < 30) map.setPitch(55);
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      map.setBearing(map.getBearing() + (now - last) * 0.006);
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [orbit, ready]);

  // Flatten the camera while drawing so clicks land where expected
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    drawRef.current?.setMode(drawMode);
    if (drawMode !== "static") map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
  }, [drawMode, ready]);

  // Fire points + extruded columns, with the columns growing from the ground
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const points: FeatureCollection<Point> = {
      type: "FeatureCollection",
      features: fires.map((f) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [f.lng, f.lat] },
        properties: { confidence: f.confidence, frp: f.frp, fire: JSON.stringify(f) },
      })),
    };
    const cols: FeatureCollection<Polygon> = {
      type: "FeatureCollection",
      features: fires.map((f) => ({
        type: "Feature",
        geometry: squareAround(f.lng, f.lat, 0.012),
        properties: {
          confidence: f.confidence,
          height: Math.min(60_000, 1_500 + Math.sqrt(Math.max(f.frp, 0)) * 4_000),
          fire: JSON.stringify(f),
        },
      })),
    };
    map.getSource<GeoJSONSource>("fw-fires")?.setData(points);
    map.getSource<GeoJSONSource>("fw-fire-columns")?.setData(cols);

    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / GROW_MS);
      const eased = 1 - Math.pow(1 - p, 3);
      if (map.getLayer("fw-fire-columns")) {
        map.setPaintProperty("fw-fire-columns", "fill-extrusion-height", [
          "*", ["get", "height"], eased,
        ]);
      }
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [fires, ready, styleVersion]);

  useEffect(() => {
    if (!ready) return;
    const fc: FeatureCollection<Polygon> = {
      type: "FeatureCollection",
      features: areas.map((a) => ({
        type: "Feature",
        geometry: a.geometry,
        properties: { name: a.name, active: a.id === activeAreaId },
      })),
    };
    mapRef.current?.getSource<GeoJSONSource>("fw-areas")?.setData(fc);
  }, [areas, activeAreaId, ready, styleVersion]);

  useEffect(() => {
    if (!focus || !mapRef.current) return;
    const [w, s, e, n] = focus.bbox;
    mapRef.current.fitBounds(
      [
        [w, s],
        [e, n],
      ],
      { padding: 60, pitch: 45, bearing: -15, duration: 1800 },
    );
  }, [focus]);

  const toggles = [
    { label: "Globe", icon: GlobeIcon, on: globe, set: setGlobe },
    { label: "Terrain", icon: MountainSnowIcon, on: terrain, set: setTerrain },
    { label: "Buildings", icon: Building2Icon, on: buildings, set: setBuildings },
    { label: "Fire columns", icon: BoxIcon, on: columns, set: setColumns },
    { label: "Orbit", icon: RotateCwIcon, on: orbit, set: setOrbit },
  ];

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full bg-neutral-950" />
      {ready && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="absolute top-4 left-4 z-10 flex flex-wrap gap-1 rounded-xl border bg-card/80 p-1 backdrop-blur"
        >
          {toggles.map(({ label, icon: Icon, on, set }) => (
            <Button
              key={label}
              size="sm"
              variant={on ? "default" : "ghost"}
              aria-pressed={on}
              disabled={label === "Orbit" && drawMode !== "static"}
              onClick={() => {
                set((v) => !v);
                // Tilt so relief / buildings are visible (here, not in an effect, so the
                // intro flight is never cancelled)
                const map = mapRef.current;
                const wantsTilt = label === "Terrain" || label === "Buildings";
                if (wantsTilt && !on && map && map.getPitch() < 30) {
                  map.easeTo({ pitch: 55, duration: 1200 });
                }
              }}
            >
              <Icon />
              {label}
            </Button>
          ))}
          <Button
            size="sm"
            variant="ghost"
            aria-label="Reset view"
            title="Reset view"
            onClick={() => {
              setOrbit(false);
              mapRef.current?.flyTo({ ...HOME_CAMERA, duration: 2200 });
            }}
          >
            <CompassIcon />
          </Button>
        </motion.div>
      )}
    </div>
  );
}

// Adds terrain, lighting, sky, 3D buildings and all FireWatch data layers on top of the
// current OpenFreeMap style. Called on every style.load.
function installOverlays(
  map: maplibregl.Map,
  env: { globe: boolean; terrain: boolean; buildings: boolean; columns: boolean },
) {
  map.setProjection({ type: env.globe ? "globe" : "mercator" });
  map.setSky({
    "sky-color": "#7dd3fc",
    "horizon-color": "#e0f2fe",
    "fog-color": "#f1f5f9",
    "sky-horizon-blend": 0.5,
    "horizon-fog-blend": 0.4,
    "fog-ground-blend": 0.95,
    // Subtle halo on the globe; fades out as the camera gets close
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 0.45, 6, 0.3, 10, 0],
  });
  // Low sun from the south-west so extrusions and relief get readable shading
  map.setLight({ anchor: "map", color: "#fff7ed", intensity: 0.45, position: [1.5, 210, 35] });

  addTerrainLayers(map);
  setTerrainEnabled(map, env.terrain);

  // Use our own building extrusion on every style (Liberty ships one; Bright/Positron don't)
  const style = map.getStyle();
  for (const layer of style.layers) {
    if (layer.type === "fill-extrusion") map.setLayoutProperty(layer.id, "visibility", "none");
  }
  if (style.sources.openmaptiles) {
    map.addLayer({
      id: "fw-buildings",
      type: "fill-extrusion",
      source: "openmaptiles",
      "source-layer": "building",
      minzoom: 13,
      layout: { visibility: env.buildings ? "visible" : "none" },
      paint: {
        "fill-extrusion-color": [
          "interpolate", ["linear"], ["coalesce", ["get", "render_height"], 0],
          0, "#e7e5e4", 50, "#d6d3d1", 150, "#a8a29e",
        ],
        "fill-extrusion-height": [
          "interpolate", ["linear"], ["zoom"], 13, 0, 14.5, ["coalesce", ["get", "render_height"], 6],
        ],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": 0.85,
      },
    });
  }

  map.addSource("fw-areas", { type: "geojson", data: emptyFC() });
  map.addLayer({
    id: "fw-areas-fill",
    type: "fill",
    source: "fw-areas",
    paint: {
      "fill-color": ["case", ["get", "active"], "#0284c7", "#64748b"],
      "fill-opacity": ["case", ["get", "active"], 0.12, 0.05],
    },
  });
  map.addLayer({
    id: "fw-areas-line",
    type: "line",
    source: "fw-areas",
    paint: {
      "line-color": ["case", ["get", "active"], "#0284c7", "#64748b"],
      "line-width": ["case", ["get", "active"], 3, 1.5],
    },
  });

  map.addSource("fw-fires", { type: "geojson", data: emptyFC() });
  map.addSource("fw-fire-columns", { type: "geojson", data: emptyFC() });

  // Heatmap for the zoomed-out overview, fading out as points take over
  map.addLayer({
    id: "fw-fires-heat",
    type: "heatmap",
    source: "fw-fires",
    maxzoom: 9,
    paint: {
      "heatmap-weight": ["interpolate", ["linear"], ["get", "frp"], 0, 0.15, 50, 1],
      "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 0.6, 8, 2],
      "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 4, 5, 14, 8, 24],
      "heatmap-color": [
        "interpolate", ["linear"], ["heatmap-density"],
        0, "rgba(0,0,0,0)",
        0.2, "rgba(250,204,21,0.35)",
        0.45, "rgba(249,115,22,0.6)",
        0.75, "rgba(220,38,38,0.8)",
        1, "rgba(127,29,29,0.95)",
      ],
      "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 6, 0.8, 9, 0],
    },
  });

  map.addLayer({
    id: "fw-fire-columns",
    type: "fill-extrusion",
    source: "fw-fire-columns",
    minzoom: 3,
    layout: { visibility: env.columns ? "visible" : "none" },
    paint: {
      "fill-extrusion-color": CONFIDENCE_COLOR,
      "fill-extrusion-height": 0,
      "fill-extrusion-opacity": 0.85,
    },
  });

  // Expanding ring behind high-confidence detections (radius/opacity animated in a rAF loop)
  map.addLayer({
    id: "fw-fires-pulse",
    type: "circle",
    source: "fw-fires",
    filter: ["==", ["get", "confidence"], "high"],
    paint: {
      "circle-color": "#ef4444",
      "circle-radius": BASE_RADIUS,
      "circle-opacity": 0,
      "circle-blur": 0.4,
    },
  });

  map.addLayer({
    id: "fw-fires",
    type: "circle",
    source: "fw-fires",
    paint: {
      "circle-color": CONFIDENCE_COLOR,
      "circle-radius": BASE_RADIUS,
      "circle-opacity": ["interpolate", ["linear"], ["zoom"], 3, 0.5, 7, 0.9],
      "circle-stroke-width": 1,
      "circle-stroke-color": "#ffffff",
    },
  });
}

function setVisible(map: maplibregl.Map | null, layerId: string, visible: boolean) {
  if (map?.getLayer(layerId)) {
    map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
  }
}

function squareAround(lng: number, lat: number, halfDeg: number): Polygon {
  // Widen in longitude so the footprint stays roughly square away from the equator
  const dx = halfDeg / Math.max(Math.cos((lat * Math.PI) / 180), 0.2);
  return {
    type: "Polygon",
    coordinates: [
      [
        [lng - dx, lat - halfDeg],
        [lng + dx, lat - halfDeg],
        [lng + dx, lat + halfDeg],
        [lng - dx, lat + halfDeg],
        [lng - dx, lat - halfDeg],
      ],
    ],
  };
}

function emptyFC(): FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}
