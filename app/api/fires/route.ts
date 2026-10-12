import type { NextRequest } from "next/server";
import { z } from "zod";
import { FiresQuerySchema, type FiresResponse } from "@/lib/fire-types";
import { fetchFirmsFires } from "@/lib/firms";

// GET /api/fires?bbox=west,south,east,north&source=VIIRS_SNPP_NRT&days=1
export async function GET(request: NextRequest) {
  const parsed = FiresQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  }

  const { source, bbox, days } = parsed.data;
  try {
    const fires = await fetchFirmsFires(source, bbox, days);
    const body: FiresResponse = { source, bbox, days, count: fires.length, fires };
    return Response.json(body);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 502 },
    );
  }
}
