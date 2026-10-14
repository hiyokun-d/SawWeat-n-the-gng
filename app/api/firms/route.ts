import { NextResponse } from "next/server";
import { dedupeFirmsFires, fetchFirmsFires } from "@/lib/firms";
import { FIRMS_BBOX, FIRMS_ATTRIBUTION } from "@/lib/gambut";

/**
 * NASA FIRMS proxy: real satellite fire detections (VIIRS near-real-time)
 * around the KHG Sungai Kapuas - Sungai Ambawang area.
 *
 * Requires MAP_KEY in the environment (free key from
 * https://firms.modaps.eosdis.nasa.gov/api/). Without it the route reports
 * configured: false and the app keeps its simulated seed scenario.
 */
export async function GET(request: Request) {
  // Reading the request URL marks this route as dynamic (per-request), so the
  // FIRMS fetch and MAP_KEY lookup are never frozen into the build output.
  new URL(request.url).searchParams.get("refresh");

  const key = process.env.MAP_KEY;

  if (!key) {
    return NextResponse.json({
      configured: false,
      fires: [],
      attribution: FIRMS_ATTRIBUTION,
      reason: "MAP_KEY belum diset di environment",
    });
  }

  try {
    const raw = await fetchFirmsFires(key, FIRMS_BBOX, 3);
    if (raw === null) {
      return NextResponse.json({
        configured: true,
        fires: [],
        attribution: FIRMS_ATTRIBUTION,
        reason: "Gagal menghubungi NASA FIRMS",
      });
    }
    const fires = dedupeFirmsFires(raw).slice(0, 8);
    return NextResponse.json({
      configured: true,
      fires,
      attribution: FIRMS_ATTRIBUTION,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        configured: true,
        fires: [],
        attribution: FIRMS_ATTRIBUTION,
        reason: err instanceof Error ? err.message : "Gagal memuat data FIRMS",
      },
      { status: 502 },
    );
  }
}
