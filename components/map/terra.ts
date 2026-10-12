import type { Polygon } from "geojson";
import {
  TerraDraw,
  TerraDrawCircleMode,
  TerraDrawFreehandMode,
  TerraDrawPolygonMode,
  TerraDrawRectangleMode,
  TerraDrawRenderMode,
  TerraDrawExtend,
} from "terra-draw";

const stroke = "#ea580c" as const;
const fill = "#f97316" as const;
const shape = { fillColor: fill, outlineColor: stroke, fillOpacity: 0.2, outlineWidth: 2 };

// Terra Draw is only used for sketching. Once a shape is finished it is handed
// to the parent (persisted in Dexie) and cleared; saved areas are drawn by the map itself.
export function createTerraDraw(
  adapter: TerraDrawExtend.TerraDrawBaseAdapter,
  onFinish: (geometry: Polygon) => void,
) {
  const draw = new TerraDraw({
    adapter,
    modes: [
      new TerraDrawRenderMode({ modeName: "static", styles: {} }),
      new TerraDrawPolygonMode({ styles: { ...shape, closingPointColor: stroke } }),
      new TerraDrawRectangleMode({ styles: shape }),
      new TerraDrawCircleMode({ styles: shape }),
      new TerraDrawFreehandMode({ styles: shape }),
    ],
  });

  draw.on("finish", (id) => {
    const feature = draw.getSnapshotFeature(id);
    if (feature?.geometry.type === "Polygon") onFinish(feature.geometry as Polygon);
    // Clearing synchronously inside the finish callback confuses the active mode
    setTimeout(() => draw.clear(), 0);
  });

  return draw;
}
