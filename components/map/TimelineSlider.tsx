"use client";

import { motion } from "motion/react";
import { PauseIcon, PlayIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export const TIMELINE_HOURS = [0, 1, 3, 6, 9, 12] as const;

export interface TimelineSliderProps {
  /** Currently selected hour offset (0 = nowcast). */
  hourOffset: number;
  onChange: (hour: number) => void;
  /** Head-fire spread rate in m/h for the selected incident. */
  spreadRate: number;
  /** Threatened area in hectares for the selected incident. */
  threatenedAreaHa: number;
}

export default function TimelineSlider({
  hourOffset,
  onChange,
  spreadRate,
  threatenedAreaHa,
}: TimelineSliderProps) {
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
    setPlaying(false);
  }, []);

  // Auto-play: step through the timeline every 1.2 s, then stop at the end
  useEffect(() => {
    if (!playing) return;
    let index = TIMELINE_HOURS.indexOf(hourOffset as (typeof TIMELINE_HOURS)[number]);
    if (index < 0) index = 0;
    timer.current = window.setInterval(() => {
      const next = TIMELINE_HOURS[index + 1];
      if (next === undefined) {
        stop();
        return;
      }
      index += 1;
      onChange(next);
    }, 1200);
    return stop;
  }, [playing, hourOffset, onChange, stop]);

  return (
    <motion.div
      initial={{ y: 24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.5, duration: 0.4, ease: "easeOut" }}
      className="pointer-events-auto absolute inset-x-3 bottom-3 z-10 flex flex-col gap-2 rounded-2xl border border-white/10 bg-slate-950/90 px-3 py-2.5 shadow-2xl backdrop-blur sm:inset-x-auto sm:left-1/2 sm:w-[min(92%,46rem)] sm:-translate-x-1/2 sm:flex-row sm:items-center sm:gap-4 sm:px-5 sm:py-3"
    >
      <Button
        size="icon"
        variant={playing ? "secondary" : "default"}
        onClick={() => (playing ? stop() : setPlaying(true))}
        aria-label={playing ? "Jeda animasi" : "Putar animasi perambatan"}
        className="shrink-0 self-start sm:self-auto"
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </Button>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-3">
          <span className="w-16 shrink-0 text-xs font-semibold tabular-nums text-slate-300">
            {hourOffset === 0 ? "t+0 Nowcast" : `t+${hourOffset} jam`}
          </span>
          <input
            type="range"
            min={0}
            max={TIMELINE_HOURS.length - 1}
            step={1}
            value={TIMELINE_HOURS.indexOf(hourOffset as (typeof TIMELINE_HOURS)[number])}
            onChange={(e) => onChange(TIMELINE_HOURS[Number(e.target.value)])}
            className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-slate-700 accent-orange-500"
            aria-label="Horizon waktu perambatan"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {TIMELINE_HOURS.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => onChange(h)}
              className={`rounded-md px-2 py-0.5 text-xs tabular-nums transition-colors ${
                h === hourOffset
                  ? "bg-orange-500/20 font-semibold text-orange-300"
                  : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
              }`}
            >
              {h === 0 ? "Now" : `+${h}h`}
            </button>
          ))}
        </div>
      </div>

      <div className="flex shrink-0 gap-4 border-t border-white/10 pt-1.5 sm:gap-5 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
        <div>
          <div className="text-[10px] text-slate-400 sm:text-xs">Laju Rambatan (R)</div>
          <div className="text-sm font-semibold tabular-nums text-orange-400 sm:text-base">
            {Math.round(spreadRate)} m/jam
          </div>
        </div>
        <div>
          <div className="text-[10px] text-slate-400 sm:text-xs">Estimasi Luas Terancam</div>
          <div className="text-sm font-semibold tabular-nums text-red-400 sm:text-base">
            {threatenedAreaHa.toFixed(1)} ha
          </div>
        </div>
      </div>
    </motion.div>
  );
}
