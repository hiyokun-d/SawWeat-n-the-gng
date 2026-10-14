"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef } from "react";
import { FIRE_STATUS_COLOR, type HotspotIncident } from "@/lib/gambut";
import { KHG_SUNGAI_KAPUAS_AMBawang } from "@/data/khgKalbar.geojson";
import { BmkgVillages } from "@/lib/gambut";

export interface HudMapProps {
  incidents: HotspotIncident[];
  selectedId: string | null;
  /** Volunteer position (GPS or fallback). */
  position: { lat: number; lng: number };
  onSelectIncident: (id: string) => void;
}

/**
 * Compact tactical map for the MPA field HUD: shows the volunteer position,
 * every hotspot, and for the selected incident the nowcast polygon, the
 * recommended firebreak line, and a navigation path from the volunteer to
 * the cut point.
 */
export default function HudMap({ incidents, selectedId, position, onSelectIncident }: HudMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  // Latest props without re-creating the map
  const cb = useRef({ incidents, selectedId, position, onSelectIncident });
  useEffect(() => {
    cb.current = { incidents, selectedId, position, onSelectIncident };
  });

  useEffect(() => {
    const map = L.map(containerRef.current!, {
      zoomControl: false,
      attributionControl: true,
    }).setView([position.lat, position.lng], 13);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> | Data cuaca: BMKG | Data hotspot: NASA FIRMS',
    }).addTo(map);

    // KHG peatland polygon (context)
    L.geoJSON(KHG_SUNGAI_KAPUAS_AMBawang as GeoJSON.GeoJsonObject, {
      interactive: false,
      style: {
        color: "#3f6212",
        weight: 1.5,
        dashArray: "6 4",
        fillColor: "#1a2e05",
        fillOpacity: 0.3,
      },
    }).addTo(map);

    // Villages
    for (const v of BmkgVillages) {
      L.marker([v.lat, v.lng], {
        icon: L.divIcon({
          className: "",
          html: `<div style="display:flex;align-items:center;gap:4px">
            <span style="width:8px;height:8px;border-radius:9999px;background:#38bdf8;border:1.5px solid #0f172a"></span>
            <span style="font-size:10px;color:#93c5fd;text-shadow:0 1px 2px #000;white-space:nowrap">${v.name}</span>
          </div>`,
          iconSize: [0, 0],
        }),
      }).addTo(map);
    }

    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    // Leaflet needs a nudge after the container mounts inside a flex layout
    setTimeout(() => map.invalidateSize(), 100);

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const { incidents: list, selectedId: selId, position: pos } = cb.current;
    const selected = list.find((i) => i.id === selId) ?? list[0] ?? null;

    // Volunteer position marker
    L.circleMarker([pos.lat, pos.lng], {
      radius: 7,
      color: "#ffffff",
      weight: 2,
      fillColor: "#3b82f6",
      fillOpacity: 1,
    })
      .bindTooltip("Posisi Anda", { sticky: true })
      .addTo(layer);

    // All hotspots
    for (const incident of list) {
      const isSelected = incident.id === selected?.id;
      const color = FIRE_STATUS_COLOR[incident.status];
      const smoldering =
        incident.status === "SUSPECTED_SMOLDERING" || incident.status === "CONFIRMED_SMOLDERING";

      L.circleMarker([incident.originLat, incident.originLng], {
        radius: isSelected ? 9 : 6,
        color: "#ffffff",
        weight: 2,
        fillColor: color,
        fillOpacity: 1,
        className: smoldering ? "smolder-blink" : undefined,
      })
        .bindTooltip(`${incident.id} · FRP ${incident.frpMegawatt} MW`, { sticky: true })
        .on("click", () => cb.current.onSelectIncident(incident.id))
        .addTo(layer);
    }

    const live = list.filter((i) => i.status !== "EXTINGUISHED");
    for (const incident of live) {
      const isSelected = incident.id === selected?.id;
      L.geoJSON(incident.nowcastPolygon.geojsonPolygon as GeoJSON.GeoJsonObject, {
        interactive: false,
        style: {
          color: smolderingColor(incident.status),
          weight: isSelected ? 2.5 : 1.25,
          dashArray: "3 3",
          fillColor: smolderingColor(incident.status),
          fillOpacity: isSelected ? 0.35 : 0.18,
          className: smolderingClass(incident.status),
        },
      }).addTo(layer);
    }

    if (!selected || selected.status === "EXTINGUISHED") return;

    // Firebreak line + cut point
    const fb = selected.firebreak;
    const line: [number, number][] = fb.coordinates.map((c) => [c[0], c[1]]);
    L.polyline(line, {
      color: "#facc15",
      weight: 3,
      dashArray: "10 6",
      interactive: false,
    })
      .bindTooltip("Garis sekat bakar (potong di sini)", { sticky: true })
      .addTo(layer);

    const target = fb.coordinates[2] ?? fb.coordinates[0];
    L.marker([target[0], target[1]], {
      icon: L.divIcon({
        className: "",
        html: `<div style="font-size:18px;line-height:1;filter:drop-shadow(0 1px 2px #000)">✂️</div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      }),
    })
      .bindTooltip(
        `Titik potong: ${target[0].toFixed(5)}, ${target[1].toFixed(5)}`,
        { sticky: true },
      )
      .addTo(layer);

    // Navigation path: volunteer -> cut point
    L.polyline(
      [
        [pos.lat, pos.lng],
        [target[0], target[1]],
      ],
      {
        color: "#60a5fa",
        weight: 2,
        dashArray: "4 6",
        opacity: 0.9,
        interactive: false,
      },
    )
      .bindTooltip("Jalur navigasi ke garis potong", { sticky: true })
      .addTo(layer);

    // Fit everything relevant into view
    const bounds = L.latLngBounds([
      [pos.lat, pos.lng],
      [selected.originLat, selected.originLng],
      [target[0], target[1]],
    ]);
    for (const c of fb.coordinates) bounds.extend([c[0], c[1]]);
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 14 });
  }, [incidents, selectedId, position]);

  return <div ref={containerRef} className="h-56 w-full rounded-xl border border-white/10 sm:h-64" />;
}

function smolderingColor(status: HotspotIncident["status"]): string {
  return status === "SUSPECTED_SMOLDERING" || status === "CONFIRMED_SMOLDERING"
    ? "#f97316"
    : "#dc2626";
}

function smolderingClass(status: HotspotIncident["status"]): string | undefined {
  return status === "SUSPECTED_SMOLDERING" || status === "CONFIRMED_SMOLDERING"
    ? "smolder-blink"
    : undefined;
}
