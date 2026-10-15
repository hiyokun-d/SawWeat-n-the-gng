"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import {
  BoxIcon,
  Building2Icon,
  CloudFogIcon,
  CompassIcon,
  FootprintsIcon,
  GlobeIcon,
  MountainSnowIcon,
  RotateCwIcon,
  WindIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { BMKG_ATTRIBUTION, getMapStyle } from "@/lib/basemaps";
import { aqiBand, BmkgVillages, FIRE_STATUS_COLOR, isSmoldering, THREAT_COLOR } from "@/lib/gambut";
import { addTerrainLayers, setTerrainEnabled } from "@/lib/terrain";
import {
  evacuationArrow,
  firebreakLineString,
  smokePlume,
  stepPolygonFor,
  weatherAtHour,
  windArrowGeometry,
} from "@/lib/simulationEngine";
import { KHG_SUNGAI_KAPUAS_AMBawang } from "@/data/khgKalbar.geojson";
import { INDONESIA_CENTER, INDONESIA_ZOOM, type GambutMapProps } from "./types";

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

const BURN_COLOR = STATUS_COLOR;

// Indonesia is the focus: its fires stay readable from the whole-country view,
// fires elsewhere are still drawn but small and dimmer
// Radius without the zoom curve, for paint updates that add to it (zoom must stay top-level)
const HOTSPOT_RADIUS_FLAT: maplibregl.ExpressionSpecification = ["case", ["get", "indo"], 4, 1.6];

const HOTSPOT_RADIUS: maplibregl.ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  2,
  ["case", ["get", "indo"], 2.5, 0.8],
  6,
  ["case", ["get", "indo"], 4, 1.6],
  10,
  ["case", ["get", "indo"], 6, 3],
];

// Wind-push arrow: sky blue is not used by any fire status, so it never reads as a fire state.
const WIND_COLOR = "#0284c7";
// Evacuation: emerald with a dark casing, drawn from the village, never from a fire
const EVAC_COLOR = "#10b981";
const AIR_CELL_DEG = 0.5;

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
  center: INDONESIA_CENTER,
  zoom: INDONESIA_ZOOM,
  pitch: 0,
  bearing: 0,
};

const PULSE_MS = 2800;
const GROW_MS = 1400;
const BLINK_MS = 2800;

export default function MapLibreMap(props: MapLibreMapProps) {
  const { incidents, hotspots, air, selectedId, focusId, camera, chromeless, hourOffset, mapStyle } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const appliedStyle = useRef(mapStyle);
  // Bumped every time a style finishes loading and our overlays are (re)installed;
  // data/paint effects depend on it so they re-apply after a style switch.
  const [styleVersion, setStyleVersion] = useState(0);
  const ready = styleVersion > 0;
  const [globe, setGlobe] = useState(true);
  // Off by default: DEM tiles + terrain rendering are the heaviest GPU load; one click turns it on
  const [terrain, setTerrain] = useState(false);
  const [buildings, setBuildings] = useState(true);
  const [columns, setColumns] = useState(true);
  const [orbit, setOrbit] = useState(false);
  const [smoke, setSmoke] = useState(true);
  const [airLayer, setAirLayer] = useState(true);
  const [evac, setEvac] = useState(true);
  const env = useRef({ globe, terrain, buildings, columns, smoke, airLayer, evac });
  const cb = useRef(props);
  useEffect(() => {
    cb.current = props;
    env.current = { globe, terrain, buildings, columns, smoke, airLayer, evac };
  });

  useEffect(() => {
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current!,
        style: getMapStyle(appliedStyle.current).url,
        // Start on the globe; the load handler flies in over Indonesia
        center: INDONESIA_CENTER,
        zoom: 2,
        maxPitch: 85,
        // Full Retina density roughly doubles fragment work for little visible gain on a data map
        pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
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

    // Fire clicks (layer-scoped handlers survive style switches); a click on a
    // simulated incident and on the worldwide layer both select the fire
    const onFireClick = (e: maplibregl.MapLayerMouseEvent) => {
      const id: unknown = e.features?.[0]?.properties?.id;
      if (typeof id !== "string") return;
      cb.current.onSelectIncident(id);
      setOrbit(false);
    };
    for (const layer of ["gw-incidents", "gw-hotspots"]) {
      map.on("click", layer, onFireClick);
      map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
    }

    const reportViewport = () => {
      const b = map.getBounds();
      cb.current.onViewportChange([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    };
    map.on("moveend", reportViewport);
    map.once("load", reportViewport);

    // Any manual interaction cancels the orbit
    for (const ev of ["mousedown", "touchstart", "wheel"] as const) {
      map.on(ev, () => setOrbit(false));
    }

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Fly to a fire someone picked (list, map click, the other window)
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !focusId) return;
    const target = cb.current.hotspots.find((h) => h.id === focusId);
    if (!target) return;
    map.flyTo({
      center: [target.lng, target.lat],
      zoom: Math.max(map.getZoom(), 12),
      pitch: 58,
      bearing: map.getBearing() + 30,
      duration: 2400,
      essential: true,
    });
  }, [focusId, ready]);

  // Scripted shots from presentation mode
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !camera) return;
    setOrbit(false);
    map.flyTo({
      center: camera.center,
      zoom: camera.zoom,
      pitch: camera.pitch ?? 0,
      bearing: camera.bearing ?? 0,
      duration: camera.duration,
      curve: 1.5,
      essential: true,
    });
  }, [camera, ready]);

  // Worldwide fire layer
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.getSource<GeoJSONSource>("gw-hotspots")?.setData({
      type: "FeatureCollection",
      features: hotspots.map((h) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [h.lng, h.lat] },
        properties: { id: h.id, status: h.effectiveStatus, indo: h.inIndonesia, fresh: h.fresh },
      })),
    });
  }, [hotspots, ready, styleVersion]);

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

  useEffect(() => {
    if (ready) setVisible(mapRef.current, "gw-smoke", smoke);
  }, [smoke, ready, styleVersion]);

  useEffect(() => {
    for (const id of ["gw-air-fill", "gw-air-line"]) if (ready) setVisible(mapRef.current, id, airLayer);
  }, [airLayer, ready, styleVersion]);

  useEffect(() => {
    for (const id of ["gw-evac-casing", "gw-evac-shaft", "gw-evac-head", "gw-village-threat"]) {
      if (ready) setVisible(mapRef.current, id, evac);
    }
  }, [evac, ready, styleVersion]);

  // Air quality grid: one square per 0.5-degree area, colored by US AQI band
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const half = AIR_CELL_DEG / 2;
    map.getSource<GeoJSONSource>("gw-air")?.setData({
      type: "FeatureCollection",
      features: Object.entries(air ?? {}).flatMap(([key, a]) => {
        if (a.usAqi === null) return [];
        const [lat, lng] = key.split(",").map(Number);
        return [
          {
            type: "Feature" as const,
            properties: { color: aqiBand(a.usAqi).color, aqi: a.usAqi },
            geometry: {
              type: "Polygon" as const,
              coordinates: [
                [
                  [lng - half, lat - half],
                  [lng + half, lat - half],
                  [lng + half, lat + half],
                  [lng - half, lat + half],
                  [lng - half, lat - half],
                ],
              ],
            },
          },
        ];
      }),
    });
  }, [air, ready, styleVersion]);

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
        smolder: isSmoldering(incident.status),
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
      // The arrow follows the forecast wind at the timeline hour
      const arrow = windArrowGeometry(
        incident.originLat,
        incident.originLng,
        weatherAtHour(incident.weather, new Date(), hourOffset).windVectorDeg,
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

    // Smoke drift for every live fire, following the forecast wind at this hour
    const now = new Date();
    map.getSource<GeoJSONSource>("gw-smoke")?.setData({
      type: "FeatureCollection",
      features: live.map((i) => smokePlume(i, now, hourOffset)),
    });

    // Threatened villages and their escape direction
    const villages: GeoJSON.Feature[] = [];
    const evacFeatures: GeoJSON.Feature[] = [];
    const seen = new Set<string>();
    for (const i of live) {
      const v = i.nearestVillage;
      if (!v || seen.has(v.name)) continue;
      seen.add(v.name);
      villages.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [v.lng, v.lat] },
        properties: { color: THREAT_COLOR[v.threatLevel], danger: v.threatLevel !== "AMAN" },
      });
      if (v.threatLevel !== "AMAN" || i.id === selected?.id) {
        evacFeatures.push(...evacuationArrow(v).features);
      }
    }
    map.getSource<GeoJSONSource>("gw-village-threat")?.setData({ type: "FeatureCollection", features: villages });
    map.getSource<GeoJSONSource>("gw-evac")?.setData({ type: "FeatureCollection", features: evacFeatures });

    if (selected && selected.status !== "EXTINGUISHED") {
      map.getSource<GeoJSONSource>("gw-firebreak")?.setData(firebreakLineString(selected.firebreak));
    } else {
      map.getSource<GeoJSONSource>("gw-firebreak")?.setData(emptyFC());
    }
  }, [incidents, selectedId, hourOffset, ready, styleVersion]);

  // Pulse ring on active incidents + blink on smoldering polygons (throttled for GPU efficiency)
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;

    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reducedMotion) {
      if (map.getLayer("gw-burn-fill")) {
        map.setPaintProperty("gw-burn-fill", "fill-opacity", burnOpacity(0.28));
      }
      if (map.getLayer("gw-incidents-pulse")) {
        map.setPaintProperty("gw-incidents-pulse", "circle-opacity", 0);
      }
      if (map.getLayer("gw-hotspots-pulse")) {
        // Static ring keeps "new" readable without motion
        map.setPaintProperty("gw-hotspots-pulse", "circle-radius", ["+", HOTSPOT_RADIUS_FLAT, 4]);
        map.setPaintProperty("gw-hotspots-pulse", "circle-stroke-opacity", 0.6);
      }
      return;
    }

    // A 10 Hz timer instead of a per-frame loop: the pulses are slow, and each
    // paint update forces a full repaint, so fewer updates = a cooler GPU
    let staticOpacity = false;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      const now = performance.now();
      const zoom = map.getZoom();
      // Spread polygons and incident rings are too small to see when zoomed far out
      const detail = zoom >= 7;
      if (detail && map.getLayer("gw-incidents-pulse")) {
        const t = (now % PULSE_MS) / PULSE_MS;
        map.setPaintProperty("gw-incidents-pulse", "circle-radius", ["+", BASE_RADIUS, t * 12]);
        map.setPaintProperty("gw-incidents-pulse", "circle-opacity", 0.35 * (1 - t));
      }
      // New detections (last 3 h) ripple so fresh fires stand out from old ones
      if (map.getLayer("gw-hotspots-pulse")) {
        const t = ((now + PULSE_MS / 2) % PULSE_MS) / PULSE_MS;
        map.setPaintProperty("gw-hotspots-pulse", "circle-radius", ["+", HOTSPOT_RADIUS_FLAT, t * 10]);
        map.setPaintProperty("gw-hotspots-pulse", "circle-stroke-opacity", 0.7 * (1 - t));
      }
      if (map.getLayer("gw-burn-fill")) {
        const anySmolder = detail && cb.current.incidents.some((i) => isSmoldering(i.status));
        if (anySmolder) {
          const blink = 0.5 + 0.5 * Math.sin((now / BLINK_MS) * Math.PI * 2);
          map.setPaintProperty("gw-burn-fill", "fill-opacity", burnOpacity(0.22 + blink * 0.16));
          staticOpacity = false;
        } else if (!staticOpacity) {
          map.setPaintProperty("gw-burn-fill", "fill-opacity", burnOpacity(0.3));
          staticOpacity = true;
        }
      }
    }, 100);
    return () => window.clearInterval(timer);
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

  // Two groups: how the map looks, and which data layers are drawn
  const toggleGroups = [
    [
      { label: "Globe", icon: GlobeIcon, on: globe, set: setGlobe },
      { label: "Terrain", icon: MountainSnowIcon, on: terrain, set: setTerrain },
      { label: "Bangunan 3D", icon: Building2Icon, on: buildings, set: setBuildings },
      { label: "Orbit kamera", icon: RotateCwIcon, on: orbit, set: setOrbit },
    ],
    [
      { label: "Kolom FRP", icon: BoxIcon, on: columns, set: setColumns },
      { label: "Arah asap", icon: WindIcon, on: smoke, set: setSmoke },
      { label: "Kualitas udara", icon: CloudFogIcon, on: airLayer, set: setAirLayer },
      { label: "Evakuasi", icon: FootprintsIcon, on: evac, set: setEvac },
    ],
  ];

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full bg-slate-950" />
      {ready && !chromeless && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="absolute top-3 left-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap gap-1 rounded-xl border border-white/10 bg-slate-950/80 p-1 backdrop-blur"
        >
          {toggleGroups.map((group, gi) => (
            <div key={gi} className={`flex gap-0.5 ${gi > 0 ? "border-l border-white/10 pl-1" : ""}`}>
              {group.map(({ label, icon: Icon, on, set }) => (
                <Button
                  key={label}
                  size="icon-sm"
                  variant="ghost"
                  aria-pressed={on}
                  aria-label={label}
                  title={`${label}: ${on ? "aktif" : "mati"}`}
                  className={on ? "bg-white/15 text-white" : "text-slate-500"}
                  onClick={() => {
                    set((v) => !v);
                    const map = mapRef.current;
                    const wantsTilt = label === "Terrain" || label === "Bangunan 3D";
                    if (wantsTilt && !on && map && map.getPitch() < 30) {
                      map.easeTo({ pitch: 55, duration: 1200 });
                    }
                  }}
                >
                  <Icon />
                </Button>
              ))}
            </div>
          ))}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Kembali ke tampilan Indonesia"
            title="Kembali ke tampilan Indonesia"
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
  env: {
    globe: boolean;
    terrain: boolean;
    buildings: boolean;
    columns: boolean;
    smoke: boolean;
    airLayer: boolean;
    evac: boolean;
  },
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

  // Air quality grid (Open-Meteo / CAMS), under everything fire-related
  map.addSource("gw-air", { type: "geojson", data: emptyFC() });
  map.addLayer({
    id: "gw-air-fill",
    type: "fill",
    source: "gw-air",
    layout: { visibility: env.airLayer ? "visible" : "none" },
    paint: { "fill-color": ["get", "color"], "fill-opacity": 0.16 },
  });
  map.addLayer({
    id: "gw-air-line",
    type: "line",
    source: "gw-air",
    layout: { visibility: env.airLayer ? "visible" : "none" },
    paint: { "line-color": ["get", "color"], "line-opacity": 0.45, "line-width": 1 },
  });

  // Smoke drift cones (modeled from the forecast wind)
  map.addSource("gw-smoke", { type: "geojson", data: emptyFC() });
  map.addLayer({
    id: "gw-smoke",
    type: "fill",
    source: "gw-smoke",
    layout: { visibility: env.smoke ? "visible" : "none" },
    paint: { "fill-color": "#64748b", "fill-opacity": 0.22, "fill-outline-color": "#94a3b8" },
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

  // Evacuation arrows from threatened villages (crosswind, away from the fire)
  map.addSource("gw-evac", { type: "geojson", data: emptyFC() });
  const evacVisibility = env.evac ? "visible" : "none";
  map.addLayer({
    id: "gw-evac-casing",
    type: "line",
    source: "gw-evac",
    filter: ["==", ["get", "part"], "shaft"],
    layout: { "line-cap": "round", visibility: evacVisibility },
    paint: { "line-color": "#022c22", "line-width": 6, "line-opacity": 0.8 },
  });
  map.addLayer({
    id: "gw-evac-shaft",
    type: "line",
    source: "gw-evac",
    filter: ["==", ["get", "part"], "shaft"],
    layout: { "line-cap": "round", visibility: evacVisibility },
    paint: { "line-color": EVAC_COLOR, "line-width": 3, "line-dasharray": [1.5, 1] },
  });
  map.addLayer({
    id: "gw-evac-head",
    type: "fill",
    source: "gw-evac",
    filter: ["==", ["get", "part"], "head"],
    layout: { visibility: evacVisibility },
    paint: { "fill-color": EVAC_COLOR, "fill-outline-color": "#022c22" },
  });

  // Ring per threatened village, colored by threat level
  map.addSource("gw-village-threat", { type: "geojson", data: emptyFC() });
  map.addLayer({
    id: "gw-village-threat",
    type: "circle",
    source: "gw-village-threat",
    layout: { visibility: evacVisibility },
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 5, 12, 14],
      "circle-color": "rgba(0,0,0,0)",
      "circle-stroke-color": ["get", "color"],
      "circle-stroke-width": ["case", ["get", "danger"], 3, 1.5],
    },
  });

  // Every fire worldwide (simulated incidents draw on top of these)
  map.addSource("gw-hotspots", { type: "geojson", data: emptyFC() });
  map.addLayer({
    id: "gw-hotspots-pulse",
    type: "circle",
    source: "gw-hotspots",
    // Fresh rings only in the focus country; thousands worldwide would repaint for nothing
    filter: ["all", ["==", ["get", "fresh"], true], ["==", ["get", "indo"], true]],
    paint: {
      "circle-radius": HOTSPOT_RADIUS_FLAT,
      "circle-color": "rgba(0,0,0,0)",
      "circle-stroke-color": STATUS_COLOR,
      "circle-stroke-width": 1.5,
      "circle-stroke-opacity": 0,
    },
  });
  map.addLayer({
    id: "gw-hotspots",
    type: "circle",
    source: "gw-hotspots",
    paint: {
      "circle-color": STATUS_COLOR,
      "circle-radius": HOTSPOT_RADIUS,
      "circle-opacity": ["case", ["get", "indo"], 0.95, 0.55],
      "circle-stroke-width": ["case", ["get", "indo"], 0.75, 0],
      "circle-stroke-color": "#0f172a",
    },
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
