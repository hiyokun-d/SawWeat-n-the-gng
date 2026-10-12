"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef } from "react";
import type { TerraDraw } from "terra-draw";
import { TerraDrawLeafletAdapter } from "terra-draw-leaflet-adapter";
import { FIRMS_ATTRIBUTION, OSM_TILES } from "@/lib/basemaps";
import { confidenceColor, fireRadius } from "@/lib/fire-types";
import { createTerraDraw } from "./terra";
import { INITIAL_CENTER, INITIAL_ZOOM, type FireMapProps } from "./types";

export default function LeafletMap(props: FireMapProps) {
  const { fires, areas, activeAreaId, drawMode, focus } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const firesLayer = useRef<L.LayerGroup | null>(null);
  const areasLayer = useRef<L.LayerGroup | null>(null);
  // Keep latest callbacks without re-creating the map
  const cb = useRef(props);
  useEffect(() => {
    cb.current = props;
  });

  useEffect(() => {
    const map = L.map(containerRef.current!, {
      preferCanvas: true,
      zoomControl: false,
    }).setView([INITIAL_CENTER[1], INITIAL_CENTER[0]], INITIAL_ZOOM);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.tileLayer(OSM_TILES.url, {
      maxZoom: OSM_TILES.maxZoom,
      attribution: `${OSM_TILES.attribution} | ${FIRMS_ATTRIBUTION}`,
    }).addTo(map);

    areasLayer.current = L.layerGroup().addTo(map);
    firesLayer.current = L.layerGroup().addTo(map);

    const emitViewport = () => {
      const b = map.getBounds();
      cb.current.onViewportChange([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    };
    map.on("moveend", emitViewport);
    emitViewport();

    const draw = createTerraDraw(
      new TerraDrawLeafletAdapter({ lib: L, map }),
      (g) => cb.current.onAreaDrawn(g),
    );
    draw.start();
    draw.setMode("static");

    mapRef.current = map;
    drawRef.current = draw;
    return () => {
      draw.stop();
      map.remove();
      mapRef.current = null;
      drawRef.current = null;
    };
  }, []);

  useEffect(() => {
    drawRef.current?.setMode(drawMode);
  }, [drawMode]);

  useEffect(() => {
    const layer = firesLayer.current;
    if (!layer) return;
    layer.clearLayers();
    for (const f of fires) {
      L.circleMarker([f.lat, f.lng], {
        radius: fireRadius(f.frp),
        color: confidenceColor(f.confidence),
        fillColor: confidenceColor(f.confidence),
        fillOpacity: 0.75,
        weight: 1,
      })
        .on("click", () => cb.current.onFireClick(f))
        .addTo(layer);
    }
  }, [fires]);

  useEffect(() => {
    const layer = areasLayer.current;
    if (!layer) return;
    layer.clearLayers();
    for (const a of areas) {
      const active = a.id === activeAreaId;
      L.geoJSON(a.geometry, {
        interactive: false,
        style: {
          color: active ? "#38bdf8" : "#94a3b8",
          weight: active ? 3 : 1.5,
          dashArray: active ? undefined : "4 4",
          fillOpacity: active ? 0.08 : 0.03,
        },
      })
        .bindTooltip(a.name, { permanent: active, direction: "center" })
        .addTo(layer);
    }
  }, [areas, activeAreaId]);

  useEffect(() => {
    if (!focus || !mapRef.current) return;
    const [w, s, e, n] = focus.bbox;
    mapRef.current.flyToBounds(
      [
        [s, w],
        [n, e],
      ],
      { padding: [40, 40], duration: 0.8 },
    );
  }, [focus]);

  return <div ref={containerRef} className="h-full w-full bg-neutral-900" />;
}
