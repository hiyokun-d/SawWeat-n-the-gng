"use client";

import type * as maplibregl from "maplibre-gl";
import { positionAt, trackAround, type OrbitModel } from "@/lib/orbits";

/**
 * All map motion in one 2D canvas above the WebGL map.
 *
 * Animating MapLibre paint properties forces the whole map (tens of thousands
 * of fire points, heatmaps, buildings) to redraw on every change. Here the map
 * stays static and only redraws when the camera moves; this canvas draws the
 * few hundred moving things at display rate: fire pulses and embers, smoke
 * drifting downwind, marching firebreak dashes, flowing evacuation and wind
 * arrows, and the FIRMS satellites gliding along their ground tracks.
 */

export interface MotionFire {
  lng: number;
  lat: number;
  color: string;
  /** Flaming or unverified: pulses; smoldering: slow ember glow only. */
  active: boolean;
  selected: boolean;
  frp: number;
  /** Smoke direction (where the wind pushes, degrees) and reach in km. */
  smokeBearing: number;
  smokeKm: number;
}

export interface MotionLine {
  coords: [number, number][];
  kind: "firebreak" | "evac" | "wind";
}

export interface MotionScene {
  fires: MotionFire[];
  fresh: { lng: number; lat: number; color: string }[];
  lines: MotionLine[];
}

const LINE_STYLE: Record<MotionLine["kind"], { color: string; width: number; dash: [number, number]; speed: number }> = {
  firebreak: { color: "#fde047", width: 3, dash: [10, 8], speed: 22 },
  evac: { color: "#6ee7b7", width: 2.5, dash: [6, 7], speed: 30 },
  wind: { color: "#7dd3fc", width: 2, dash: [5, 9], speed: 40 },
};

const PULSE_MS = 2600;
const SMOKE_PARTICLES = 9;
const SMOKE_PERIOD_MS = 9000;
const FRESH_CAP = 700;
const SAT_TRACK_REFRESH_MS = 20_000;
const R_EARTH = 6_371_008.8;
/** Center of Indonesia, where satellite downlink beams point. */
const INDONESIA: [number, number] = [117.5, -2.5];
/** A satellite this close (ground distance) has Indonesia inside or near its swath. */
const BEAM_RANGE_KM = 3200;

function groundKm(aLng: number, aLat: number, bLng: number, bLat: number) {
  const r = Math.PI / 180;
  const h =
    Math.sin(((bLat - aLat) * r) / 2) ** 2 +
    Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLng - aLng) * r) / 2) ** 2;
  return (2 * R_EARTH * Math.asin(Math.sqrt(h))) / 1000;
}

function seeded(i: number) {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** Soft round sprite, pre-rendered once, for smoke puffs and ember glow (drawImage is far cheaper than gradients per puff). */
function sprite(color: string, size = 64): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, color);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

export class MotionOverlay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private scene: MotionScene = { fires: [], fresh: [], lines: [] };
  private orbits: OrbitModel | null = null;
  private satsOn = false;
  private satTracks: [number, number][][] | null = null;
  private satTracksAt = 0;
  private raf = 0;
  private lastDraw = 0;
  private dpr = 1;
  private reduced: boolean;
  private smokeSprite: HTMLCanvasElement;
  private emberSprite: HTMLCanvasElement;
  private font = "600 11px system-ui, sans-serif";
  private onRender = () => this.draw(performance.now());
  private onResize = () => this.resize();

  constructor(private map: maplibregl.Map) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "gw-motion";
    this.canvas.setAttribute("aria-hidden", "true");
    Object.assign(this.canvas.style, { position: "absolute", inset: "0", pointerEvents: "none" });
    // Right above the GL canvas, below DOM markers (crises) so those stay clickable on top
    const gl = map.getCanvas();
    gl.parentElement!.insertBefore(this.canvas, gl.nextSibling);
    this.ctx = this.canvas.getContext("2d")!;
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.smokeSprite = sprite("rgba(226,232,240,0.55)");
    this.emberSprite = sprite("rgba(255,170,60,0.9)");
    // Canvas cannot read CSS variables: resolve the app font once
    const family = getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim();
    if (family) this.font = `600 11px ${family}, system-ui, sans-serif`;
    this.resize();
    // While the camera moves, draw inside the map's own frame so overlay and map never drift apart
    map.on("render", this.onRender);
    map.on("resize", this.onResize);
    this.loop();
  }

  setScene(scene: MotionScene) {
    this.scene = scene;
  }

  setSatellites(model: OrbitModel | null, on: boolean) {
    this.orbits = model;
    this.satsOn = on;
    this.satTracksAt = 0;
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.map.off("render", this.onRender);
    this.map.off("resize", this.onResize);
    this.canvas.remove();
  }

  private resize() {
    const gl = this.map.getCanvas();
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.canvas.width = Math.round(gl.clientWidth * this.dpr);
    this.canvas.height = Math.round(gl.clientHeight * this.dpr);
    this.canvas.style.width = `${gl.clientWidth}px`;
    this.canvas.style.height = `${gl.clientHeight}px`;
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (document.hidden) return;
    // Idle camera: animate from our own clock; a moving camera is drawn from the map's render event
    if (!this.map.isMoving()) this.draw(performance.now());
  };

  /** Visible side of the globe only (dot product with the view center). */
  private facing(lng: number, lat: number, cLng: number, cLat: number): boolean {
    if (this.map.getProjection()?.type !== "globe") return true;
    const r = Math.PI / 180;
    const d =
      Math.sin(lat * r) * Math.sin(cLat * r) + Math.cos(lat * r) * Math.cos(cLat * r) * Math.cos((lng - cLng) * r);
    return d > 0.15;
  }

  private draw(now: number) {
    // One draw per display frame even when both the map event and our loop fire
    if (now - this.lastDraw < 6) return;
    this.lastDraw = now;
    const t = this.reduced ? 0 : now;
    const { ctx, map } = this;
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const zoom = map.getZoom();
    const c = map.getCenter();
    const onScreen = (x: number, y: number, pad = 40) => x > -pad && y > -pad && x < w + pad && y < h + pad;
    // Meters per CSS pixel at the view center (smoke puff and reach sizing)
    const mPerPx = (2 * Math.PI * R_EARTH * Math.cos((c.lat * Math.PI) / 180)) / (512 * 2 ** zoom);

    // ---- smoke drifting downwind (zoom 6+, where a plume is wider than a few pixels)
    if (zoom >= 6) {
      ctx.globalCompositeOperation = "source-over";
      for (const f of this.scene.fires) {
        if (!this.facing(f.lng, f.lat, c.lng, c.lat)) continue;
        const o = map.project([f.lng, f.lat]);
        const reachPx = (f.smokeKm * 1000) / mPerPx;
        if (!onScreen(o.x, o.y, reachPx)) continue;
        const b = (f.smokeBearing * Math.PI) / 180;
        // Screen-space bearing (north up, rotated by the camera bearing)
        const rot = b - (map.getBearing() * Math.PI) / 180;
        const dx = Math.sin(rot);
        const dy = -Math.cos(rot);
        for (let i = 0; i < SMOKE_PARTICLES; i++) {
          const phase = ((t / SMOKE_PERIOD_MS + i / SMOKE_PARTICLES + seeded(i + f.lng)) % 1 + 1) % 1;
          const along = phase * reachPx;
          const spread = (seeded(i * 7 + f.lat) - 0.5) * 0.6 * along;
          const x = o.x + dx * along - dy * spread;
          const y = o.y + dy * along + dx * spread;
          const size = 10 + phase * Math.min(90, reachPx * 0.35);
          ctx.globalAlpha = 0.5 * Math.sin(Math.PI * phase) * (f.selected ? 1 : 0.7);
          ctx.drawImage(this.smokeSprite, x - size / 2, y - size / 2, size, size);
        }
      }
      ctx.globalAlpha = 1;
    }

    // ---- flowing lines: firebreak, evacuation, wind push
    if (zoom >= 7) {
      ctx.lineCap = "round";
      for (const line of this.scene.lines) {
        const s = LINE_STYLE[line.kind];
        ctx.beginPath();
        let visible = false;
        line.coords.forEach(([lng, lat], i) => {
          const p = map.project([lng, lat]);
          if (onScreen(p.x, p.y, 200)) visible = true;
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        if (!visible) continue;
        ctx.setLineDash(s.dash);
        ctx.lineDashOffset = -(t / 1000) * s.speed;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width;
        ctx.globalAlpha = line.kind === "wind" ? 0.85 : 1;
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // ---- fresh detections ripple (last 3 h), capped to what is on screen
    if (zoom >= 4) {
      const phase = ((t + PULSE_MS / 2) % PULSE_MS) / PULSE_MS;
      ctx.lineWidth = 1.5;
      let drawn = 0;
      for (const p of this.scene.fresh) {
        if (drawn >= FRESH_CAP) break;
        if (!this.facing(p.lng, p.lat, c.lng, c.lat)) continue;
        const s = map.project([p.lng, p.lat]);
        if (!onScreen(s.x, s.y)) continue;
        drawn++;
        ctx.globalAlpha = 0.75 * (1 - phase);
        ctx.strokeStyle = p.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 3 + phase * 11, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // ---- simulated fires: expanding pulse + flickering ember glow
    ctx.globalCompositeOperation = "lighter";
    for (const f of this.scene.fires) {
      if (!this.facing(f.lng, f.lat, c.lng, c.lat)) continue;
      const s = map.project([f.lng, f.lat]);
      if (!onScreen(s.x, s.y)) continue;
      const base = 5 + Math.min(f.frp, 100) / 14;
      // Uneven flicker: two incommensurate sines read as fire, one reads as a metronome
      const flicker = 0.75 + 0.15 * Math.sin(t / 110 + f.lng * 31) + 0.1 * Math.sin(t / 47 + f.lat * 17);
      const glow = base * (zoom >= 7 ? 4.2 : 2.6) * (f.active ? flicker : 0.8 + 0.2 * Math.sin(t / 900 + f.lng));
      ctx.globalAlpha = f.active ? 0.55 : 0.35;
      ctx.drawImage(this.emberSprite, s.x - glow / 2, s.y - glow / 2, glow, glow);
    }
    ctx.globalCompositeOperation = "source-over";
    if (zoom >= 5) {
      for (const f of this.scene.fires) {
        if (!f.active) continue;
        const s = map.project([f.lng, f.lat]);
        if (!onScreen(s.x, s.y) || !this.facing(f.lng, f.lat, c.lng, c.lat)) continue;
        const base = 5 + Math.min(f.frp, 100) / 14;
        for (const offset of f.selected ? [0, 0.5] : [0]) {
          const phase = ((t / PULSE_MS + offset + seeded(f.lng)) % 1 + 1) % 1;
          ctx.globalAlpha = (f.selected ? 0.8 : 0.5) * (1 - phase);
          ctx.strokeStyle = f.color;
          ctx.lineWidth = f.selected ? 2.5 : 1.5;
          ctx.beginPath();
          ctx.arc(s.x, s.y, base + phase * (f.selected ? 26 : 16), 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }

    // ---- FIRMS satellites from space distance: live position, flowing ground track, name
    if (this.satsOn && this.orbits && zoom < 6.5) {
      const at = Date.now();
      const orbits = this.orbits;
      if (!this.satTracks || now - this.satTracksAt > SAT_TRACK_REFRESH_MS) {
        this.satTracks = orbits.sats.map((sat) => trackAround(orbits, sat, at));
        this.satTracksAt = now;
      }
      const fade = Math.min(1, Math.max(0, (6.5 - zoom) / 1.5));
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 5]);
      ctx.lineDashOffset = -(t / 1000) * 12;
      for (const coords of this.satTracks) {
        ctx.beginPath();
        let pen = false;
        for (const [lng, lat] of coords) {
          if (!this.facing(lng, lat, c.lng, c.lat)) {
            pen = false;
            continue;
          }
          const p = map.project([lng, lat]);
          if (pen) ctx.lineTo(p.x, p.y);
          else ctx.moveTo(p.x, p.y);
          pen = true;
        }
        ctx.strokeStyle = `rgba(226,232,240,${0.5 * fade})`;
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.font = this.font;
      // Interpolated every frame between 20 s server samples, so the dots glide rather than tick
      for (const sat of orbits.sats) {
        const pos = positionAt(orbits, sat, at);
        if (!pos) continue;
        const { lng, lat } = pos;
        if (!this.facing(lng, lat, c.lng, c.lat)) continue;
        const p = map.project([lng, lat]);
        // In range of Indonesia: an animated beam with packets running down to the islands
        if (groundKm(lng, lat, INDONESIA[0], INDONESIA[1]) < BEAM_RANGE_KM) {
          const g = map.project(INDONESIA);
          ctx.globalAlpha = fade * 0.75;
          ctx.strokeStyle = "#fde68a";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([2, 6]);
          ctx.lineDashOffset = -(t / 1000) * 40;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(g.x, g.y);
          ctx.stroke();
          ctx.setLineDash([]);
          for (let k = 0; k < 3; k++) {
            const f = ((t / 1400 + k / 3) % 1 + 1) % 1;
            ctx.fillStyle = "#fef3c7";
            ctx.beginPath();
            ctx.arc(p.x + (g.x - p.x) * f, p.y + (g.y - p.y) * f, 2.2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        const pulse = ((t / 1800) % 1 + 1) % 1;
        ctx.globalAlpha = fade * 0.5 * (1 - pulse);
        ctx.strokeStyle = "#e2e8f0";
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5 + pulse * 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = fade;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(241,245,249,0.92)";
        ctx.fillText(sat.name, p.x + 9, p.y + 4);
      }
      ctx.globalAlpha = 1;
    }
  }
}
