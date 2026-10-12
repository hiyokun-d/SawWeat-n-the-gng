"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import type { FeatureCollection, Point, Polygon } from "geojson";
import {
  BoxIcon,
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
import { getBasemap } from "@/lib/basemaps";
import type { Fire } from "@/lib/fire-types";
import { createTerraDraw } from "./terra";
import { INITIAL_CENTER, INITIAL_ZOOM, type FireMapProps } from "./types";

// MapLibre derives its worker URL from import.meta.url, which is not an http URL once
// bundled, so the worker never starts (and GeoJSON sources never render). Point it at the
// file explicitly; Turbopack emits it as a static asset.
maplibregl.setWorkerUrl(
  new URL("../../node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href,
);

// Basemap raster layers are added at runtime (below the data layers) so they can be swapped
const STYLE: maplibregl.StyleSpecification = { version: 8, sources: {}, layers: [] };
const BASEMAP_PREFIX = "basemap-";

// Keyless Terrarium-encoded elevation tiles (AWS Open Data / Mapzen)
const DEM_TILES = ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"];
const DEM_ATTRIBUTION = "Elevation &copy; Mapzen, AWS Open Data";

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

export default function MapLibreMap(props: FireMapProps) {
  const { fires, areas, activeAreaId, drawMode, basemap, focus } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const [ready, setReady] = useState(false);
  const [globe, setGlobe] = useState(true);
  const [terrain, setTerrain] = useState(true);
  const [columns, setColumns] = useState(true);
  const [orbit, setOrbit] = useState(false);
  const cb = useRef(props);
  useEffect(() => {
    cb.current = props;
  });

  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current!,
      style: STYLE,
      // Start zoomed out on the globe; the load handler flies in
      center: [INITIAL_CENTER[0] - 40, INITIAL_CENTER[1] + 10],
      zoom: 1.2,
      maxPitch: 75,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    mapRef.current = map;

    map.on("load", () => {
      map.setProjection({ type: "globe" });
      map.setSky({
        "sky-color": "#0b1222",
        "horizon-color": "#1e293b",
        "fog-color": "#0f172a",
        "sky-horizon-blend": 0.6,
        "horizon-fog-blend": 0.6,
        "fog-ground-blend": 0.85,
        "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 8, 1, 11, 0],
      });

      // Separate DEM sources for terrain and hillshade are recommended for performance
      map.addSource("dem-terrain", {
        type: "raster-dem", tiles: DEM_TILES, encoding: "terrarium",
        tileSize: 256, maxzoom: 14, attribution: DEM_ATTRIBUTION,
      });
      map.addSource("dem-hillshade", {
        type: "raster-dem", tiles: DEM_TILES, encoding: "terrarium", tileSize: 256, maxzoom: 14,
      });
      map.addLayer({
        id: "hillshade",
        type: "hillshade",
        source: "dem-hillshade",
        paint: {
          "hillshade-exaggeration": 0.45,
          "hillshade-shadow-color": "#000000",
          "hillshade-highlight-color": "#ffffff",
        },
      });

      map.addSource("areas", { type: "geojson", data: emptyFC() });
      map.addLayer({
        id: "areas-fill",
        type: "fill",
        source: "areas",
        paint: {
          "fill-color": ["case", ["get", "active"], "#38bdf8", "#94a3b8"],
          "fill-opacity": ["case", ["get", "active"], 0.08, 0.03],
        },
      });
      map.addLayer({
        id: "areas-line",
        type: "line",
        source: "areas",
        paint: {
          "line-color": ["case", ["get", "active"], "#38bdf8", "#94a3b8"],
          "line-width": ["case", ["get", "active"], 3, 1.5],
        },
      });

      map.addSource("fires", { type: "geojson", data: emptyFC() });
      map.addSource("fire-columns", { type: "geojson", data: emptyFC() });

      // Heatmap for the zoomed-out overview, fading out as points take over
      map.addLayer({
        id: "fires-heat",
        type: "heatmap",
        source: "fires",
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
            1, "rgba(254,242,242,0.95)",
          ],
          "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 6, 0.85, 9, 0],
        },
      });

      map.addLayer({
        id: "fire-columns",
        type: "fill-extrusion",
        source: "fire-columns",
        minzoom: 3,
        paint: {
          "fill-extrusion-color": CONFIDENCE_COLOR,
          "fill-extrusion-height": 0,
          "fill-extrusion-opacity": 0.85,
        },
      });

      // Expanding ring behind high-confidence detections (radius/opacity animated below)
      map.addLayer({
        id: "fires-pulse",
        type: "circle",
        source: "fires",
        filter: ["==", ["get", "confidence"], "high"],
        paint: {
          "circle-color": "#ef4444",
          "circle-radius": BASE_RADIUS,
          "circle-opacity": 0,
          "circle-blur": 0.4,
        },
      });

      map.addLayer({
        id: "fires",
        type: "circle",
        source: "fires",
        paint: {
          "circle-color": CONFIDENCE_COLOR,
          "circle-radius": BASE_RADIUS,
          "circle-opacity": ["interpolate", ["linear"], ["zoom"], 3, 0.45, 7, 0.85],
          "circle-stroke-width": 1,
          "circle-stroke-color": "#000",
        },
      });

      for (const layer of ["fires", "fire-columns"]) {
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

      const draw = createTerraDraw(
        new TerraDrawMapLibreGLAdapter({ map }),
        (g) => cb.current.onAreaDrawn(g),
      );
      draw.start();
      draw.setMode("static");
      drawRef.current = draw;

      // Intro flight; the first moveend (when it lands) triggers the initial scan
      map.on("moveend", () => {
        const b = map.getBounds();
        cb.current.onViewportChange([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
      });
      map.flyTo({ ...HOME_CAMERA, duration: 4500, curve: 1.6, essential: true });
      setReady(true);
    });

    return () => {
      drawRef.current?.stop();
      drawRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Basemap swap — inserted beneath hillshade so all data layers stay on top
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    for (const layer of map.getStyle().layers) {
      if (layer.id.startsWith(BASEMAP_PREFIX)) map.removeLayer(layer.id);
    }
    for (const id of Object.keys(map.getStyle().sources)) {
      if (id.startsWith(BASEMAP_PREFIX)) map.removeSource(id);
    }
    const { layers, attribution } = getBasemap(basemap);
    layers.forEach(({ url, maxZoom }, i) => {
      const id = `${BASEMAP_PREFIX}${i}`;
      map.addSource(id, {
        type: "raster",
        tiles: [url],
        tileSize: 256,
        maxzoom: maxZoom,
        attribution: i === 0 ? attribution : undefined,
      });
      map.addLayer({ id, type: "raster", source: id }, "hillshade");
    });
  }, [basemap, ready]);

  useEffect(() => {
    if (ready) mapRef.current?.setProjection({ type: globe ? "globe" : "mercator" });
  }, [globe, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setTerrain(terrain ? { source: "dem-terrain", exaggeration: 1.6 } : null);
    map.setLayoutProperty("hillshade", "visibility", terrain ? "visible" : "none");
  }, [terrain, ready]);

  useEffect(() => {
    if (!ready) return;
    mapRef.current?.setLayoutProperty("fire-columns", "visibility", columns ? "visible" : "none");
  }, [columns, ready]);

  // Pulse animation for high-confidence fires
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    let raf = 0;
    const tick = (now: number) => {
      const t = (now % PULSE_MS) / PULSE_MS;
      map.setPaintProperty("fires-pulse", "circle-radius", ["+", BASE_RADIUS, t * 16]);
      map.setPaintProperty("fires-pulse", "circle-opacity", 0.55 * (1 - t));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready]);

  // Slow camera orbit
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !orbit) return;
    if (map.getPitch() < 30) map.setPitch(50);
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
    map.getSource<GeoJSONSource>("fires")?.setData(points);
    map.getSource<GeoJSONSource>("fire-columns")?.setData(cols);

    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / GROW_MS);
      const eased = 1 - Math.pow(1 - p, 3);
      map.setPaintProperty("fire-columns", "fill-extrusion-height", ["*", ["get", "height"], eased]);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [fires, ready]);

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
    mapRef.current?.getSource<GeoJSONSource>("areas")?.setData(fc);
  }, [areas, activeAreaId, ready]);

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
    { label: "3D columns", icon: BoxIcon, on: columns, set: setColumns },
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
          className="absolute top-4 left-4 z-10 flex gap-1 rounded-xl border bg-card/80 p-1 backdrop-blur"
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
                // Tilt so relief is visible (done here, not in the effect, to avoid cancelling the intro flight)
                const map = mapRef.current;
                if (label === "Terrain" && !on && map && map.getPitch() < 30) {
                  map.easeTo({ pitch: 50, duration: 1200 });
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
