"use client";

import { useEffect, useRef, useState } from "react";
import { compassName } from "@/lib/gambut";

export interface VectorCompassProps {
  /** Bearing the wind pushes toward, degrees clockwise from north. */
  windVectorDeg: number;
  windSpeedKmh: number;
  /** Bearing from the viewer to the fire; omit when there is no viewer position. */
  fireBearingDeg?: number;
  fireDistanceM?: number;
  /** Offer a toggle that turns the dial with the phone's compass sensor. */
  sensor?: boolean;
  className?: string;
}

const C = 110; // dial centre in viewBox units
const WIND_COLOR = "#38bdf8";
const FIRE_COLOR = "#f97316";
const FIRE_TIP_COLOR = "#ef4444";
const CARDINALS = [
  { label: "U", deg: 0 },
  { label: "T", deg: 90 },
  { label: "S", deg: 180 },
  { label: "B", deg: 270 },
] as const;

/** Keeps the dial from spinning the long way when the heading crosses 0/360. */
function unwrap(previous: number | null, next: number): number {
  if (previous === null) return next;
  return previous + ((((next - previous) % 360) + 540) % 360) - 180;
}

type OrientationEventWithCompass = DeviceOrientationEvent & { webkitCompassHeading?: number };
type PermissionedOrientation = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

/** Compass heading of the device (degrees from north), or null until the sensor reports. */
function useDeviceHeading(enabled: boolean): number | null {
  const [heading, setHeading] = useState<number | null>(null);
  const last = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const onOrientation = (event: Event) => {
      const e = event as OrientationEventWithCompass;
      let compass: number | null = null;
      if (typeof e.webkitCompassHeading === "number") {
        compass = e.webkitCompassHeading; // iOS: already clockwise from north
      } else if (e.absolute && e.alpha !== null) {
        compass = (360 - e.alpha) % 360; // Android absolute event: alpha is counter-clockwise
      }
      if (compass === null) return;
      last.current = unwrap(last.current, compass);
      setHeading(last.current);
    };
    // Android Chrome only reports north-referenced values on the absolute event
    window.addEventListener("deviceorientationabsolute", onOrientation, true);
    window.addEventListener("deviceorientation", onOrientation, true);
    return () => {
      window.removeEventListener("deviceorientationabsolute", onOrientation, true);
      window.removeEventListener("deviceorientation", onOrientation, true);
    };
  }, [enabled]);

  return enabled ? heading : null;
}

/**
 * Tactical compass: a sky-blue arrow for the direction the wind pushes the fire,
 * and (when a viewer position exists) an orange needle with a round red tip for
 * the bearing to the fire. The two differ in shape as well as color. Distances
 * and rates are written next to the dial by the caller, not encoded in color.
 */
export default function VectorCompass({
  windVectorDeg,
  windSpeedKmh,
  fireBearingDeg,
  fireDistanceM,
  sensor = false,
  className = "",
}: VectorCompassProps) {
  const [live, setLive] = useState(false);
  const [denied, setDenied] = useState(false);
  const [silent, setSilent] = useState(false);
  const heading = useDeviceHeading(live);

  // No event within a few seconds usually means a desktop browser without a compass
  useEffect(() => {
    if (!live) return;
    const timer = window.setTimeout(() => setSilent(true), 2500);
    return () => window.clearTimeout(timer);
  }, [live]);

  const toggleSensor = async () => {
    if (live) {
      setLive(false);
      return;
    }
    setDenied(false);
    setSilent(false);
    const ctor = DeviceOrientationEvent as PermissionedOrientation;
    if (typeof ctor.requestPermission === "function") {
      try {
        if ((await ctor.requestPermission()) !== "granted") {
          setDenied(true);
          return;
        }
      } catch {
        setDenied(true);
        return;
      }
    }
    setLive(true);
  };

  const hasFire = fireBearingDeg !== undefined;
  const label =
    `Kompas taktis. Angin mendorong api ke ${compassName(windVectorDeg)} ` +
    `dengan kecepatan ${Math.round(windSpeedKmh)} kilometer per jam.` +
    (hasFire
      ? ` Api berada ${fireDistanceM !== undefined ? `${Math.round(fireDistanceM)} meter ` : ""}` +
        `ke arah ${compassName(fireBearingDeg)}.`
      : "");

  const note = denied
    ? "Izin sensor arah ditolak. Kompas tetap menghadap utara."
    : live && heading === null && silent
      ? "Perangkat ini tidak mengirim data arah. Kompas tetap menghadap utara."
      : null;

  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      <svg
        viewBox="0 0 220 220"
        role="img"
        aria-label={label}
        className="w-full max-w-52 select-none"
      >
        {heading !== null && <polygon points="110,3 103,15 117,15" fill="#e2e8f0" />}
        <g
          className="transition-transform duration-150 motion-reduce:transition-none"
          style={{
            transformOrigin: `${C}px ${C}px`,
            transform: `rotate(${heading === null ? 0 : -heading}deg)`,
          }}
        >
          <circle cx={C} cy={C} r={84} fill="#0f172a" stroke="#64748b" strokeWidth={2} />
          {Array.from({ length: 24 }, (_, i) => {
            const deg = i * 15;
            const len = deg % 45 === 0 ? 12 : 6;
            return (
              <line
                key={deg}
                x1={C}
                y1={C - 84}
                x2={C}
                y2={C - 84 + len}
                stroke="#64748b"
                strokeWidth={deg % 90 === 0 ? 2.5 : 1.5}
                transform={`rotate(${deg} ${C} ${C})`}
              />
            );
          })}
          {CARDINALS.map(({ label: letter, deg }) => (
            <text
              key={letter}
              x={C}
              y={C - 98}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={14}
              fontWeight={700}
              fill="#cbd5e1"
              transform={`rotate(${deg} ${C} ${C})`}
            >
              <tspan transform={`rotate(${-deg} ${C} ${C - 98})`}>{letter}</tspan>
            </text>
          ))}

          {hasFire && (
            <g transform={`rotate(${fireBearingDeg} ${C} ${C})`}>
              <line x1={C} y1={C} x2={C} y2={C - 76} stroke={FIRE_COLOR} strokeWidth={4} strokeLinecap="round" />
              <circle cx={C} cy={C - 76} r={8} fill={FIRE_TIP_COLOR} stroke="#ffffff" strokeWidth={1.5} />
            </g>
          )}

          <g transform={`rotate(${windVectorDeg} ${C} ${C})`}>
            <polygon
              points={`${C},28 ${C + 15},62 ${C + 5},62 ${C + 5},${C} ${C - 5},${C} ${C - 5},62 ${C - 15},62`}
              fill={WIND_COLOR}
              stroke="#082f49"
              strokeWidth={1.5}
              strokeLinejoin="round"
            />
          </g>
          <circle cx={C} cy={C} r={6} fill="#e2e8f0" stroke="#0f172a" strokeWidth={1.5} />
        </g>
      </svg>

      {sensor && (
        <button
          type="button"
          onClick={() => void toggleSensor()}
          aria-pressed={live}
          className="min-h-11 rounded-lg border border-white/20 px-4 text-xs font-semibold text-slate-200 transition-colors hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 aria-pressed:border-sky-400/60 aria-pressed:bg-sky-500/15 aria-pressed:text-sky-100"
        >
          {live ? "Kompas HP: aktif" : "Putar kompas mengikuti HP"}
        </button>
      )}
      {note && <p className="text-center text-xs text-amber-300">{note}</p>}
    </div>
  );
}
