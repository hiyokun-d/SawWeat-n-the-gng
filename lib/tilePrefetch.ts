"use client";

import type * as maplibregl from "maplibre-gl";

/** Indonesia, west, south, east, north. */
const BBOX = [94.9, -11.2, 141.1, 6.2] as const;
/** Up to this zoom only: about 60 tiles (~2 MB), country to province. Closer zooms load on demand. */
const MAX_ZOOM = 6;
const CONCURRENCY = 4;

function tileX(lng: number, z: number) {
  return Math.floor(((lng + 180) / 360) * 2 ** z);
}
function tileY(lat: number, z: number) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

const done = new Set<string>();

/**
 * Warms the browser cache with the basemap's vector tiles over Indonesia, so
 * zooming from the country view into any province paints immediately. Runs
 * at idle priority after the first frame and skips tiles fetched before.
 */
export function prefetchIndonesiaTiles(map: maplibregl.Map) {
  const src = map.getSource("openmaptiles") as { tiles?: string[] } | undefined;
  const template = src?.tiles?.[0];
  if (!template || done.has(template)) return;
  done.add(template);

  const urls: string[] = [];
  for (let z = 3; z <= MAX_ZOOM; z++) {
    for (let x = tileX(BBOX[0], z); x <= tileX(BBOX[2], z); x++) {
      for (let y = tileY(BBOX[3], z); y <= tileY(BBOX[1], z); y++) {
        urls.push(template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y)));
      }
    }
  }

  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++];
      try {
        await fetch(url, { priority: "low" } as RequestInit);
      } catch {
        // Best effort: the map fetches it normally if needed
      }
    }
  };
  const start = () => {
    for (let i = 0; i < CONCURRENCY; i++) void worker();
  };
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(start, { timeout: 4000 });
  else setTimeout(start, 1500);
}
