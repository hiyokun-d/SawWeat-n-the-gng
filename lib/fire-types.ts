import { z } from "zod";

// Shared between the API route and the client.

export const FIRMS_SOURCES = [
  { id: "VIIRS_SNPP_NRT", label: "VIIRS S-NPP (375m)" },
  { id: "VIIRS_NOAA20_NRT", label: "VIIRS NOAA-20 (375m)" },
  { id: "VIIRS_NOAA21_NRT", label: "VIIRS NOAA-21 (375m)" },
  { id: "MODIS_NRT", label: "MODIS Terra/Aqua (1km)" },
] as const;

export const SourceSchema = z.enum(
  FIRMS_SOURCES.map((s) => s.id) as [string, ...string[]],
);

// west,south,east,north
export const BBoxSchema = z
  .tuple([
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
  ])
  .refine(([w, s, e, n]) => w < e && s < n, "bbox must be west,south,east,north");

export type BBox = z.infer<typeof BBoxSchema>;

export const FiresQuerySchema = z.object({
  source: SourceSchema.default("VIIRS_SNPP_NRT"),
  bbox: z
    .string()
    .transform((v) => v.split(",").map(Number))
    .pipe(BBoxSchema),
  days: z.coerce.number().int().min(1).max(5).default(1),
});

export const FireSchema = z.object({
  id: z.string(),
  lat: z.number(),
  lng: z.number(),
  brightness: z.number(),
  frp: z.number(),
  // VIIRS: l/n/h, MODIS: 0-100 — normalised to low/nominal/high
  confidence: z.enum(["low", "nominal", "high"]),
  acquiredAt: z.string(),
  satellite: z.string(),
  instrument: z.string(),
  daynight: z.enum(["D", "N"]),
});

export type Fire = z.infer<typeof FireSchema>;

export const FiresResponseSchema = z.object({
  source: z.string(),
  bbox: BBoxSchema,
  days: z.number(),
  count: z.number(),
  fires: z.array(FireSchema),
});

export type FiresResponse = z.infer<typeof FiresResponseSchema>;

export function confidenceColor(c: Fire["confidence"]) {
  return c === "high" ? "#dc2626" : c === "nominal" ? "#f97316" : "#facc15";
}

export function fireRadius(frp: number) {
  return Math.min(12, 3 + Math.sqrt(Math.max(frp, 0)));
}
