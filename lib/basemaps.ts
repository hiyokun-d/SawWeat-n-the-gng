// Free, keyless map sources.

// OpenFreeMap vector styles for MapLibre (attribution is embedded in each style)
export const MAP_STYLES = [
  { id: "liberty", label: "Liberty", url: "https://tiles.openfreemap.org/styles/liberty" },
  { id: "bright", label: "Bright", url: "https://tiles.openfreemap.org/styles/bright" },
  { id: "positron", label: "Positron", url: "https://tiles.openfreemap.org/styles/positron" },
] as const;

export type MapStyleId = (typeof MAP_STYLES)[number]["id"];

export function getMapStyle(id: MapStyleId) {
  return MAP_STYLES.find((s) => s.id === id) ?? MAP_STYLES[0];
}

// OpenStreetMap raster tiles for the Leaflet fallback
export const OSM_TILES = {
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19,
};

export const BMKG_ATTRIBUTION = "Data cuaca: BMKG";
