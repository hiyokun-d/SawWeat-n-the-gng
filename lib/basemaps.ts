// Keyless raster basemaps, shared by the Leaflet and MapLibre maps.
// Each basemap is a stack of tile layers drawn bottom to top (base, then labels).

export interface Basemap {
  id: string;
  label: string;
  attribution: string;
  layers: { url: string; maxZoom: number }[];
}

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
const FIRMS_CREDIT = "Fire data: NASA FIRMS";

export const BASEMAPS = [
  {
    id: "dark",
    label: "Dark",
    attribution: `Tiles &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors | ${FIRMS_CREDIT}`,
    layers: [
      { url: `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, maxZoom: 16 },
      { url: `${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, maxZoom: 16 },
    ],
  },
  {
    id: "satellite",
    label: "Satellite",
    attribution: `Tiles &copy; Esri, Maxar, Earthstar Geographics | ${FIRMS_CREDIT}`,
    layers: [
      { url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, maxZoom: 19 },
      { url: `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, maxZoom: 19 },
    ],
  },
  {
    id: "streets",
    label: "Streets",
    attribution: `&copy; OpenStreetMap contributors | ${FIRMS_CREDIT}`,
    layers: [{ url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", maxZoom: 19 }],
  },
] as const satisfies readonly Basemap[];

export type BasemapId = (typeof BASEMAPS)[number]["id"];

export function getBasemap(id: BasemapId): Basemap {
  return BASEMAPS.find((b) => b.id === id) ?? BASEMAPS[0];
}
