import type { Map as MapLibreMap, RasterDEMSourceSpecification } from "maplibre-gl";

// Mapterhorn elevation tiles (keyless). Mirrors https://tiles.mapterhorn.com/tilejson.json —
// declared inline so maxzoom can be capped: global coverage stops at z12 and deeper tiles 404.
const MAPTERHORN_DEM: RasterDEMSourceSpecification = {
  type: "raster-dem",
  tiles: ["https://tiles.mapterhorn.com/{z}/{x}/{y}.webp"],
  encoding: "terrarium",
  tileSize: 512,
  maxzoom: 12,
};
const MAPTERHORN_ATTRIBUTION = "<a href='https://mapterhorn.com/attribution'>&copy; Mapterhorn</a>";

export const TERRAIN_SOURCE = "fw-terrain-dem";
export const HILLSHADE_SOURCE = "fw-hillshade-dem";
export const HILLSHADE_LAYER = "fw-hillshade";
export const TERRAIN_EXAGGERATION = 1.5;

// Separate DEM sources for terrain and hillshade are recommended for performance.
// Hillshade is inserted beneath the first label layer so text stays readable.
export function addTerrainLayers(map: MapLibreMap) {
  // Credit once, on the terrain source
  if (!map.getSource(TERRAIN_SOURCE)) {
    map.addSource(TERRAIN_SOURCE, { ...MAPTERHORN_DEM, attribution: MAPTERHORN_ATTRIBUTION });
  }
  if (!map.getSource(HILLSHADE_SOURCE)) map.addSource(HILLSHADE_SOURCE, MAPTERHORN_DEM);
  if (!map.getLayer(HILLSHADE_LAYER)) {
    const firstSymbol = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
    map.addLayer(
      {
        id: HILLSHADE_LAYER,
        type: "hillshade",
        source: HILLSHADE_SOURCE,
        paint: {
          "hillshade-exaggeration": 0.35,
          "hillshade-shadow-color": "#473b24",
          "hillshade-highlight-color": "#ffffff",
        },
      },
      firstSymbol,
    );
  }
}

export function setTerrainEnabled(map: MapLibreMap, enabled: boolean) {
  map.setTerrain(enabled ? { source: TERRAIN_SOURCE, exaggeration: TERRAIN_EXAGGERATION } : null);
  if (map.getLayer(HILLSHADE_LAYER)) {
    map.setLayoutProperty(HILLSHADE_LAYER, "visibility", enabled ? "visible" : "none");
  }
}
