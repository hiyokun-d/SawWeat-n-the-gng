"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { FlameIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { FEED_LABEL, useApiHealth, type FeedId } from "@/lib/apiHealth";

/** Feeds the opening waits on, in the order they matter for the first picture. */
const BOOT_FEEDS: FeedId[] = ["firms", "grid", "air", "bmkg", "crises", "satellites", "areas", "news", "population"];
/** The boot screen holds at least this long so the sequence can be read, and never longer than the cap. */
const MIN_MS = 2600;
const MAX_MS = 14000;
/** Must have answered before the map is shown: the fires and the weather that drives their spread. */
const REQUIRED: FeedId[] = ["firms", "grid"];

/**
 * Opening sequence over the globe while the camera flies in: every real feed
 * the dashboard pulls, with its live status, item count and latency. It ends
 * when fires and weather have answered (or on Skip / Esc), so the first view
 * the user gets already has data on it.
 */
export default function BootSequence({ mapReady, onDone }: { mapReady: boolean; onDone: () => void }) {
  const health = useApiHealth();
  const reduced = useReducedMotion() ?? false;
  const [startedAt] = useState(() => performance.now());
  const [dismissed, setDismissed] = useState(false);
  const [now, setNow] = useState(startedAt);

  const elapsed = now - startedAt;
  const answered = BOOT_FEEDS.filter((f) => health[f]).length;
  const essentials = REQUIRED.every((f) => health[f]);
  // Every input only moves toward "done" (time passes, feeds answer), so this never reopens
  const open = !dismissed && !((mapReady && essentials && elapsed >= MIN_MS) || elapsed >= MAX_MS);

  useEffect(() => {
    if (!open) return;
    const t = window.setInterval(() => setNow(performance.now()), 250);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDismissed(true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);


  return (
    <AnimatePresence onExitComplete={onDone}>
      {open && (
        <motion.div
          key="boot"
          className="fixed inset-0 z-50 flex items-center bg-gradient-to-r from-slate-950 via-slate-950/85 to-slate-950/20 px-6 sm:px-12"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: reduced ? 0 : 0.9, ease: "easeInOut" } }}
          role="status"
          aria-live="polite"
          aria-label="Memuat data langsung"
        >
          <div className="w-full max-w-md">
            <div className="flex items-center gap-4">
              <ScanMark reduced={reduced} />
              <div>
                <p className="text-2xl font-bold tracking-tight text-white">GambutWatch</p>
                <p className="text-sm text-slate-300">Connecting to live feeds</p>
                <p className="text-xs text-slate-400">Menghubungkan ke data langsung</p>
              </div>
            </div>

            <ul className="mt-7 space-y-2.5">
              {BOOT_FEEDS.map((f, i) => {
                const h = health[f];
                const state = !h ? "wait" : h.ok ? "ok" : "fail";
                return (
                  <motion.li
                    key={f}
                    initial={reduced ? false : { opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.15 + i * 0.07, duration: 0.35 }}
                    className="text-sm"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className={state === "wait" ? "text-slate-400" : "text-slate-100"}>{FEED_LABEL[f]}</span>
                      <span
                        className={`shrink-0 text-xs tabular-nums ${
                          state === "ok" ? "text-emerald-300" : state === "fail" ? "text-orange-300" : "text-slate-500"
                        }`}
                      >
                        {state === "wait"
                          ? "menunggu"
                          : state === "fail"
                            ? "gagal, dilewati"
                            : `${h!.items !== null ? `${h!.items.toLocaleString("id-ID")} · ` : ""}${h!.roundTripMs} ms`}
                      </span>
                    </div>
                    <div className="mt-1 h-px overflow-hidden bg-white/10">
                      <motion.div
                        className={`h-full ${state === "fail" ? "bg-orange-400" : "bg-emerald-400"}`}
                        initial={{ width: "0%" }}
                        animate={{ width: state === "wait" ? "12%" : "100%" }}
                        transition={{ duration: state === "wait" ? 1.2 : 0.45, ease: "easeOut" }}
                      />
                    </div>
                  </motion.li>
                );
              })}
            </ul>

            <div className="mt-6 flex items-center justify-between text-xs text-slate-400">
              <span className="tabular-nums">
                {answered}/{BOOT_FEEDS.length} sumber · {(elapsed / 1000).toFixed(1)} s
              </span>
              <button
                type="button"
                onClick={() => setDismissed(true)}
                className="rounded-md px-2 py-1.5 text-slate-300 underline-offset-4 hover:text-white hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
              >
                Lewati (Esc)
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Brand flame inside a satellite sweep: the app's whole idea (seeing fire from orbit) in one mark. */
function ScanMark({ reduced }: { reduced: boolean }) {
  return (
    <div className="relative size-16 shrink-0">
      <svg viewBox="0 0 64 64" className="absolute inset-0" aria-hidden>
        <circle cx="32" cy="32" r="29" fill="none" stroke="rgb(255 255 255 / 0.12)" strokeWidth="1" />
        <circle cx="32" cy="32" r="21" fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth="1" />
      </svg>
      <motion.svg
        viewBox="0 0 64 64"
        className="absolute inset-0"
        aria-hidden
        animate={reduced ? undefined : { rotate: 360 }}
        transition={{ duration: 2.4, ease: "linear", repeat: Infinity }}
      >
        <defs>
          <linearGradient id="gw-sweep" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fb923c" stopOpacity="0" />
            <stop offset="1" stopColor="#fb923c" stopOpacity="0.9" />
          </linearGradient>
        </defs>
        <path d="M32 3 A29 29 0 0 1 61 32" fill="none" stroke="url(#gw-sweep)" strokeWidth="2" strokeLinecap="round" />
        <circle cx="61" cy="32" r="2.5" fill="#fff7ed" />
      </motion.svg>
      <div className="absolute inset-0 grid place-items-center">
        <FlameIcon className="size-6 text-orange-400" />
      </div>
    </div>
  );
}
