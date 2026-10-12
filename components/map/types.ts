import type { Polygon } from "geojson";
import type { BBox, Fire } from "@/lib/fire-types";
import type { WatchArea } from "@/lib/db";
import type { BasemapId } from "@/lib/basemaps";

export type DrawMode = "static" | "polygon" | "rectangle" | "circle" | "freehand";

export interface FireMapProps {
  fires: Fire[];
  areas: WatchArea[];
  activeAreaId: string | null;
  drawMode: DrawMode;
  basemap: BasemapId;
  // Bumped by the parent to fly the map to a bbox
  focus: { bbox: BBox; nonce: number } | null;
  onAreaDrawn: (geometry: Polygon) => void;
  onViewportChange: (bbox: BBox) => void;
  onFireClick: (fire: Fire) => void;
}

export const INITIAL_CENTER: [number, number] = [118, -2]; // lng, lat — Indonesia
export const INITIAL_ZOOM = 4;
