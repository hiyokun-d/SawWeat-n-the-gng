/**
 * Kesatuan Hidrologis Gambut (KHG) Sungai Kapuas - Sungai Ambawang,
 * Kabupaten Kubu Raya, Kalimantan Barat.
 *
 * Approximate KHG boundary polygon (WGS84, [lng, lat]) for the tactical
 * map overlay. Digitized to cover the Kubu Raya peat dome between the
 * Rasau Jaya villages and the Sungai Ambawang basin; used as the map
 * context layer for burn-polygon rendering.
 */

import type { Feature, Polygon } from "geojson";

export const KHG_SUNGAI_KAPUAS_AMBawang: Feature<Polygon> = {
  type: "Feature",
  properties: {
    khgId: "KHG-SKA-SAW",
    name: "KHG Sungai Kapuas - Sungai Ambawang",
    kabupaten: "Kubu Raya",
    provinsi: "Kalimantan Barat",
    note: "Batas KHG aproksimasi untuk demo",
  },
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [109.12, -0.08],
        [109.3, -0.1],
        [109.48, -0.15],
        [109.58, -0.25],
        [109.62, -0.4],
        [109.5, -0.52],
        [109.3, -0.55],
        [109.15, -0.45],
        [109.08, -0.3],
        [109.06, -0.15],
        [109.12, -0.08],
      ],
    ],
  },
};
