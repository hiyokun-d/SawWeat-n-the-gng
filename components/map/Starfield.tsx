"use client";

import { useEffect, useRef } from "react";

/**
 * Space behind the globe: a depth cue so the planet reads as a planet when
 * zoomed out. Decorative, drawn once per resize (no animation loop), and
 * faded out by the parent when the camera is close enough to hide the sky.
 */
export default function Starfield({ visible }: { visible: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let drawn = "";
    let raf = 0;
    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { clientWidth: w, clientHeight: h } = canvas;
      // Layout shifts while the feeds load fire the observer many times at the same size
      const size = `${w}x${h}@${dpr}`;
      if (size === drawn || w === 0 || h === 0) return;
      drawn = size;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      // Seeded so the sky does not reshuffle on resize
      let seed = 20261016;
      const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
      const count = Math.round((w * h) / 1400);
      for (let i = 0; i < count; i++) {
        const x = rand() * w;
        const y = rand() * h;
        // Most stars faint, a few bright: the magnitude spread of a real sky
        const m = Math.pow(rand(), 3);
        const r = 0.35 + m * 1.3;
        const warm = rand() < 0.15;
        ctx.fillStyle = warm ? "rgb(254,215,170)" : "rgb(226,232,240)";
        ctx.globalAlpha = warm ? 0.25 + m * 0.7 : 0.2 + m * 0.75;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    draw();
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    });
    ro.observe(canvas);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full transition-opacity duration-1000"
      style={{ opacity: visible ? 1 : 0 }}
    />
  );
}
