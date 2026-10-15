import type { AirQuality, HotspotIncident } from "@/lib/gambut";
import type { MapStyleId } from "@/lib/basemaps";
import type { Bbox, MapHotspot } from "@/hooks/useIncidents";

export interface GambutMapProps {
  /** Simulated incidents (spread polygons, firebreak, wind arrows). */
  incidents: HotspotIncident[];
  /** Every fire event worldwide; Indonesia is drawn larger. */
  hotspots: MapHotspot[];
  /** Air quality per 0.5-degree area (key "lat,lng" of the area center). */
  air: Record<string, AirQuality>;
  selectedId: string | null;
  /** Set when a person picks a fire; the camera flies to it. */
  focusId: string | null;
  /** Scripted camera move (presentation mode); a new `seq` triggers the flight. */
  camera?: CameraShot | null;
  /** Hide the map's own toolbar (presentation mode). */
  chromeless?: boolean;
  /** Forecast horizon in hours (0 = nowcast). */
  hourOffset: number;
  /** OpenFreeMap style (MapLibre only; Leaflet always uses OSM raster tiles) */
  mapStyle: MapStyleId;
  onSelectIncident: (id: string) => void;
  /** Visible area after every pan/zoom; drives which fires get simulated. */
  onViewportChange: (bbox: Bbox) => void;
}

/** Center on the KHG Sungai Kapuas - Sungai Ambawang peat dome, Kubu Raya. */
export const KUBU_RAYA_CENTER: [number, number] = [109.34, -0.245]; // lng, lat
export const KUBU_RAYA_ZOOM = 11;

/** Whole-Indonesia view, the app's home camera. */
export const INDONESIA_CENTER: [number, number] = [117.5, -2.5];
export const INDONESIA_ZOOM = 4.2;

export interface CameraShot {
  seq: number;
  center: [number, number];
  zoom: number;
  pitch?: number;
  bearing?: number;
  /** Flight time in ms; 0 jumps (reduced motion). */
  duration: number;
}
