#!/usr/bin/env node
/**
 * Records the GambutWatch presentation (/present) to MP4 with music.
 *
 *   node scripts/record-video.mjs                     # all four: short/full x landscape/portrait
 *   node scripts/record-video.mjs --cut short --aspect portrait
 *   node scripts/record-video.mjs --base http://localhost:3000
 *
 * Needs a running server (production is best: `bun run build && bun run start`)
 * and Playwright's Chromium (`npx playwright-core install chromium`). Frames come
 * from Chrome's screencast with their real timestamps, so playback speed is exact
 * even when the renderer drops frames; ffmpeg resamples them to a constant 30 fps.
 * Music: Kevin MacLeod (incompetech.com), CC BY 4.0, downloaded on first use and
 * credited on the closing card.
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import ffmpegPath from "ffmpeg-static";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "public", "videos");
const CACHE = path.join(ROOT, ".cache");

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const BASE = args.base ?? "http://localhost:3100";
const CUTS = args.cut ? [args.cut] : ["short", "full"];
const ASPECTS = args.aspect ? [args.aspect] : ["landscape", "portrait"];
const FPS = 30;
// Screencast JPEG quality: lower keeps the capture rate up on hot or slower machines
const QUALITY = Number(args.quality ?? 92);

// Urgent, driving track for the 60 s cut; a slower cinematic build for the full briefing
const MUSIC = {
  short: { title: "Volatile Reaction", file: "Volatile_Reaction.mp3" },
  full: { title: "Impact Prelude", file: "Impact_Prelude.mp3" },
};
const SIZE = { landscape: { width: 1920, height: 1080 }, portrait: { width: 1080, height: 1920 } };

function run(cmd, argv) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: ["ignore", "inherit", "inherit"] });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited ${code}`))));
  });
}

async function music(cut) {
  const m = MUSIC[cut];
  const file = path.join(CACHE, "music", m.file);
  if (!existsSync(file)) {
    await mkdir(path.dirname(file), { recursive: true });
    const url = `https://incompetech.com/music/royalty-free/mp3-royaltyfree/${encodeURIComponent(m.title)}.mp3`;
    console.log(`  downloading music: ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`music download HTTP ${res.status}`);
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
  }
  return { file, credit: `Music: "${m.title}" by Kevin MacLeod (incompetech.com), CC BY 4.0` };
}

/** Playwright's own Chromium if installed for this version, else any Chrome for Testing in its cache. */
function chromeExecutable() {
  const own = chromium.executablePath();
  if (existsSync(own)) return own;
  const cache = path.join(os.homedir(), "Library", "Caches", "ms-playwright");
  const dirs = existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : [];
  for (const d of dirs) {
    const mac = path.join(cache, d, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing");
    const linux = path.join(cache, d, "chrome-linux", "chrome");
    for (const f of [mac, linux]) if (existsSync(f)) return f;
  }
  throw new Error("No Chromium found: run `npx playwright-core install chromium`");
}

async function record(cut, aspect) {
  const { width, height } = SIZE[aspect];
  const track = await music(cut);
  const name = `gambutwatch-${cut}-${aspect}`;
  const work = path.join(CACHE, "frames", name);
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });

  console.log(`\n● ${name} (${width}x${height})`);
  const browser = await chromium.launch({
    executablePath: chromeExecutable(),
    // Headless Chrome still caps its window at the physical screen; a virtual screen and an explicit
    // window size let a 1920 px tall portrait frame be captured whole on a laptop display
    args: [
      "--use-angle=metal",
      "--enable-gpu",
      "--ignore-gpu-blocklist",
      "--force-device-scale-factor=1",
      `--window-size=${width},${height}`,
      "--screen-info={0,0 3840x3840}",
    ],
  });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.log("  page error:", e.message.slice(0, 200)));

  const url = `${BASE}/present?cut=${cut}&record=1&music=${encodeURIComponent(track.credit)}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });

  // Wait for the background load; log what is still pending while waiting
  const t0 = Date.now();
  let lastLog = 0;
  while (!(await page.evaluate(() => Boolean(window.__gwStarted)))) {
    if (Date.now() - t0 > 240_000) throw new Error("presentation did not start within 4 minutes");
    if (Date.now() - lastLog > 10_000) {
      lastLog = Date.now();
      const pending = await page.evaluate(() => window.__gwChecks ?? []);
      console.log(`  loading ${((Date.now() - t0) / 1000).toFixed(0)} s, pending: ${pending.join("; ") || "-"}`);
    }
    await page.waitForTimeout(100);
  }
  console.log(`  started after ${((Date.now() - t0) / 1000).toFixed(1)} s, recording`);
  await page.waitForTimeout(600);
  const script = await page.evaluate(() => window.__gwScript);
  if (script) console.log(`  script: ${script.scenes.length} scenes (${script.scenes.join(", ")}); ${script.completeAreas}/${script.areas} areas complete`);

  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  let writes = [];
  let badSize = null;
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    if (Math.round(metadata.deviceWidth) !== width || Math.round(metadata.deviceHeight) !== height) {
      badSize ??= `${metadata.deviceWidth}x${metadata.deviceHeight}`;
    }
    const i = frames.length;
    const file = path.join(work, `f${String(i).padStart(6, "0")}.jpg`);
    frames.push({ file, t: metadata.timestamp });
    writes.push(writeFile(file, Buffer.from(data, "base64")));
    void cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: QUALITY, maxWidth: width, maxHeight: height, everyNthFrame: 1 });

  const started = Date.now();
  while (!(await page.evaluate(() => Boolean(window.__gwDone)))) {
    if (Date.now() - started > 8 * 60_000) throw new Error("presentation did not finish within 8 minutes");
    await page.waitForTimeout(200);
  }
  // Hold the closing card a moment so the music can fade under it
  await page.waitForTimeout(1500);
  await cdp.send("Page.stopScreencast");
  await Promise.all(writes);
  writes = [];
  await browser.close();

  if (frames.length < 10) throw new Error("too few frames captured");
  if (badSize) throw new Error(`captured ${badSize} instead of ${width}x${height}; the window was clipped`);
  const duration = frames[frames.length - 1].t - frames[0].t;
  console.log(`  ${frames.length} frames over ${duration.toFixed(1)} s (${(frames.length / duration).toFixed(1)} fps captured)`);

  // Concat list with each frame's real on-screen time
  const list = frames
    .map((f, i) => {
      const next = frames[i + 1]?.t ?? f.t + 1 / FPS;
      return `file '${f.file}'\nduration ${Math.max(0.001, next - f.t).toFixed(4)}`;
    })
    .join("\n");
  const listFile = path.join(work, "frames.txt");
  await writeFile(listFile, `${list}\nfile '${frames[frames.length - 1].file}'\n`);

  const out = path.join(OUT_DIR, `${name}.mp4`);
  const fadeOut = Math.max(0, duration - 3);
  await run(ffmpegPath, [
    "-y",
    "-loglevel", "error",
    "-f", "concat", "-safe", "0", "-i", listFile,
    // Loop the track if the cut runs past it; the fade-out ends it cleanly either way
    "-stream_loop", "-1", "-i", track.file,
    "-filter_complex",
    // Fit and pad, never stretch; square pixels so players show the true aspect
    `[0:v]fps=${FPS},scale=${width}:${height}:flags=lanczos:force_original_aspect_ratio=decrease,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x020617,setsar=1,format=yuv420p[v];` +
      `[1:a]atrim=0:${duration.toFixed(2)},afade=t=in:d=0.6,afade=t=out:st=${fadeOut.toFixed(2)}:d=3,volume=0.9[a]`,
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-profile:v", "high",
    "-c:a", "aac", "-b:a", "192k",
    "-t", duration.toFixed(2),
    "-movflags", "+faststart",
    out,
  ]);
  await rm(work, { recursive: true, force: true });
  console.log(`  wrote ${path.relative(ROOT, out)}`);
}

for (const cut of CUTS) {
  for (const aspect of ASPECTS) {
    await record(cut, aspect);
  }
}
