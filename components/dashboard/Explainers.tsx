"use client";

import { motion } from "motion/react";
import { useEffect, useId, useState } from "react";
import { moistureRetardation, spreadRateAt } from "@/lib/simulationEngine";

/**
 * Animated explainers for the full briefing. Each one is a small diagram
 * that teaches one mechanism, drawn from live numbers: how a satellite turns
 * pixels into fires, why peat hides fire underground, how the wind shapes
 * the spread, how far the air is past the WHO limit, and what holding the
 * line costs. Motion shows process (things moving, filling, being drawn),
 * never decoration.
 */

const EASE = [0.2, 0.8, 0.2, 1] as const;
const en = (n: number, d = 0) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

function Count({ value, ms = 1400, digits = 0, delay = 0 }: { value: number; ms?: number; digits?: number; delay?: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now() + delay;
    const tick = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - start) / ms));
      setV(value * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms, delay]);
  return <>{en(v, digits)}</>;
}

/* ------------------------------------------------------------------ 1. orbit to fire */

export function OrbitFunnel({
  pixels,
  events,
  indonesia,
  burning,
  hidden,
  portrait,
}: {
  pixels: number;
  events: number;
  indonesia: number;
  burning: number;
  hidden: number;
  portrait: boolean;
}) {
  const id = useId();
  const rows = [
    { en: "satellite pixels hot enough", id: "piksel panas dari satelit", n: pixels, color: "#94a3b8" },
    { en: "fused into fire events", id: "digabung jadi kejadian api", n: events, color: "#fdba74" },
    { en: "inside Indonesia", id: "di Indonesia", n: indonesia, color: "#fb923c" },
    { en: "smoldering out of sight", id: "membara tak terlihat", n: hidden, color: "#ea580c" },
    { en: "burning or unverified", id: "menyala / belum diverifikasi", n: burning, color: "#ef4444" },
  ];
  // Square-root widths: the real counts span two orders of magnitude, linear bars would hide the last rows
  const max = Math.sqrt(Math.max(1, pixels));
  return (
    <div>
      <svg viewBox="0 0 360 120" className="w-full" aria-hidden>
        <defs>
          <linearGradient id={`${id}-beam`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fde68a" stopOpacity="0.55" />
            <stop offset="1" stopColor="#fde68a" stopOpacity="0" />
          </linearGradient>
          <radialGradient id={`${id}-earth`} cx="0.5" cy="1" r="1">
            <stop offset="0" stopColor="#1e3a5f" />
            <stop offset="1" stopColor="#0b1220" />
          </radialGradient>
        </defs>
        <path d="M-20 130 Q180 40 380 130 Z" fill={`url(#${id}-earth)`} />
        <path d="M-20 130 Q180 40 380 130" fill="none" stroke="#38bdf8" strokeOpacity="0.35" />
        <path id={`${id}-orbit`} d="M-10 70 Q180 -30 370 70" fill="none" stroke="#e2e8f0" strokeOpacity="0.35" strokeDasharray="3 5" />
        {/* The swath sweeps the ground as the satellite passes: what one overpass sees */}
        <g>
          <polygon points="0,0 -26,52 26,52" fill={`url(#${id}-beam)`} />
          <circle r="4" fill="#fff" />
          <rect x="-11" y="-2" width="7" height="4" fill="#93c5fd" />
          <rect x="4" y="-2" width="7" height="4" fill="#93c5fd" />
          <animateMotion dur="6s" repeatCount="indefinite" rotate="0">
            <mpath href={`#${id}-orbit`} />
          </animateMotion>
        </g>
        {[60, 110, 150, 205, 240, 290].map((x) => (
          <motion.circle
            key={x}
            cx={x}
            cy={100 - Math.sin((x / 360) * Math.PI) * 30}
            r="3"
            fill="#f97316"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: [0, 1, 0.6], scale: [0, 1.6, 1] }}
            transition={{ delay: 0.6 + (x / 360) * 5.5, duration: 0.8, repeat: Infinity, repeatDelay: 5.2 }}
          />
        ))}
      </svg>
      <ul className="mt-2 space-y-1.5">
        {rows.map((r, i) => (
          <li key={r.en}>
            <div className={`flex items-baseline justify-between gap-3 ${portrait ? "text-base" : "text-xs"}`}>
              <span className="text-slate-200">
                {r.en} <span className="text-slate-400">· {r.id}</span>
              </span>
              <span className="font-semibold tabular-nums text-white">
                <Count value={r.n} delay={300 + i * 220} />
              </span>
            </div>
            <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-white/10">
              <motion.div
                className="h-full rounded-full"
                style={{ background: r.color }}
                initial={{ width: 0 }}
                animate={{ width: `${(Math.sqrt(r.n) / max) * 100}%` }}
                transition={{ delay: 0.3 + i * 0.22, duration: 1, ease: EASE }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ 2. peat cross-section */

/** Base spread rate R0 per peat depth class, m/h: the values the app's spread model uses. */
const PEAT_R0 = [
  { en: "shallow < 1 m", id: "dangkal", r0: 12, fill: "#5b3a1e" },
  { en: "medium 1-3 m", id: "sedang", r0: 18, fill: "#47290f" },
  { en: "deep > 3 m", id: "dalam", r0: 28, fill: "#2f1a08" },
];

export function PeatSection({ burning, hidden, portrait }: { burning: number; hidden: number; portrait: boolean }) {
  const id = useId();
  return (
    <div>
      <svg viewBox="0 0 360 210" className="w-full" role="img" aria-label="Penampang gambut: api permukaan dan bara di bawah tanah">
        <defs>
          <radialGradient id={`${id}-ember`}>
            <stop offset="0" stopColor="#fff7ed" />
            <stop offset="0.35" stopColor="#fb923c" />
            <stop offset="1" stopColor="#ea580c" stopOpacity="0" />
          </radialGradient>
          <filter id={`${id}-blur`}>
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>
        {/* Sky, satellite and its line of sight */}
        <rect width="360" height="70" fill="#0b1220" />
        <g transform="translate(300 16)">
          <circle r="4" fill="#fff" />
          <rect x="-12" y="-2" width="8" height="4" fill="#93c5fd" />
          <rect x="4" y="-2" width="8" height="4" fill="#93c5fd" />
        </g>
        <motion.line x1="300" y1="20" x2="90" y2="66" stroke="#fde68a" strokeDasharray="4 4" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, delay: 0.3 }} />
        <motion.line x1="300" y1="20" x2="232" y2="48" stroke="#fde68a" strokeDasharray="4 4" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.8, delay: 0.6 }} />
        {/* The second sight line ends in smoke: the satellite loses the ember */}
        <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.4 }}>
          <line x1="226" y1="42" x2="238" y2="54" stroke="#ef4444" strokeWidth="2.5" />
          <line x1="238" y1="42" x2="226" y2="54" stroke="#ef4444" strokeWidth="2.5" />
        </motion.g>
        {[0, 1, 2, 3].map((i) => (
          <motion.circle
            key={i}
            cx={245}
            cy={60}
            r={10 + i * 4}
            fill="#94a3b8"
            filter={`url(#${id}-blur)`}
            animate={{ cy: [62, 20], cx: [245, 262 + i * 6], opacity: [0, 0.55, 0] }}
            transition={{ duration: 4, delay: i, repeat: Infinity, ease: "easeOut" }}
          />
        ))}
        {/* Peat layers */}
        {PEAT_R0.map((l, i) => (
          <g key={l.en}>
            <rect x="0" y={70 + i * 45} width="360" height="45" fill={l.fill} />
            <text x="8" y={88 + i * 45} fill="#fde8d0" fontSize="10" fontWeight="600">
              {l.en}
            </text>
            <text x="8" y={101 + i * 45} fill="#d6b38a" fontSize="9">
              R0 {l.r0} m/h · {l.id}
            </text>
          </g>
        ))}
        <line x1="0" y1="70" x2="360" y2="70" stroke="#86efac" strokeOpacity="0.5" />
        {/* Surface flames: visible, the satellite sees them */}
        {[78, 92, 104].map((x, i) => (
          <motion.path
            key={x}
            d={`M${x - 7} 70 Q${x - 4} 52 ${x} ${44 - i * 3} Q${x + 4} 54 ${x + 7} 70 Z`}
            fill={i === 1 ? "#facc15" : "#f97316"}
            style={{ originX: `${x}px`, originY: "70px" }}
            animate={{ scaleY: [1, 1.25, 0.9, 1.15, 1], scaleX: [1, 0.9, 1.05, 0.95, 1] }}
            transition={{ duration: 0.9 + i * 0.17, repeat: Infinity, ease: "easeInOut" }}
          />
        ))}
        {/* Underground ember front creeping through deep peat */}
        <motion.ellipse
          cy="140"
          rx="34"
          ry="16"
          fill={`url(#${id}-ember)`}
          animate={{ cx: [170, 250, 170], opacity: [0.85, 1, 0.85] }}
          transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.ellipse
          cy="182"
          rx="22"
          ry="10"
          fill={`url(#${id}-ember)`}
          animate={{ cx: [300, 230, 300], opacity: [0.6, 0.9, 0.6] }}
          transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
        />
      </svg>
      <div className={`mt-3 grid grid-cols-2 gap-3 ${portrait ? "text-base" : "text-xs"}`}>
        <div>
          <p className="text-2xl font-bold tabular-nums text-red-400">
            <Count value={burning} />
          </p>
          <p className="text-slate-200">burning at the surface</p>
          <p className="text-slate-400">api permukaan terlihat</p>
        </div>
        <div>
          <p className="text-2xl font-bold tabular-nums text-orange-400">
            <Count value={hidden} delay={300} />
          </p>
          <p className="text-slate-200">kept on watch underground</p>
          <p className="text-slate-400">bara yang tetap kami pantau</p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ 3. spread polar plot */

export function SpreadPolar({
  r0,
  rh,
  windKmh,
  windDeg,
  portrait,
}: {
  r0: number;
  rh: number;
  windKmh: number;
  windDeg: number;
  portrait: boolean;
}) {
  const m = moistureRetardation(rh);
  const rates = Array.from({ length: 73 }, (_, i) => spreadRateAt(i * 5, r0, m, windDeg, windKmh));
  const head = Math.max(...rates);
  const back = spreadRateAt(windDeg + 180, r0, m, windDeg, windKmh);
  const R = 70;
  const pts = rates.map((r, i) => {
    const a = ((i * 5 - 90) * Math.PI) / 180;
    const k = (r / head) * R;
    return `${(100 + Math.cos(a) * k).toFixed(1)},${(90 + Math.sin(a) * k).toFixed(1)}`;
  });
  const wa = ((windDeg - 90) * Math.PI) / 180;
  return (
    <div className="grid grid-cols-[auto_1fr] items-center gap-3">
      <svg viewBox="0 0 200 180" className={portrait ? "w-52" : "w-40"} role="img" aria-label="Laju rambatan per arah">
        {[0.33, 0.66, 1].map((f) => (
          <circle key={f} cx="100" cy="90" r={R * f} fill="none" stroke="#ffffff" strokeOpacity="0.1" />
        ))}
        <text x="100" y="14" textAnchor="middle" fill="#94a3b8" fontSize="9">N</text>
        <motion.path
          d={`M${pts.join(" L")} Z`}
          fill="rgba(239,68,68,0.22)"
          stroke="#f87171"
          strokeWidth="2"
          initial={{ pathLength: 0, fillOpacity: 0 }}
          animate={{ pathLength: 1, fillOpacity: 1 }}
          transition={{ duration: 1.8, ease: EASE, delay: 0.3 }}
        />
        {/* Wind push: the head fire runs this way */}
        <motion.line
          x1="100"
          y1="90"
          x2={100 + Math.cos(wa) * (R + 12)}
          y2={90 + Math.sin(wa) * (R + 12)}
          stroke="#7dd3fc"
          strokeWidth="2.5"
          strokeDasharray="5 5"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1, strokeDashoffset: [0, -20] }}
          transition={{ pathLength: { duration: 0.8 }, strokeDashoffset: { duration: 1, repeat: Infinity, ease: "linear" } }}
        />
        <circle cx="100" cy="90" r="3.5" fill="#fff" />
      </svg>
      <div className={portrait ? "text-base" : "text-xs"}>
        <p className="text-slate-300">
          R(θ) = R0 · (1 + w(θ))<sup>m</sup>
        </p>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 tabular-nums">
          <div>
            <dt className="text-slate-400">head fire · kepala api</dt>
            <dd className="text-lg font-bold text-red-400">{en(head)} m/h</dd>
          </div>
          <div>
            <dt className="text-slate-400">back fire · belakang</dt>
            <dd className="text-lg font-bold text-slate-100">{en(back)} m/h</dd>
          </div>
          <div>
            <dt className="text-slate-400">wind · angin</dt>
            <dd className="text-sky-300">{en(windKmh)} km/h</dd>
          </div>
          <div>
            <dt className="text-slate-400">humidity · RH</dt>
            <dd className="text-slate-100">
              {en(rh)}% · m {en(m, 2)}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ 4. PM2.5 against WHO */

/** WHO 2021 Air Quality Guidelines, 24-hour mean PM2.5. */
export const WHO_PM25_24H = 15;

export function PmVersusWho({
  pm25,
  forecast,
  place,
  portrait,
}: {
  pm25: number;
  forecast: { at: string; pm25: number | null }[];
  place: string;
  portrait: boolean;
}) {
  const times = WHO_PM25_24H > 0 ? pm25 / WHO_PM25_24H : 0;
  const series = forecast.filter((f) => f.pm25 !== null).slice(0, 13) as { at: string; pm25: number }[];
  const max = Math.max(pm25, WHO_PM25_24H * 1.5, ...series.map((s) => s.pm25));
  const W = 320;
  const H = 70;
  const path = series
    .map((s, i) => `${i === 0 ? "M" : "L"}${((i / Math.max(1, series.length - 1)) * W).toFixed(1)},${(H - (s.pm25 / max) * H).toFixed(1)}`)
    .join(" ");
  const whoY = H - (WHO_PM25_24H / max) * H;
  return (
    <div>
      <p className={`text-slate-300 ${portrait ? "text-base" : "text-xs"}`}>{place} · PM2.5 now</p>
      <p className="mt-0.5 flex items-baseline gap-2">
        <span className="text-5xl font-bold tabular-nums text-rose-400">
          <Count value={times} digits={1} />×
        </span>
        <span className={`text-slate-300 ${portrait ? "text-base" : "text-sm"}`}>the WHO 24-hour limit</span>
      </p>
      <div className="mt-3 space-y-1.5">
        {[
          { label: `WHO guideline ${WHO_PM25_24H} µg/m³`, v: WHO_PM25_24H, c: "#86efac" },
          { label: `${place} ${en(pm25)} µg/m³`, v: pm25, c: "#fb7185" },
        ].map((b, i) => (
          <div key={b.label}>
            <p className={`text-slate-300 ${portrait ? "text-sm" : "text-[11px]"}`}>{b.label}</p>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <motion.div
                className="h-full rounded-full"
                style={{ background: b.c }}
                initial={{ width: 0 }}
                animate={{ width: `${(b.v / max) * 100}%` }}
                transition={{ duration: 1.1, delay: 0.3 + i * 0.4, ease: EASE }}
              />
            </div>
          </div>
        ))}
      </div>
      {series.length > 1 && (
        <>
          <svg viewBox={`0 -6 ${W} ${H + 12}`} className="mt-3 w-full" role="img" aria-label="Prakiraan PM2.5 12 jam">
            <line x1="0" x2={W} y1={whoY} y2={whoY} stroke="#86efac" strokeDasharray="4 4" strokeOpacity="0.7" />
            <motion.path
              d={path}
              fill="none"
              stroke="#fb7185"
              strokeWidth="2.5"
              strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 2.2, delay: 1, ease: "easeInOut" }}
            />
          </svg>
          <p className={`flex justify-between text-slate-400 ${portrait ? "text-sm" : "text-[10px]"}`}>
            <span>now</span>
            <span>12 h forecast · prakiraan 12 jam</span>
          </p>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ 5. response board */

export function ResponseBoard({
  rows,
  co2Tph,
  portrait,
}: {
  rows: { name: string; km: number; crews: number }[];
  co2Tph: number;
  portrait: boolean;
}) {
  const max = Math.max(1, ...rows.map((r) => r.km));
  // Live tally since the scene opened: the modeled emission rate made tangible
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    const timer = window.setInterval(() => setElapsed((performance.now() - t0) / 1000), 100);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div>
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <li key={r.name}>
            <div className={`flex justify-between gap-3 ${portrait ? "text-base" : "text-xs"}`}>
              <span className="truncate text-slate-100">{r.name}</span>
              <span className="shrink-0 tabular-nums text-slate-300">
                {en(r.km, 1)} km · <span className="font-semibold text-white">{en(r.crews)}</span> crews
              </span>
            </div>
            <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-white/10">
              <motion.div
                className="h-full rounded-full bg-yellow-300"
                initial={{ width: 0 }}
                animate={{ width: `${(r.km / max) * 100}%` }}
                transition={{ duration: 1, delay: 0.3 + i * 0.18, ease: EASE }}
              />
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-4 border-t border-white/10 pt-3">
        <p className={`text-slate-300 ${portrait ? "text-base" : "text-xs"}`}>CO₂ released since this scene began (model)</p>
        <p className="text-3xl font-bold tabular-nums text-orange-300">{en((co2Tph / 3600) * elapsed, 1)} t</p>
        <p className={`text-slate-400 ${portrait ? "text-sm" : "text-[11px]"}`}>
          {en(co2Tph)} t/h from peat burning · emisi CO₂ per jam
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ 6. this year in context */

/** SiPongi (Kementerian Kehutanan), Jan-Jul 2026 and the same period of 2025; World Bank (2016) for 2015. */
export const CONTEXT = {
  ha2026: 202_004.3,
  ha2025: 202_004.3 - 82_791.04,
  ha2015: 2_600_000,
  cost2015Usd: 16.1e9,
};

export function YearContext({ portrait }: { portrait: boolean }) {
  const rows = [
    { en: "2025, Jan-Jul", v: CONTEXT.ha2025, c: "#fdba74" },
    { en: "2026, Jan-Jul", v: CONTEXT.ha2026, c: "#f97316" },
    { en: "2015 crisis, full season", v: CONTEXT.ha2015, c: "#ef4444" },
  ];
  return (
    <div>
      <ul className="space-y-2.5">
        {rows.map((r, i) => (
          <li key={r.en}>
            <div className={`flex justify-between gap-3 ${portrait ? "text-base" : "text-xs"}`}>
              <span className="text-slate-200">{r.en}</span>
              <span className="font-semibold tabular-nums text-white">
                <Count value={r.v} delay={300 + i * 350} /> ha
              </span>
            </div>
            <div className="mt-0.5 h-2 overflow-hidden rounded-full bg-white/10">
              <motion.div
                className="h-full rounded-full"
                style={{ background: r.c }}
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(1.5, (r.v / CONTEXT.ha2015) * 100)}%` }}
                transition={{ duration: 1.2, delay: 0.3 + i * 0.35, ease: EASE }}
              />
            </div>
          </li>
        ))}
      </ul>
      <p className={`mt-3 text-slate-300 ${portrait ? "text-base" : "text-xs"}`}>
        2015 cost Indonesia US$16.1 billion, 1.9% of GDP. Kerugian 2015: US$16,1 miliar.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ 7. the satellite fleet */

export function SatelliteFleet({
  satellites,
  detections,
  costs,
  portrait,
}: {
  satellites: { name: string; sensor: string; operator: string; launched: string; firmsSource: string }[];
  /** Detections per FIRMS dataset id (MODIS is shared by Terra and Aqua). */
  detections: Record<string, number>;
  costs: { label: string; usd: number }[];
  portrait: boolean;
}) {
  const id = useId();
  const total = costs.reduce((s, c) => s + c.usd, 0);
  const xs = satellites.map((_, i) => 40 + (i * 280) / Math.max(1, satellites.length - 1));
  const ys = xs.map((x) => 26 - Math.sin(((x - 40) / 280) * Math.PI) * 14);
  return (
    <div>
      <svg viewBox="0 -14 360 164" className="w-full" role="img" aria-label="Satelit mengirim deteksi api ke NASA FIRMS lalu ke GambutWatch">
        {/* Each satellite downlinks packets to FIRMS; FIRMS feeds GambutWatch: the real data path */}
        {xs.map((x, i) => (
          <path key={i} id={`${id}-p${i}`} d={`M${x} ${ys[i]} Q${(x + 180) / 2} 80 180 112`} fill="none" stroke="#e2e8f0" strokeOpacity="0.18" />
        ))}
        <path id={`${id}-last`} d="M180 112 L320 112" stroke="#fb923c" strokeOpacity="0.4" strokeDasharray="3 4" />
        {xs.map((_, i) =>
          [0, 1, 2].map((k) => (
            <circle key={`${i}-${k}`} r="2.2" fill={satellites[i].sensor === "VIIRS" ? "#fde68a" : "#93c5fd"}>
              <animateMotion dur="2.4s" begin={`${i * 0.35 + k * 0.8}s`} repeatCount="indefinite">
                <mpath href={`#${id}-p${i}`} />
              </animateMotion>
            </circle>
          )),
        )}
        {[0, 1].map((k) => (
          <circle key={k} r="2.6" fill="#fb923c">
            <animateMotion dur="1.6s" begin={`${k * 0.8}s`} repeatCount="indefinite">
              <mpath href={`#${id}-last`} />
            </animateMotion>
          </circle>
        ))}
        {xs.map((x, i) => (
          <g key={satellites[i].name} transform={`translate(${x} ${ys[i]})`}>
            <rect x="-10" y="-2" width="7" height="4" fill="#93c5fd" />
            <rect x="3" y="-2" width="7" height="4" fill="#93c5fd" />
            <circle r="3.5" fill="#fff" />
            <text y="-8" textAnchor="middle" fill="#e2e8f0" fontSize="8.5" fontWeight="600">
              {satellites[i].name}
            </text>
          </g>
        ))}
        <rect x="140" y="104" width="80" height="18" rx="4" fill="#0f172a" stroke="#fde68a" strokeOpacity="0.5" />
        <text x="180" y="116" textAnchor="middle" fill="#fde68a" fontSize="9" fontWeight="600">NASA FIRMS</text>
        <rect x="282" y="104" width="76" height="18" rx="4" fill="#0f172a" stroke="#fb923c" strokeOpacity="0.7" />
        <text x="320" y="116" textAnchor="middle" fill="#fdba74" fontSize="9" fontWeight="600">GambutWatch</text>
        <text x="180" y="140" textAnchor="middle" fill="#94a3b8" fontSize="8">gold: VIIRS · blue: MODIS</text>
      </svg>
      <ul className={`mt-1 space-y-1 ${portrait ? "text-base" : "text-xs"}`}>
        {satellites.map((s, i) => (
          <motion.li
            key={s.name}
            className="flex items-baseline justify-between gap-3"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4 + i * 0.15, duration: 0.5, ease: EASE }}
          >
            <span className="text-slate-100">
              {s.name} <span className="text-slate-400">· {s.operator} · {s.launched.slice(0, 4)} · {s.sensor}</span>
            </span>
            <span className="shrink-0 tabular-nums text-slate-200">
              {s.sensor === "MODIS" ? "MODIS" : en(detections[s.firmsSource] ?? 0)}
            </span>
          </motion.li>
        ))}
        {detections.MODIS_NRT != null && (
          <li className="flex justify-between text-slate-400">
            <span>Terra + Aqua (one MODIS dataset)</span>
            <span className="tabular-nums text-slate-200">{en(detections.MODIS_NRT)}</span>
          </li>
        )}
      </ul>
      <div className="mt-3 border-t border-white/10 pt-2.5">
        <p className={`text-slate-200 ${portrait ? "text-base" : "text-xs"}`}>
          About <span className="font-bold text-white">US${en(total / 1e9, 1)} billion</span> of satellites. The fire data reaches us free.
        </p>
        <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-white/10">
          {costs.map((c, i) => (
            <motion.span
              key={c.label}
              title={c.label}
              style={{ background: ["#fde68a", "#93c5fd", "#60a5fa"][i] }}
              initial={{ width: 0 }}
              animate={{ width: `${(c.usd / total) * 100}%` }}
              transition={{ delay: 1 + i * 0.3, duration: 0.9, ease: EASE }}
            />
          ))}
        </div>
        <p className={`mt-1 text-slate-400 ${portrait ? "text-sm" : "text-[10px]"}`}>
          {costs.map((c) => `${c.label} US$${en(c.usd / 1e9, c.usd < 1e9 ? 2 : 1)}B`).join(" · ")}
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ 8. news wire */

export function NewsWire({
  articles,
  portrait,
  limit,
}: {
  articles: { id: string; title: string; source: string; publishedAt: string }[];
  portrait: boolean;
  limit: number;
}) {
  const DAYS = 14;
  // Fixed when the scene opens, so the day buckets do not shift while it plays
  const [now] = useState(() => Date.now());
  const perDay = Array.from({ length: DAYS }, () => 0);
  for (const a of articles) {
    const d = Math.floor((now - Date.parse(a.publishedAt)) / 86_400_000);
    if (d >= 0 && d < DAYS) perDay[DAYS - 1 - d] += 1;
  }
  const max = Math.max(1, ...perDay);
  const outlets = new Set(articles.map((a) => a.source)).size;
  const latest = [...articles].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, limit);
  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <p className={`text-slate-300 ${portrait ? "text-base" : "text-xs"}`}>
          <span className="text-2xl font-bold tabular-nums text-white">
            <Count value={articles.length} />
          </span>{" "}
          stories · <span className="font-semibold text-white">{outlets}</span> outlets · 14 days
        </p>
      </div>
      {/* Coverage per day: a rising right edge means the story is getting bigger */}
      <div className="relative mt-2 flex h-14 items-end gap-1">
        {perDay.map((n, i) => (
          <motion.span
            key={i}
            className={`flex-1 rounded-t-sm ${i === DAYS - 1 ? "bg-orange-400" : "bg-orange-400/45"}`}
            initial={{ height: 0 }}
            animate={{ height: `${Math.max(4, (n / max) * 100)}%` }}
            transition={{ delay: 0.2 + i * 0.05, duration: 0.6, ease: EASE }}
          />
        ))}
        <motion.span
          aria-hidden
          className="absolute inset-y-0 w-px bg-white/70"
          initial={{ left: "0%" }}
          animate={{ left: "100%" }}
          transition={{ duration: 2.4, delay: 0.3, ease: "easeInOut" }}
        />
      </div>
      <p className={`mt-0.5 flex justify-between text-slate-400 ${portrait ? "text-sm" : "text-[10px]"}`}>
        <span>14 days ago</span>
        <span>today · hari ini</span>
      </p>
      <ol className="relative mt-3 space-y-2.5 border-l border-white/15 pl-3">
        {latest.map((a, i) => (
          <motion.li
            key={a.id}
            className={`relative leading-snug ${portrait ? "text-lg" : "text-sm"}`}
            initial={{ opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 1.2 + i * 0.45, duration: 0.55, ease: EASE }}
          >
            <motion.span
              className="absolute top-1.5 -left-[17px] size-2 rounded-full bg-orange-400"
              initial={{ scale: 0 }}
              animate={{ scale: [0, 1.8, 1] }}
              transition={{ delay: 1.2 + i * 0.45, duration: 0.6 }}
            />
            <span className="line-clamp-2 text-slate-100">{a.title}</span>
            <span className="text-xs text-slate-400">
              {a.source} · {new Date(a.publishedAt).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
            </span>
          </motion.li>
        ))}
      </ol>
    </div>
  );
}
