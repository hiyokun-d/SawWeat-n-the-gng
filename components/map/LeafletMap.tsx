"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef, useState } from "react";
import { BmkgVillages, FIRE_STATUS_COLOR, isSmoldering, THREAT_COLOR } from "@/lib/gambut";
import {
  evacuationArrow,
  firebreakLineString,
  smokePlume,
  stepPolygonFor,
  weatherAtHour,
  windArrowGeometry,
} from "@/lib/simulationEngine";
import { OSM_TILES } from "@/lib/basemaps";
import { KHG_SUNGAI_KAPUAS_AMBawang } from "@/data/khgKalbar.geojson";
import { INDONESIA_CENTER, INDONESIA_ZOOM, type GambutMapProps } from "./types";

/** SVG/canvas markers get slow past a few thousand; the rest of the world appears on zoom-in. */
const MAX_HOTSPOT_MARKERS = 6000;

// Same sky blue as the MapLibre wind arrow
const WIND_COLOR = "#0284c7";

/**
 * Leaflet fallback engine: raster OSM tiles, no WebGL.
 * Renders the same GambutWatch layers as the MapLibre engine.
 */
export default function LeafletMap(props: GambutMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const khgLayer = useRef<L.GeoJSON | null>(null);
  const incidentLayers = useRef<L.LayerGroup | null>(null);
  const villageLayer = useRef<L.LayerGroup | null>(null);
  const hotspotLayer = useRef<L.LayerGroup | null>(null);
  const [viewTick, setViewTick] = useState(0);

  // Latest props without re-creating the map
  const cb = useRef(props);
  useEffect(() => {
    cb.current = props;
  });

  useEffect(() => {
    const map = L.map(containerRef.current!, {
      preferCanvas: false,
      zoomControl: false,
    }).setView([INDONESIA_CENTER[1], INDONESIA_CENTER[0]], Math.round(INDONESIA_ZOOM));
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.tileLayer(OSM_TILES.url, {
      maxZoom: OSM_TILES.maxZoom,
      attribution: `${OSM_TILES.attribution} | Data cuaca: Open-Meteo / BMKG`,
    }).addTo(map);

    // KHG peatland hydrology unit polygon (context layer)
    khgLayer.current = L.geoJSON(KHG_SUNGAI_KAPUAS_AMBawang as GeoJSON.GeoJsonObject, {
      interactive: false,
      style: {
        color: "#3f6212",
        weight: 2,
        dashArray: "6 4",
        fillColor: "#1a2e05",
        fillOpacity: 0.35,
      },
    }).addTo(map);
    khgLayer.current.bindTooltip(
      "KHG Sungai Kapuas - Sungai Ambawang (batas aproksimasi)",
      { sticky: true },
    );

    villageLayer.current = L.layerGroup().addTo(map);
    for (const v of BmkgVillages) {
      const pin = L.marker([v.lat, v.lng], {
        icon: L.divIcon({
          className: "",
          html: `<div style="display:flex;flex-direction:column;align-items:center">
            <div style="width:10px;height:10px;border-radius:9999px;background:#38bdf8;border:2px solid #0f172a"></div>
            <span style="font-size:10px;color:#93c5fd;text-shadow:0 1px 2px #000;margin-top:2px;white-space:nowrap">${v.name}</span>
          </div>`,
          iconSize: [90, 34],
          iconAnchor: [45, 6],
        }),
      });
      pin.addTo(villageLayer.current);
    }

    hotspotLayer.current = L.layerGroup().addTo(map);
    incidentLayers.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    const reportViewport = () => {
      const b = map.getBounds();
      cb.current.onViewportChange([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
      setViewTick((t) => t + 1);
    };
    map.on("moveend", reportViewport);
    reportViewport();

    return () => {
      map.remove();
      mapRef.current = null;
      khgLayer.current = null;
      incidentLayers.current = null;
      villageLayer.current = null;
      hotspotLayer.current = null;
    };
  }, []);

  // Worldwide fires in view on one shared canvas; Indonesia larger and opaque
  useEffect(() => {
    const layer = hotspotLayer.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    layer.clearLayers();
    const bounds = map.getBounds();
    const renderer = L.canvas({ padding: 0.2 });
    const inView = props.hotspots.filter((h) => bounds.contains([h.lat, h.lng]));
    // Indonesia first so the cap never hides it
    inView.sort((a, b) => Number(b.inIndonesia) - Number(a.inIndonesia));
    for (const h of inView.slice(0, MAX_HOTSPOT_MARKERS)) {
      const color = FIRE_STATUS_COLOR[h.effectiveStatus];
      L.circleMarker([h.lat, h.lng], {
        renderer,
        radius: h.inIndonesia ? 4 : 2,
        color: "#0f172a",
        weight: h.inIndonesia ? 0.75 : 0,
        fillColor: color,
        fillOpacity: h.inIndonesia ? 0.95 : 0.55,
      })
        .on("click", () => cb.current.onSelectIncident(h.id))
        .addTo(layer);
    }
  }, [props.hotspots, viewTick]);

  // Follow a fire someone picked, not the timeline or the default pick
  useEffect(() => {
    const map = mapRef.current;
    const target = props.focusId ? cb.current.hotspots.find((h) => h.id === props.focusId) : null;
    if (!map || !target) return;
    map.setView([target.lat, target.lng], Math.max(map.getZoom(), 12), { animate: true });
  }, [props.focusId]);

  // Scripted shots from presentation mode
  useEffect(() => {
    const map = mapRef.current;
    const c = props.camera;
    if (!map || !c) return;
    map.flyTo([c.center[1], c.center[0]], Math.round(c.zoom), {
      animate: c.duration > 0,
      duration: c.duration / 1000,
    });
  }, [props.camera]);

  useEffect(() => {
    const layer = incidentLayers.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    layer.clearLayers();

    const { incidents, selectedId, hourOffset } = cb.current;
    const selected = incidents.find((i) => i.id === selectedId) ?? incidents[0] ?? null;

    // Burn polygons of every live incident at the timeline hour (extinguished fires stop
    // simulating); the selected one is added last so it draws on top.
    const live = incidents.filter((i) => i.status !== "EXTINGUISHED");
    const ordered = [
      ...live.filter((i) => i.id !== selected?.id),
      ...live.filter((i) => i.id === selected?.id),
    ];
    for (const incident of ordered) {
      const isSelected = incident.id === selected?.id;
      const smoldering = isSmoldering(incident.status);
      L.geoJSON(stepPolygonFor(incident, hourOffset).geojsonPolygon as GeoJSON.GeoJsonObject, {
        interactive: false,
        style: {
          color: smoldering ? "#fb923c" : "#ef4444",
          weight: isSelected ? 2.5 : 1.25,
          dashArray: "3 3",
          fillColor: smoldering ? "#f97316" : "#dc2626",
          fillOpacity: isSelected ? 0.35 : 0.2,
          className: smoldering ? "smolder-blink" : undefined,
        },
      }).addTo(layer);

      // Nowcast stays visible as a dimmer base while a forecast hour is selected
      if (isSelected && hourOffset > 0) {
        L.geoJSON(incident.nowcastPolygon.geojsonPolygon as GeoJSON.GeoJsonObject, {
          interactive: false,
          style: {
            color: smoldering ? "#fb923c" : "#ef4444",
            weight: 1.25,
            dashArray: "3 3",
            fillColor: smoldering ? "#f97316" : "#dc2626",
            fillOpacity: 0.2,
          },
        }).addTo(layer);
      }
    }

    if (selected && selected.status !== "EXTINGUISHED") {
      L.geoJSON(firebreakLineString(selected.firebreak) as GeoJSON.GeoJsonObject, {
        interactive: false,
        style: {
          color: "#facc15",
          weight: 3,
          dashArray: "10 6",
          fillOpacity: 0,
        },
      })
        .bindTooltip("REKOMENDASI SEKAT BAKAR (POTONG DI SINI)", { sticky: true })
        .addTo(layer);

    }

    for (const incident of live) {
      const isSelected = incident.id === selected?.id;
      const arrow = windArrowGeometry(
        incident.originLat,
        incident.originLng,
        weatherAtHour(incident.weather, new Date(), hourOffset).windVectorDeg,
        stepPolygonFor(incident, hourOffset).maxSpreadRadiusM,
      );
      L.geoJSON(arrow as GeoJSON.GeoJsonObject, {
        interactive: false,
        filter: (f) => f.properties?.part === "shaft",
        style: { color: "#ffffff", weight: isSelected ? 8 : 4.5, opacity: 0.85, lineCap: "round" },
      }).addTo(layer);
      L.geoJSON(arrow as GeoJSON.GeoJsonObject, {
        interactive: false,
        style: (f) =>
          f?.properties?.part === "shaft"
            ? { color: WIND_COLOR, weight: isSelected ? 4 : 2, lineCap: "round" }
            : { color: "#ffffff", weight: 1, fillColor: WIND_COLOR, fillOpacity: 1 },
      }).addTo(layer);
    }

    // Smoke drift cones and evacuation arrows (same models as the 3D map)
    const now = new Date();
    for (const incident of live) {
      L.geoJSON(smokePlume(incident, now, hourOffset) as GeoJSON.GeoJsonObject, {
        interactive: false,
        style: { color: "#94a3b8", weight: 0.5, fillColor: "#64748b", fillOpacity: 0.22 },
      }).addTo(layer);
      const v = incident.nearestVillage;
      if (v && (v.threatLevel !== "AMAN" || incident.id === selected?.id)) {
        L.circleMarker([v.lat, v.lng], {
          radius: 10,
          color: THREAT_COLOR[v.threatLevel],
          weight: 3,
          fill: false,
          interactive: false,
        }).addTo(layer);
        L.geoJSON(evacuationArrow(v) as GeoJSON.GeoJsonObject, {
          interactive: false,
          style: (f) =>
            f?.properties?.part === "shaft"
              ? { color: "#10b981", weight: 3, dashArray: "6 4" }
              : { color: "#022c22", weight: 1, fillColor: "#10b981", fillOpacity: 1 },
        }).addTo(layer);
      }
    }

    // Markers last so every point stays clickable above the polygons
    for (const incident of incidents) {
      const isSelected = incident.id === selected?.id;
      const statusColor = FIRE_STATUS_COLOR[incident.status];
      L.circleMarker([incident.originLat, incident.originLng], {
        radius: isSelected ? 8 : 5,
        color: statusColor,
        fillColor: statusColor,
        fillOpacity: 1,
        weight: 2,
        className: isSmoldering(incident.status) ? "smolder-blink" : undefined,
      })
        .bindTooltip(`${incident.id} · FRP ${incident.frpMegawatt} MW`, { sticky: true })
        .on("click", () => cb.current.onSelectIncident(incident.id))
        .addTo(layer);
    }

  }, [props.incidents, props.selectedId, props.hourOffset]);

  return <div ref={containerRef} className="h-full w-full bg-slate-950" />;
}
