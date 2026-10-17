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

/** Stagger between markers as the layer appears (most severe first) and disappears. */
const IN_STEP_MS = 45;
const IN_MAX_MS = 1100;
const OUT_STEP_MS = 22;
const OUT_MAX_MS = 500;
const OUT_MS = 320;

interface Entry {
  marker: maplibregl.Marker;
  anchor: HTMLDivElement;
  event: CrisisEvent;
  hideTimer: number;
}

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Keeps one DOM marker per crisis event (they are few: tens, not thousands),
 * reusing markers across refreshes so nothing flickers when the feed updates.
 * Showing the layer pops markers in one after another, most severe first, each
 * with a burst ring in its severity color; hiding shrinks them out in reverse.
 */
export class CrisisMarkers {
  private entries = new Map<string, Entry>();
  private visible = false;
  private onKey = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape") return;
    for (const { marker } of this.entries.values()) if (marker.getPopup()?.isOpen()) marker.togglePopup();
  };
  constructor(private map: maplibregl.Map) {
    window.addEventListener("keydown", this.onKey);
  }

  /** Most severe first, then west to east, so the sequence reads across the archipelago. */
  private ordered(list: Entry[]): Entry[] {
    return [...list].sort((a, b) => b.event.severity - a.event.severity || a.event.lng - b.event.lng);
  }

  private animateIn(list: Entry[]) {
    const reduced = reducedMotion();
    this.ordered(list).forEach((e, i) => {
      window.clearTimeout(e.hideTimer);
      e.anchor.classList.remove("gw-out", "gw-in");
      if (!e.marker.getElement().isConnected) e.marker.addTo(this.map);
      if (reduced) return;
      // Restart the keyframes even if the marker was mid-exit
      void e.anchor.offsetWidth;
      e.anchor.style.setProperty("--d", `${Math.min(IN_MAX_MS, i * IN_STEP_MS)}ms`);
      e.anchor.classList.add("gw-in");
    });
  }

  private animateOut(list: Entry[], after?: (e: Entry) => void) {
    const reduced = reducedMotion();
    this.ordered(list)
      .reverse()
      .forEach((e, i) => {
        const delay = reduced ? 0 : Math.min(OUT_MAX_MS, i * OUT_STEP_MS);
        e.marker.getPopup()?.remove();
        e.anchor.classList.remove("gw-in");
        e.anchor.style.setProperty("--d", `${delay}ms`);
        e.anchor.classList.add("gw-out");
        window.clearTimeout(e.hideTimer);
        e.hideTimer = window.setTimeout(
          () => {
            e.marker.remove();
            e.anchor.classList.remove("gw-out");
            after?.(e);
          },
          reduced ? 0 : delay + OUT_MS,
        );
      });
  }

  update(events: CrisisEvent[]) {
    const keep = new Set<string>();
    const added: Entry[] = [];
    // Several news crises share a province capital; fan them out around it so each stays clickable
    const perSpot = new Map<string, number>();
    for (const e of events) {
      keep.add(e.id);
      const spot = `${e.lat.toFixed(2)},${e.lng.toFixed(2)}`;
      const n = perSpot.get(spot) ?? 0;
      perSpot.set(spot, n + 1);
      const angle = n * 2.4;
      const offset: [number, number] = n === 0 ? [0, 0] : [Math.cos(angle) * 26 * Math.sqrt(n), Math.sin(angle) * 26 * Math.sqrt(n)];
      const existing = this.entries.get(e.id);
      if (existing) {
        existing.event = e;
        existing.marker.setOffset(offset);
        existing.marker.getPopup()?.setHTML(popupHtml(e));
        continue;
      }
      // MapLibre positions the marker element with an inline transform, so the
      // animated, hoverable disc is a child of it, never the element itself
      const anchor = document.createElement("div");
      anchor.className = "gw-crisis-anchor";
      anchor.style.setProperty("--ring", SEVERITY_COLOR[e.severity]);
      const el = document.createElement("button");
      el.type = "button";
      el.className = `gw-crisis gw-crisis-s${e.severity}`;
      el.innerHTML = iconSvg(e.kind);
      el.setAttribute("aria-label", `${CRISIS_LABEL[e.kind].id}, ${e.province}: ${e.title}`);
      anchor.appendChild(el);
      // Hover scaling needs the entrance keyframes gone once they have played
      el.addEventListener("animationend", (ev) => {
        if (ev.animationName === "gw-crisis-in") anchor.classList.remove("gw-in");
      });
      const marker = new maplibregl.Marker({ element: anchor, offset })
        .setLngLat([e.lng, e.lat])
        .setPopup(new maplibregl.Popup({ offset: 18, maxWidth: "300px", closeButton: true }).setHTML(popupHtml(e)));
      // MapLibre opens a marker popup from map clicks only; Enter/Space on the focused button must work too
      el.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          marker.togglePopup();
        }
      });
      const entry: Entry = { marker, anchor, event: e, hideTimer: 0 };
      this.entries.set(e.id, entry);
      added.push(entry);
    }
    if (this.visible && added.length > 0) this.animateIn(added);
    const gone = [...this.entries.entries()].filter(([id]) => !keep.has(id));
    for (const [id] of gone) this.entries.delete(id);
    if (gone.length > 0) this.animateOut(gone.map(([, e]) => e));
  }

  setVisible(visible: boolean) {
    if (visible === this.visible) return;
    this.visible = visible;
    const all = [...this.entries.values()];
    if (visible) this.animateIn(all);
    else this.animateOut(all);
  }

  destroy() {
    window.removeEventListener("keydown", this.onKey);
    for (const e of this.entries.values()) {
      window.clearTimeout(e.hideTimer);
      e.marker.remove();
    }
    this.entries.clear();
  }
}
