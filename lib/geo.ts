import type { Polygon } from "geojson";
import type { BBox } from "./fire-types";

export function polygonBBox(poly: Polygon): BBox {
  let w = 180, s = 90, e = -180, n = -90;
  for (const [lng, lat] of poly.coordinates[0]) {
    w = Math.min(w, lng);
    s = Math.min(s, lat);
    e = Math.max(e, lng);
    n = Math.max(n, lat);
  }
  return [w, s, e, n];
}

// Ray casting on the outer ring — good enough for prototype-scale areas.
export function pointInPolygon(lng: number, lat: number, poly: Polygon) {
  const ring = poly.coordinates[0];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function clampBBox([w, s, e, n]: BBox): BBox {
  return [Math.max(w, -180), Math.max(s, -90), Math.min(e, 180), Math.min(n, 90)];
}
