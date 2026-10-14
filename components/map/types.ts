import type { HotspotIncident } from "@/lib/gambut";
import type { MapStyleId } from "@/lib/basemaps";

export interface GambutMapProps {
  incidents: HotspotIncident[];
  selectedId: string | null;
  /** Forecast horizon in hours (0 = nowcast). */
  hourOffset: number;
  /** OpenFreeMap style (MapLibre only; Leaflet always uses OSM raster tiles) */
  mapStyle: MapStyleId;
  onSelectIncident: (id: string) => void;
}

/** Center on the KHG Sungai Kapuas - Sungai Ambawang peat dome, Kubu Raya. */
export const KUBU_RAYA_CENTER: [number, number] = [109.34, -0.245]; // lng, lat
export const KUBU_RAYA_ZOOM = 11;
