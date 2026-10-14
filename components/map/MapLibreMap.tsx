"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
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
import { Button } from "@/components/ui/button";
import { BMKG_ATTRIBUTION, getMapStyle } from "@/lib/basemaps";
import { BmkgVillages, FIRE_STATUS_COLOR, windVectorDeg } from "@/lib/gambut";
import { addTerrainLayers, setTerrainEnabled } from "@/lib/terrain";
import { firebreakLineString, stepPolygonFor, windArrowGeometry } from "@/lib/simulationEngine";
import { KHG_SUNGAI_KAPUAS_AMBawang } from "@/data/khgKalbar.geojson";
import { KUBU_RAYA_CENTER, KUBU_RAYA_ZOOM, type GambutMapProps } from "./types";

// MapLibre derives its worker URL from import.meta.url, which is not an http URL once
// bundled, so the worker never starts (and GeoJSON sources never render). Point it at the
// file explicitly; Turbopack emits it as a static asset.
maplibregl.setWorkerUrl(
  new URL("../../node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href,
);

export interface MapLibreMapProps extends GambutMapProps {
  onReady: () => void;
  onFail: (reason: string) => void;
}

const STATUS_COLOR: maplibregl.ExpressionSpecification = [
  "match",
  ["get", "status"],
  "UNVERIFIED_HOTSPOT",
  FIRE_STATUS_COLOR.UNVERIFIED_HOTSPOT,
  "CONFIRMED_FLAMING",
  FIRE_STATUS_COLOR.CONFIRMED_FLAMING,
  "SUSPECTED_SMOLDERING",
  FIRE_STATUS_COLOR.SUSPECTED_SMOLDERING,
  "CONFIRMED_SMOLDERING",
  FIRE_STATUS_COLOR.CONFIRMED_SMOLDERING,
  "EXTINGUISHED",
  FIRE_STATUS_COLOR.EXTINGUISHED,
  "#94a3b8",
];

const BURN_COLOR: maplibregl.ExpressionSpecification = [
  "match",
  ["get", "status"],
  "CONFIRMED_FLAMING",
  "#dc2626",
  "UNVERIFIED_HOTSPOT",
  "#facc15",
  "SUSPECTED_SMOLDERING",
  "#f97316",
  "CONFIRMED_SMOLDERING",
  "#f97316",
  "EXTINGUISHED",
  "#22c55e",
  "#dc2626",
];

// Wind-push arrow: sky blue is not used by any fire status, so it never reads as a fire state.
const WIND_COLOR = "#0284c7";

/** Burn fill opacity: selected incident stronger, forecast softer, smoldering blinks. */
function burnOpacity(smolderOpacity: number): maplibregl.ExpressionSpecification {
  return [
    "case",
    ["get", "smolder"],
    smolderOpacity,
    ["get", "isForecast"],
    0.22,
    ["get", "selected"],
    0.35,
    0.2,
  ];
}

const BASE_RADIUS: maplibregl.ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["get", "frp"],
  0,
  5,
  50,
  9,
  100,
  12,
];

const HOME_CAMERA = {
  center: KUBU_RAYA_CENTER,
  zoom: KUBU_RAYA_ZOOM + 0.5,
  pitch: 45,
  bearing: -12,
};

const PULSE_MS = 1600;
const GROW_MS = 1400;
const BLINK_MS = 1100;

export default function MapLibreMap(props: MapLibreMapProps) {
  const { incidents, selectedId, hourOffset, mapStyle } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
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
        // Start further out; the load handler flies in over the peat dome
        center: KUBU_RAYA_CENTER,
        zoom: 5,
        maxPitch: 85,
        attributionControl: { compact: true, customAttribution: BMKG_ATTRIBUTION },
      });
    } catch (err) {
      cb.current.onFail(err instanceof Error ? err.message : "WebGL unavailable");
      return;
    }
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    mapRef.current = map;

    map.on("webglcontextlost", () => cb.current.onFail("WebGL context lost"));
    map.on("error", (e) => console.warn("[maplibre]", e.error?.message));

    map.on("style.load", () => {
      installOverlays(map, env.current);
      setStyleVersion((v) => v + 1);
    });

    // Ready as soon as the first style is in and our layers are installed.
    map.once("style.load", () => {
      cb.current.onReady();
      map.flyTo({ ...HOME_CAMERA, duration: 4000, curve: 1.6, essential: true });
    });

    // Incident clicks (layer-scoped handlers survive style switches)
    map.on("click", "gw-incidents", (e) => {
      const id: unknown = e.features?.[0]?.properties?.id;
      const incident = cb.current.incidents.find((i) => i.id === id);
      if (!incident) return;
      cb.current.onSelectIncident(incident.id);
      setOrbit(false);
      map.flyTo({
        center: [incident.originLng, incident.originLat],
        zoom: Math.max(map.getZoom(), 12),
        pitch: 58,
        bearing: map.getBearing() + 30,
        duration: 2400,
        essential: true,
      });
    });
    map.on("mouseenter", "gw-incidents", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "gw-incidents", () => (map.getCanvas().style.cursor = ""));

    // Any manual interaction cancels the orbit
    for (const ev of ["mousedown", "touchstart", "wheel"] as const) {
      map.on(ev, () => setOrbit(false));
    }

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Style switch: everything is re-installed in the style.load handler
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || appliedStyle.current === mapStyle) return;
    appliedStyle.current = mapStyle;
    map.setStyle(getMapStyle(mapStyle).url, { diff: false });
  }, [mapStyle, ready]);

  useEffect(() => {
    if (ready) mapRef.current?.setProjection({ type: globe ? "globe" : "mercator" });
  }, [globe, ready, styleVersion]);

  useEffect(() => {
    if (ready && mapRef.current) setTerrainEnabled(mapRef.current, terrain);
  }, [terrain, ready, styleVersion]);

  useEffect(() => {
    if (ready) setVisible(mapRef.current, "gw-buildings", buildings);
  }, [buildings, ready, styleVersion]);

  useEffect(() => {
    if (ready) setVisible(mapRef.current, "gw-incident-columns", columns);
  }, [columns, ready, styleVersion]);

  // Incident points + FRP extrusion columns (columns grow from the ground)
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const points: FeatureCollection = {
      type: "FeatureCollection",
      features: incidents.map((i) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [i.originLng, i.originLat] },
        properties: {
          status: i.status,
          frp: i.frpMegawatt,
          active:
            i.status === "CONFIRMED_FLAMING" || i.status === "UNVERIFIED_HOTSPOT",
          id: i.id,
        },
      })),
    };
    const cols: FeatureCollection = {
      type: "FeatureCollection",
      features: incidents.map((i) => ({
        type: "Feature" as const,
        geometry: squareAround(i.originLng, i.originLat, 0.004),
        properties: {
          status: i.status,
          height: Math.min(8000, 800 + i.frpMegawatt * 80),
        },
      })),
    };
    map.getSource<GeoJSONSource>("gw-incidents")?.setData(points);
    map.getSource<GeoJSONSource>("gw-incident-columns")?.setData(cols);

    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / GROW_MS);
      const eased = 1 - Math.pow(1 - p, 3);
      if (map.getLayer("gw-incident-columns")) {
        map.setPaintProperty("gw-incident-columns", "fill-extrusion-height", [
          "*",
          ["get", "height"],
          eased,
        ]);
      }
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [incidents, ready, styleVersion]);

  // Every live incident's polygon at the timeline hour; the selected one also gets
  // its nowcast base, the wind-push arrow and the firebreak line.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const selected = incidents.find((i) => i.id === selectedId) ?? incidents[0];
    const burn: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

    // Extinguished fires stop simulating (prd.md); the selected one is drawn last, on top
    const live = incidents.filter((i) => i.status !== "EXTINGUISHED");
    const ordered = [
      ...live.filter((i) => i.id !== selected?.id),
      ...live.filter((i) => i.id === selected?.id),
    ];
    for (const incident of ordered) {
      const isSelected = incident.id === selected?.id;
      const props = {
        id: incident.id,
        status: incident.status,
        selected: isSelected,
        smolder:
          incident.status === "SUSPECTED_SMOLDERING" || incident.status === "CONFIRMED_SMOLDERING",
      };
      burn.features.push({
        ...stepPolygonFor(incident, hourOffset).geojsonPolygon,
        properties: { ...props, isForecast: hourOffset > 0 },
      });
      // Nowcast stays visible as a dimmer base while a forecast hour is selected
      if (isSelected && hourOffset > 0) {
        burn.features.push({
          ...incident.nowcastPolygon.geojsonPolygon,
          properties: { ...props, isForecast: false },
        });
      }
    }
    map.getSource<GeoJSONSource>("gw-burn")?.setData(burn);

    const windArrows: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
    for (const incident of live) {
      const isSelected = incident.id === selected?.id;
      const step = stepPolygonFor(incident, hourOffset);
      const arrow = windArrowGeometry(
        incident.originLat,
        incident.originLng,
        windVectorDeg(incident.weather.windDirectionDeg),
        step.maxSpreadRadiusM,
      );
      for (const feat of arrow.features) {
        windArrows.features.push({
          ...feat,
          properties: {
            ...feat.properties,
            selected: isSelected,
          },
        });
      }
    }
    map.getSource<GeoJSONSource>("gw-wind")?.setData(windArrows);

    if (selected && selected.status !== "EXTINGUISHED") {
      map.getSource<GeoJSONSource>("gw-firebreak")?.setData(firebreakLineString(selected.firebreak));
    } else {
      map.getSource<GeoJSONSource>("gw-firebreak")?.setData(emptyFC());
    }
  }, [incidents, selectedId, hourOffset, ready, styleVersion]);

  // Pulse ring on active incidents + blink on smoldering polygons
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    let raf = 0;
    let staticOpacity = false;
    const tick = (now: number) => {
      if (map.getLayer("gw-incidents-pulse")) {
        const t = (now % PULSE_MS) / PULSE_MS;
        map.setPaintProperty("gw-incidents-pulse", "circle-radius", ["+", BASE_RADIUS, t * 18]);
        map.setPaintProperty("gw-incidents-pulse", "circle-opacity", 0.5 * (1 - t));
      }
      if (map.getLayer("gw-burn-fill")) {
        // Smoldering polygons blink (suspected/confirmed embers under the surface);
        // without any, the static opacity is written once instead of every frame.
        const anySmolder = cb.current.incidents.some(
          (i) => i.status === "SUSPECTED_SMOLDERING" || i.status === "CONFIRMED_SMOLDERING",
        );
        if (anySmolder) {
          const blink = 0.5 + 0.5 * Math.sin((now / BLINK_MS) * Math.PI * 2);
          map.setPaintProperty("gw-burn-fill", "fill-opacity", burnOpacity(0.18 + blink * 0.24));
          staticOpacity = false;
        } else if (!staticOpacity) {
          map.setPaintProperty("gw-burn-fill", "fill-opacity", burnOpacity(0.3));
          staticOpacity = true;
        }
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

  const toggles = [
    { label: "Globe", icon: GlobeIcon, on: globe, set: setGlobe },
    { label: "Terrain", icon: MountainSnowIcon, on: terrain, set: setTerrain },
    { label: "Bangunan", icon: Building2Icon, on: buildings, set: setBuildings },
    { label: "Kolum FRP", icon: BoxIcon, on: columns, set: setColumns },
    { label: "Orbit", icon: RotateCwIcon, on: orbit, set: setOrbit },
  ];

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full bg-slate-950" />
      {ready && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="absolute top-3 left-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap gap-1 rounded-xl border border-white/10 bg-slate-950/80 p-1 backdrop-blur"
        >
          {toggles.map(({ label, icon: Icon, on, set }) => (
            <Button
              key={label}
              size="sm"
              variant={on ? "default" : "ghost"}
              aria-pressed={on}
              onClick={() => {
                set((v) => !v);
                const map = mapRef.current;
                const wantsTilt = label === "Terrain" || label === "Bangunan";
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

// Adds terrain, lighting, sky, 3D buildings and all GambutWatch data layers on top of
// the current OpenFreeMap style. Called on every style.load.
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
      id: "gw-buildings",
      type: "fill-extrusion",
      source: "openmaptiles",
      "source-layer": "building",
      minzoom: 13,
      layout: { visibility: env.buildings ? "visible" : "none" },
      paint: {
        "fill-extrusion-color": [
          "interpolate",
          ["linear"],
          ["coalesce", ["get", "render_height"], 0],
          0,
          "#e7e5e4",
          50,
          "#d6d3d1",
          150,
          "#a8a29e",
        ],
        "fill-extrusion-height": [
          "interpolate",
          ["linear"],
          ["zoom"],
          13,
          0,
          14.5,
          ["coalesce", ["get", "render_height"], 6],
        ],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": 0.85,
      },
    });
  }

  // KHG peatland polygon (context layer)
  map.addSource("gw-khg", { type: "geojson", data: KHG_SUNGAI_KAPUAS_AMBawang });
  map.addLayer({
    id: "gw-khg-fill",
    type: "fill",
    source: "gw-khg",
    paint: {
      "fill-color": "#1a2e05",
      "fill-opacity": 0.35,
    },
  });
  map.addLayer({
    id: "gw-khg-line",
    type: "line",
    source: "gw-khg",
    paint: {
      "line-color": "#3f6212",
      "line-width": 2,
      "line-dasharray": [3, 2],
    },
  });

  // Villages
  map.addSource("gw-villages", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: BmkgVillages.map((v) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [v.lng, v.lat] },
        properties: { name: v.name },
      })),
    },
  });
  map.addLayer({
    id: "gw-villages",
    type: "circle",
    source: "gw-villages",
    paint: {
      "circle-color": "#38bdf8",
      "circle-radius": 4,
      "circle-stroke-width": 1.5,
      "circle-stroke-color": "#0f172a",
    },
  });
  // Village names are labeled on the Leaflet fallback map: the OpenFreeMap styles'
  // glyphs endpoint (fonts/{fontstack}/{range}.pbf) currently 404s, so a symbol
  // layer here would render nothing and log a warning per codepoint.

  // Burn polygons (every live incident at the timeline hour)
  map.addSource("gw-burn", { type: "geojson", data: emptyFC() });
  map.addLayer({
    id: "gw-burn-fill",
    type: "fill",
    source: "gw-burn",
    paint: {
      "fill-color": BURN_COLOR,
      "fill-opacity": burnOpacity(0.3),
    },
  });
  map.addLayer({
    id: "gw-burn-line",
    type: "line",
    source: "gw-burn",
    paint: {
      "line-color": BURN_COLOR,
      "line-width": ["case", ["get", "selected"], 2.5, 1.25],
      "line-dasharray": [2, 2],
    },
  });

  // Firebreak recommendation line (#FACC15 dashed per prd.md)
  map.addSource("gw-firebreak", { type: "geojson", data: emptyFC() });
  map.addLayer({
    id: "gw-firebreak",
    type: "line",
    source: "gw-firebreak",
    paint: {
      "line-color": "#facc15",
      "line-width": 3,
      "line-dasharray": [2, 1.5],
    },
  });

  // Wind-push arrow on the selected incident; the white casing keeps it readable on every basemap
  map.addSource("gw-wind", { type: "geojson", data: emptyFC() });
  map.addLayer({
    id: "gw-wind-casing",
    type: "line",
    source: "gw-wind",
    filter: ["==", ["get", "part"], "shaft"],
    layout: { "line-cap": "round" },
    paint: {
      "line-color": "#ffffff",
      "line-width": ["case", ["get", "selected"], 7, 4.5],
      "line-opacity": 0.85,
    },
  });
  map.addLayer({
    id: "gw-wind-shaft",
    type: "line",
    source: "gw-wind",
    filter: ["==", ["get", "part"], "shaft"],
    layout: { "line-cap": "round" },
    paint: {
      "line-color": WIND_COLOR,
      "line-width": ["case", ["get", "selected"], 3.5, 2],
    },
  });
  map.addLayer({
    id: "gw-wind-head",
    type: "fill",
    source: "gw-wind",
    filter: ["==", ["get", "part"], "head"],
    paint: { "fill-color": WIND_COLOR, "fill-outline-color": "#ffffff" },
  });

  // Incident points + FRP extrusion columns
  map.addSource("gw-incidents", { type: "geojson", data: emptyFC() });
  map.addSource("gw-incident-columns", { type: "geojson", data: emptyFC() });

  map.addLayer({
    id: "gw-incident-columns",
    type: "fill-extrusion",
    source: "gw-incident-columns",
    minzoom: 9,
    layout: { visibility: env.columns ? "visible" : "none" },
    paint: {
      "fill-extrusion-color": STATUS_COLOR,
      "fill-extrusion-height": 0,
      "fill-extrusion-opacity": 0.7,
    },
  });

  // Expanding ring behind active incidents (radius/opacity animated in a rAF loop)
  map.addLayer({
    id: "gw-incidents-pulse",
    type: "circle",
    source: "gw-incidents",
    filter: ["==", ["get", "active"], true],
    paint: {
      "circle-color": "#ef4444",
      "circle-radius": BASE_RADIUS,
      "circle-opacity": 0,
      "circle-blur": 0.4,
    },
  });

  map.addLayer({
    id: "gw-incidents",
    type: "circle",
    source: "gw-incidents",
    paint: {
      "circle-color": STATUS_COLOR,
      "circle-radius": BASE_RADIUS,
      "circle-stroke-width": 1.5,
      "circle-stroke-color": "#ffffff",
    },
  });
}

function setVisible(map: maplibregl.Map | null, layerId: string, visible: boolean) {
  if (map?.getLayer(layerId)) {
    map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
  }
}

function squareAround(lng: number, lat: number, halfDeg: number): GeoJSON.Polygon {
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

function emptyFC(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}
