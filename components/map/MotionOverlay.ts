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

/** The selected fire's modeled burn area at each timeline hour (same vertex count per ring). */
export interface MotionSpread {
  lng: number;
  lat: number;
  /** rings[h] = polygon ring at t+h hours, h = 0..12. */
  rings: [number, number][][];
}

export interface MotionScene {
  fires: MotionFire[];
  fresh: { lng: number; lat: number; color: string }[];
  lines: MotionLine[];
  spread?: MotionSpread | null;
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
/** Spread growth loop: grow from now to +12 h, hold, fade. */
const SPREAD_CYCLE_MS = 7000;
const SPREAD_GROW = 0.72;
const SPREAD_HOLD = 0.88;
/** Intro reveal: a scan line crosses the screen west to east and each fire ignites as it passes. */
const REVEAL_SWEEP_MS = 1700;
const REVEAL_POP_MS = 650;
const LOCK_MS = 1300;

/** 0 below `from`, 1 above `to`, smooth in between: layers fade in with zoom instead of popping. */
function band(zoom: number, from: number, to: number): number {
  const x = Math.min(1, Math.max(0, (zoom - from) / (to - from)));
  return x * x * (3 - 2 * x);
}

function easeOutBack(x: number): number {
  const c = 1.70158;
  return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2;
}

function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

/** With the camera still, the pulses and drifting smoke read the same at 30 fps for half the CPU. */
const IDLE_FRAME_MS = 1000 / 30;

interface Pt {
  x: number;
  y: number;
}

/** Screen positions for one camera pose; reused by every frame until the camera moves. */
interface Projected {
  zoom: number;
  bearingRad: number;
  mPerPx: number;
  fires: (Pt & { f: MotionFire; reachPx: number })[];
  fresh: (Pt & { color: string })[];
  lines: { line: MotionLine; pts: Pt[] }[];
  tracks: Pt[][][];
  spread: { origin: Pt; rings: Pt[][] } | null;
}

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
  private projected: Projected | null = null;
  /** Camera pose `projected` was computed for; tiles streaming in repaint the map without moving it. */
  private projectedFor = "";
  private revealAt = 0;
  private lock: { lng: number; lat: number; at: number } | null = null;
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
    this.projected = null;
  }

  /** Ignite the fires on screen in a west-to-east sweep (end of the intro flight). */
  reveal() {
    if (!this.reduced) this.revealAt = performance.now();
  }

  /** Targeting brackets closing on a fire the camera just arrived at. */
  lockOn(lng: number, lat: number) {
    if (!this.reduced) this.lock = { lng, lat, at: performance.now() };
  }

  setSatellites(model: OrbitModel | null, on: boolean) {
    this.orbits = model;
    this.satsOn = on;
    this.satTracksAt = 0;
    this.projected = null;
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
    this.projected = null;
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (document.hidden) return;
    // Idle camera: animate from our own clock; a moving camera is drawn from the map's render event
    const now = performance.now();
    if (!this.map.isMoving() && now - this.lastDraw >= IDLE_FRAME_MS - 2) this.draw(now);
  };

  /** Visible side of the globe only (dot product with the view center). */
  private facing(lng: number, lat: number, cLng: number, cLat: number): boolean {
    if (this.map.getProjection()?.type !== "globe") return true;
    const r = Math.PI / 180;
    const d =
      Math.sin(lat * r) * Math.sin(cLat * r) + Math.cos(lat * r) * Math.cos(cLat * r) * Math.cos((lng - cLng) * r);
    return d > 0.15;
  }

  /**
   * The modeled burn area growing from now to +12 h: hour isochrones are left
   * behind as faint contours, the moving front glows, and the head carries the
   * hour it has reached. Loops: grow, hold on +12 h, fade.
   */
  private drawSpread(sp: { origin: Pt; rings: Pt[][] }, t: number, alpha: number) {
    const { ctx } = this;
    const last = sp.rings.length - 1;
    if (last < 1 || alpha <= 0) return;
    const p = (t % SPREAD_CYCLE_MS) / SPREAD_CYCLE_MS;
    const hour = p < SPREAD_GROW ? last * easeInOutCubic(p / SPREAD_GROW) : last;
    const fade = p < SPREAD_HOLD ? 1 : 1 - (p - SPREAD_HOLD) / (1 - SPREAD_HOLD);
    const a = alpha * fade;
    const lo = Math.floor(hour);
    const hi = Math.min(last, lo + 1);
    const frac = hour - lo;
    const front = sp.rings[lo].map((q, i) => ({
      x: q.x + (sp.rings[hi][i].x - q.x) * frac,
      y: q.y + (sp.rings[hi][i].y - q.y) * frac,
    }));
    const trace = (pts: Pt[]) => {
      ctx.beginPath();
      pts.forEach((q, i) => (i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)));
      ctx.closePath();
    };
    // Isochrones already passed: every 3 hours, faint dashed
    ctx.setLineDash([3, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#fdba74";
    for (let h = 3; h <= lo; h += 3) {
      ctx.globalAlpha = a * 0.35;
      trace(sp.rings[h]);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // Burning area so far, then the front: wide soft stroke under a thin bright one
    ctx.globalAlpha = a * 0.16;
    ctx.fillStyle = "#ef4444";
    trace(front);
    ctx.fill();
    ctx.globalAlpha = a * 0.28;
    ctx.strokeStyle = "#f97316";
    ctx.lineWidth = 7;
    ctx.lineJoin = "round";
    trace(front);
    ctx.stroke();
    ctx.globalAlpha = a;
    ctx.strokeStyle = "#fed7aa";
    ctx.lineWidth = 1.6;
    ctx.stroke();
    // Head of the fire: the front point furthest from the origin
    let head = front[0];
    let best = -1;
    for (const q of front) {
      const d = (q.x - sp.origin.x) ** 2 + (q.y - sp.origin.y) ** 2;
      if (d > best) {
        best = d;
        head = q;
      }
    }
    ctx.fillStyle = "#fff7ed";
    ctx.beginPath();
    ctx.arc(head.x, head.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = this.font;
    const label = `+${Math.round(hour)} j`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(2,6,23,0.85)";
    ctx.strokeText(label, head.x + 7, head.y - 6);
    ctx.fillText(label, head.x + 7, head.y - 6);
    ctx.globalAlpha = 1;
  }

  /** Project everything that only moves with the camera; satellites move on their own and stay per frame. */
  private project(w: number, h: number): Projected {
    const { map } = this;
    const zoom = map.getZoom();
    const c = map.getCenter();
    const onScreen = (p: Pt, pad: number) => p.x > -pad && p.y > -pad && p.x < w + pad && p.y < h + pad;
    const out: Projected = {
      zoom,
      bearingRad: (map.getBearing() * Math.PI) / 180,
      // Meters per CSS pixel at the view center (smoke puff and reach sizing)
      mPerPx: (2 * Math.PI * R_EARTH * Math.cos((c.lat * Math.PI) / 180)) / (512 * 2 ** zoom),
      fires: [],
      fresh: [],
      lines: [],
      tracks: [],
      spread: null,
    };
    for (const f of this.scene.fires) {
      if (!this.facing(f.lng, f.lat, c.lng, c.lat)) continue;
      const p = map.project([f.lng, f.lat]);
      const reachPx = zoom >= 5.5 ? (f.smokeKm * 1000) / out.mPerPx : 0;
      // Kept when its smoke can reach the screen even if the fire itself is just off it
      if (onScreen(p, Math.max(40, reachPx))) out.fires.push({ x: p.x, y: p.y, f, reachPx });
    }
    if (zoom >= 3.5) {
      for (const p of this.scene.fresh) {
        if (out.fresh.length >= FRESH_CAP) break;
        if (!this.facing(p.lng, p.lat, c.lng, c.lat)) continue;
        const s = map.project([p.lng, p.lat]);
        if (onScreen(s, 40)) out.fresh.push({ x: s.x, y: s.y, color: p.color });
      }
    }
    const sp = this.scene.spread;
    if (sp && zoom >= 8.5) {
      out.spread = {
        origin: map.project([sp.lng, sp.lat]),
        rings: sp.rings.map((ring) => ring.map(([lng, lat]) => map.project([lng, lat]))),
      };
    }
    if (zoom >= 6.5) {
      for (const line of this.scene.lines) {
        const pts = line.coords.map(([lng, lat]) => map.project([lng, lat]));
        if (pts.some((p) => onScreen(p, 200))) out.lines.push({ line, pts });
      }
    }
    if (this.satsOn && this.satTracks && zoom < 6.5) {
      // Each track split into runs on the visible side of the globe
      out.tracks = this.satTracks.map((coords) => {
        const runs: Pt[][] = [];
        let run: Pt[] | null = null;
        for (const [lng, lat] of coords) {
          if (!this.facing(lng, lat, c.lng, c.lat)) {
            run = null;
            continue;
          }
          if (!run) runs.push((run = []));
          run.push(map.project([lng, lat]));
        }
        return runs;
      });
    }
    return out;
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

    if (this.satsOn && this.orbits && (!this.satTracks || now - this.satTracksAt > SAT_TRACK_REFRESH_MS)) {
      const orbits = this.orbits;
      this.satTracks = orbits.sats.map((sat) => trackAround(orbits, sat, Date.now()));
      this.satTracksAt = now;
      this.projected = null;
    }
    const c = map.getCenter();
    const pose = `${map.getZoom()}|${c.lng}|${c.lat}|${map.getBearing()}|${map.getPitch()}|${map.getProjection()?.type}|${w}x${h}`;
    if (pose !== this.projectedFor) this.projected = null;
    this.projectedFor = pose;
    const pr = (this.projected ??= this.project(w, h));
    const { zoom } = pr;

    // Intro reveal progress (0 when not revealing)
    const revealE = this.revealAt ? now - this.revealAt : -1;
    if (revealE > REVEAL_SWEEP_MS + REVEAL_POP_MS + 200) this.revealAt = 0;
    /** 0 before the scan line reaches this x, 1 once the fire has fully ignited. */
    const lit = (x: number) =>
      revealE < 0 ? 1 : Math.min(1, Math.max(0, (revealE - (Math.max(0, x) / w) * REVEAL_SWEEP_MS) / REVEAL_POP_MS));

    // ---- spread growth: the selected fire's modeled burn area creeping out to +12 h, hour by hour
    if (pr.spread && !this.reduced) this.drawSpread(pr.spread, t, band(zoom, 8.5, 9.5));

    // ---- smoke drifting downwind (zoom 6+, where a plume is wider than a few pixels)
    const smokeA = band(zoom, 5.5, 6.5);
    if (smokeA > 0) {
      ctx.globalCompositeOperation = "source-over";
      for (const { x: ox, y: oy, f, reachPx } of pr.fires) {
        const b = (f.smokeBearing * Math.PI) / 180;
        // Screen-space bearing (north up, rotated by the camera bearing)
        const rot = b - pr.bearingRad;
        const dx = Math.sin(rot);
        const dy = -Math.cos(rot);
        for (let i = 0; i < SMOKE_PARTICLES; i++) {
          const phase = ((t / SMOKE_PERIOD_MS + i / SMOKE_PARTICLES + seeded(i + f.lng)) % 1 + 1) % 1;
          const along = phase * reachPx;
          const spread = (seeded(i * 7 + f.lat) - 0.5) * 0.6 * along;
          const x = ox + dx * along - dy * spread;
          const y = oy + dy * along + dx * spread;
          const size = 10 + phase * Math.min(90, reachPx * 0.35);
          ctx.globalAlpha = smokeA * lit(ox) * 0.5 * Math.sin(Math.PI * phase) * (f.selected ? 1 : 0.7);
          ctx.drawImage(this.smokeSprite, x - size / 2, y - size / 2, size, size);
        }
      }
      ctx.globalAlpha = 1;
    }

    // ---- flowing lines: firebreak, evacuation, wind push
    const lineA = band(zoom, 6.5, 7.5);
    if (pr.lines.length > 0 && lineA > 0) {
      ctx.lineCap = "round";
      for (const { line, pts } of pr.lines) {
        const s = LINE_STYLE[line.kind];
        ctx.beginPath();
        pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.setLineDash(s.dash);
        ctx.lineDashOffset = -(t / 1000) * s.speed;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width;
        ctx.globalAlpha = lineA * (line.kind === "wind" ? 0.85 : 1);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // ---- fresh detections ripple (last 3 h), capped to what is on screen
    const freshA = band(zoom, 3.5, 4.5);
    if (pr.fresh.length > 0 && freshA > 0) {
      const phase = ((t + PULSE_MS / 2) % PULSE_MS) / PULSE_MS;
      ctx.lineWidth = 1.5;
      const r = 3 + phase * 11;
      if (revealE >= 0) {
        // During the reveal each ring waits for the scan line
        for (const p of pr.fresh) {
          const k = lit(p.x);
          if (k <= 0) continue;
          ctx.globalAlpha = freshA * k * 0.75 * (1 - phase);
          ctx.strokeStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else {
        // Every ring shares one phase, so one path per color draws them all
        ctx.globalAlpha = freshA * 0.75 * (1 - phase);
        const byColor = new Map<string, Path2D>();
        for (const p of pr.fresh) {
          let path = byColor.get(p.color);
          if (!path) byColor.set(p.color, (path = new Path2D()));
          path.moveTo(p.x + r, p.y);
          path.arc(p.x, p.y, r, 0, Math.PI * 2);
        }
        for (const [color, path] of byColor) {
          ctx.strokeStyle = color;
          ctx.stroke(path);
        }
      }
      ctx.globalAlpha = 1;
    }

    // ---- simulated fires: expanding pulse + flickering ember glow
    ctx.globalCompositeOperation = "lighter";
    for (const { x, y, f } of pr.fires) {
      if (x < -40 || y < -40 || x > w + 40 || y > h + 40) continue;
      const base = 5 + Math.min(f.frp, 100) / 14;
      // Uneven flicker: two incommensurate sines read as fire, one reads as a metronome
      const flicker = 0.75 + 0.15 * Math.sin(t / 110 + f.lng * 31) + 0.1 * Math.sin(t / 47 + f.lat * 17);
      const k = lit(x);
      if (k <= 0) continue;
      // Glow grows smoothly with zoom instead of jumping at one level
      const glow =
        base * (2.6 + 1.6 * band(zoom, 6, 7.5)) * (f.active ? flicker : 0.8 + 0.2 * Math.sin(t / 900 + f.lng)) * (k < 1 ? easeOutBack(k) : 1);
      ctx.globalAlpha = (f.active ? 0.55 : 0.35) * Math.min(1, k * 1.5);
      ctx.drawImage(this.emberSprite, x - glow / 2, y - glow / 2, glow, glow);
    }
    ctx.globalCompositeOperation = "source-over";
    // Ignition flash: one bright ring per fire as the reveal's scan line passes it
    if (revealE >= 0) {
      ctx.lineWidth = 2;
      for (const { x, y, f } of pr.fires) {
        const k = lit(x);
        if (k <= 0 || k >= 1) continue;
        ctx.globalAlpha = 0.9 * (1 - k);
        ctx.strokeStyle = f.color;
        ctx.beginPath();
        ctx.arc(x, y, 4 + 34 * k, 0, Math.PI * 2);
        ctx.stroke();
      }
      // The scan line itself: a soft amber band moving west to east
      if (revealE < REVEAL_SWEEP_MS) {
        const sx = (revealE / REVEAL_SWEEP_MS) * w;
        const g = ctx.createLinearGradient(sx - 90, 0, sx + 6, 0);
        g.addColorStop(0, "rgba(251,146,60,0)");
        g.addColorStop(0.85, "rgba(251,146,60,0.16)");
        g.addColorStop(1, "rgba(254,215,170,0.55)");
        ctx.globalAlpha = 1;
        ctx.fillStyle = g;
        ctx.fillRect(sx - 90, 0, 96, h);
      }
      ctx.globalAlpha = 1;
    }
    const ringA = band(zoom, 4.5, 5.5);
    if (ringA > 0) {
      for (const { x, y, f } of pr.fires) {
        if (!f.active || x < -40 || y < -40 || x > w + 40 || y > h + 40) continue;
        const base = 5 + Math.min(f.frp, 100) / 14;
        for (const offset of f.selected ? [0, 0.5] : [0]) {
          const phase = ((t / PULSE_MS + offset + seeded(f.lng)) % 1 + 1) % 1;
          ctx.globalAlpha = ringA * lit(x) * (f.selected ? 0.8 : 0.5) * (1 - phase);
          ctx.strokeStyle = f.color;
          ctx.lineWidth = f.selected ? 2.5 : 1.5;
          ctx.beginPath();
          ctx.arc(x, y, base + phase * (f.selected ? 26 : 16), 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }

    // ---- lock-on brackets after a fly-to
    if (this.lock) {
      const e = (now - this.lock.at) / LOCK_MS;
      if (e >= 1) this.lock = null;
      else {
        const p = map.project([this.lock.lng, this.lock.lat]);
        const close = easeInOutCubic(Math.min(1, e / 0.55));
        const half = 64 - 40 * close;
        const arm = 10;
        const rot = (1 - close) * (Math.PI / 4);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(rot);
        ctx.globalAlpha = e < 0.7 ? Math.min(1, e * 6) : (1 - e) / 0.3;
        ctx.strokeStyle = "#fde68a";
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
          ctx.moveTo(sx * half, sy * (half - arm));
          ctx.lineTo(sx * half, sy * half);
          ctx.lineTo(sx * (half - arm), sy * half);
        }
        ctx.stroke();
        ctx.restore();
        // Ping once the brackets have closed
        if (e > 0.5) {
          const q = (e - 0.5) / 0.5;
          ctx.globalAlpha = 0.8 * (1 - q);
          ctx.strokeStyle = "#fde68a";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 18 + 40 * q, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }

    // ---- FIRMS satellites from space distance: live position, flowing ground track, name
    if (this.satsOn && this.orbits && zoom < 6.5) {
      const at = Date.now();
      const orbits = this.orbits;
      const fade = Math.min(1, Math.max(0, (6.5 - zoom) / 1.5));
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 5]);
      ctx.lineDashOffset = -(t / 1000) * 12;
      ctx.strokeStyle = `rgba(226,232,240,${0.5 * fade})`;
      for (const runs of pr.tracks) {
        ctx.beginPath();
        for (const run of runs) run.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.font = this.font;
      const g = map.project(INDONESIA);
      // Interpolated every frame between 20 s server samples, so the dots glide rather than tick
      for (const sat of orbits.sats) {
        const pos = positionAt(orbits, sat, at);
        if (!pos) continue;
        const { lng, lat } = pos;
        if (!this.facing(lng, lat, c.lng, c.lat)) continue;
        const p = map.project([lng, lat]);
        // In range of Indonesia: an animated beam with packets running down to the islands
        if (groundKm(lng, lat, INDONESIA[0], INDONESIA[1]) < BEAM_RANGE_KM) {
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
