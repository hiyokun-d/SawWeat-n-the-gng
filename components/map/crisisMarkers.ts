"use client";

import * as maplibregl from "maplibre-gl";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ActivityIcon,
  BiohazardIcon,
  CloudFogIcon,
  DropletOffIcon,
  FuelIcon,
  MountainIcon,
  TornadoIcon,
  WavesIcon,
  WheatIcon,
  ZapOffIcon,
} from "lucide-react";
import { CRISIS_LABEL, SEVERITY_COLOR, SEVERITY_LABEL, type CrisisEvent, type CrisisKind } from "@/lib/crises";

// Each glyph names the hazard itself (pump, water, seismograph, peak...) so the kind reads without a legend
export const CRISIS_ICON: Record<CrisisKind, ComponentType<{ className?: string; strokeWidth?: number }>> = {
  fuel: FuelIcon,
  flood: WavesIcon,
  quake: ActivityIcon,
  volcano: MountainIcon,
  drought: DropletOffIcon,
  haze: CloudFogIcon,
  food: WheatIcon,
  power: ZapOffIcon,
  outbreak: BiohazardIcon,
  cyclone: TornadoIcon,
};

const svgCache = new Map<CrisisKind, string>();
function iconSvg(kind: CrisisKind): string {
  let svg = svgCache.get(kind);
  if (!svg) {
    svg = renderToStaticMarkup(createElement(CRISIS_ICON[kind], { strokeWidth: 2.2 }));
    svgCache.set(kind, svg);
  }
  return svg;
}

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function popupHtml(e: CrisisEvent): string {
  const label = CRISIS_LABEL[e.kind];
  const sev = SEVERITY_LABEL[e.severity];
  const when = new Date(e.at).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const basis =
    e.basis === "official"
      ? `<span class="gw-pop-basis gw-pop-official">Data resmi · ${esc(e.source)}</span>`
      : `<span class="gw-pop-basis">Dilaporkan media · ${esc(e.source)}</span>`;
  const more = e.articles
    .slice(1, 4)
    .map((a) => `<li><a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.title)}</a> <span>${esc(a.source)}</span></li>`)
    .join("");
  return `<div class="gw-pop">
    <p class="gw-pop-kind" style="color:${SEVERITY_COLOR[e.severity]}">${esc(label.en)} · ${esc(sev.en)}</p>
    <p class="gw-pop-sub">${esc(label.id)}, ${esc(e.province)} · ${esc(when)}</p>
    <p class="gw-pop-title">${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(e.title)}</a>` : esc(e.title)}</p>
    ${e.detail ? `<p class="gw-pop-sub">${esc(e.detail)}</p>` : ""}
    ${more ? `<ul class="gw-pop-more">${more}</ul>` : ""}
    ${basis}
  </div>`;
}

/**
 * Keeps one DOM marker per crisis event (they are few: tens, not thousands),
 * reusing markers across refreshes so nothing flickers when the feed updates.
 */
export class CrisisMarkers {
  private markers = new Map<string, maplibregl.Marker>();
  private visible = true;
  private onKey = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape") return;
    for (const m of this.markers.values()) if (m.getPopup()?.isOpen()) m.togglePopup();
  };
  constructor(private map: maplibregl.Map) {
    window.addEventListener("keydown", this.onKey);
  }

  update(events: CrisisEvent[]) {
    const keep = new Set<string>();
    // Several news crises share a province capital; fan them out around it so each stays clickable
    const perSpot = new Map<string, number>();
    for (const e of events) {
      keep.add(e.id);
      const spot = `${e.lat.toFixed(2)},${e.lng.toFixed(2)}`;
      const n = perSpot.get(spot) ?? 0;
      perSpot.set(spot, n + 1);
      const angle = n * 2.4;
      const offset: [number, number] = n === 0 ? [0, 0] : [Math.cos(angle) * 26 * Math.sqrt(n), Math.sin(angle) * 26 * Math.sqrt(n)];
      let m = this.markers.get(e.id);
      if (!m) {
        const el = document.createElement("button");
        el.type = "button";
        el.className = `gw-crisis gw-crisis-s${e.severity}`;
        el.style.setProperty("--ring", SEVERITY_COLOR[e.severity]);
        el.innerHTML = iconSvg(e.kind);
        el.setAttribute("aria-label", `${CRISIS_LABEL[e.kind].id}, ${e.province}: ${e.title}`);
        m = new maplibregl.Marker({ element: el, offset })
          .setLngLat([e.lng, e.lat])
          .setPopup(new maplibregl.Popup({ offset: 18, maxWidth: "300px", closeButton: true }).setHTML(popupHtml(e)));
        // MapLibre opens a marker popup from map clicks only; Enter/Space on the focused button must work too
        const marker = m;
        el.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            marker.togglePopup();
          }
        });
        if (this.visible) m.addTo(this.map);
        this.markers.set(e.id, m);
      } else {
        m.setOffset(offset);
        m.getPopup()?.setHTML(popupHtml(e));
      }
    }
    for (const [id, m] of this.markers) {
      if (!keep.has(id)) {
        m.remove();
        this.markers.delete(id);
      }
    }
  }

  setVisible(visible: boolean) {
    if (visible === this.visible) return;
    this.visible = visible;
    for (const m of this.markers.values()) {
      if (visible) m.addTo(this.map);
      else m.remove();
    }
  }

  destroy() {
    window.removeEventListener("keydown", this.onKey);
    for (const m of this.markers.values()) m.remove();
    this.markers.clear();
  }
}
