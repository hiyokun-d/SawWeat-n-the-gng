import Dexie, { type EntityTable } from "dexie";
import type { Polygon } from "geojson";
import type { BBox, FiresResponse } from "./fire-types";

export interface WatchArea {
  id: string;
  name: string;
  geometry: Polygon;
  bbox: BBox;
  createdAt: number;
}

export interface CachedScan {
  // `${source}|${days}|${bbox}`
  key: string;
  response: FiresResponse;
  fetchedAt: number;
}

// Browser-only IndexedDB store: drawn watch areas + last scan results (offline fallback).
export const db = new Dexie("firewatch") as Dexie & {
  areas: EntityTable<WatchArea, "id">;
  scans: EntityTable<CachedScan, "key">;
};

db.version(1).stores({
  areas: "id, createdAt",
  scans: "key, fetchedAt",
});
