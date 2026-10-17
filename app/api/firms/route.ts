import { NextResponse } from "next/server";
import { booleanPointInPolygon, point } from "@turf/turf";
import { deriveHotspotStatus, fetchFirmsFires, fuseHotspots, type FirmsFetchResult } from "@/lib/firms";
import {
  encodeHotspots,
  FIRMS_ATTRIBUTION,
  FIRMS_INDONESIA_DAYS,
  SETTLEMENT_BBOX,
  type FusedHotspot,
} from "@/lib/gambut";
import { getIndonesiaTest, INDONESIA_BBOX } from "@/lib/indonesia";
import { getSettlements, nearestSettlementIndex } from "@/lib/settlements";
import { KHG_SUNGAI_KAPUAS_AMBawang } from "@/data/khgKalbar.geojson";
import { prepareJson, sendJson, type PreparedJson } from "@/lib/http";

// FIRMS refreshes its NRT files every few minutes, but new passes only land a
// few times a day; 10 minutes keeps us far inside the keyed quota.
const CACHE_MS = 10 * 60_000;

interface Snapshot {
  at: number;
  keyed: boolean;
  hotspots: Omit<FusedHotspot, "nearestSettlement">[];
  baseTime: string;
  detections: number;
  sources: FirmsFetchResult["sources"];
}

/** A fire further than this from any mapped village gets its village looked up on selection. */
const VILLAGE_MAX_KM = 30;
let cache: Snapshot | null = null;
/** Encoded + gzipped answer for one snapshot and village list: 52k fires take ~100 ms to encode and compress. */
let body: { snapshot: Snapshot; settlements: unknown; prepared: PreparedJson } | null = null;
let inflight: Promise<Snapshot | null> | null = null;

function inBox(lat: number, lng: number, [w, s, e, n]: readonly number[]) {
  return lng >= w && lng <= e && lat >= s && lat <= n;
}

async function build(key: string | undefined): Promise<Snapshot | null> {
  const result = await fetchFirmsFires({
    key,
    historyBbox: INDONESIA_BBOX,
    historyDays: FIRMS_INDONESIA_DAYS,
  });
  if (!result) return null;

  const inIndonesia = await getIndonesiaTest(5_000);

  const hotspots = fuseHotspots(result.fires).map((h) => {
    const indo = inIndonesia(h.lat, h.lng);
    // "Signal vanished, suspect smoldering" is a peat-fire inference; outside
    // Indonesia a quiet fire keeps its last observed state
    const status =
      !indo && h.status === "SUSPECTED_SMOLDERING"
        ? deriveHotspotStatus(0, 0, h.satellites.length, h.confidence)
        : h.status;
    return {
      ...h,
      status,
      inIndonesia: indo,
      insideKhg: indo && booleanPointInPolygon(point([h.lng, h.lat]), KHG_SUNGAI_KAPUAS_AMBawang),
    };
  });

  let baseMs = Date.now();
  for (const h of hotspots) baseMs = Math.min(baseMs, Date.parse(h.firstSeen));
  return {
    at: Date.now(),
    keyed: Boolean(key),
    hotspots,
    baseTime: new Date(baseMs).toISOString(),
    detections: result.fires.length,
    sources: result.sources,
  };
}

/**
 * NASA FIRMS proxy: every near-real-time satellite (VIIRS S-NPP / NOAA-20 /
 * NOAA-21, MODIS Terra / Aqua) for the whole world, fused into fire events
 * and tagged Indonesia / not Indonesia. MAP_KEY (free, from
 * https://firms.modaps.eosdis.nasa.gov/api/) is optional: it adds three days
 * of history over Indonesia so quiet fires can be flagged as smoldering.
 */
export async function GET(request: Request) {
  // Reading the request URL marks this route as dynamic (per-request), so the
  // FIRMS fetch and MAP_KEY lookup are never frozen into the build output.
  new URL(request.url).searchParams.get("refresh");

  const key = process.env.MAP_KEY?.trim() || undefined;

  // Time spent waiting on NASA in this request; absent when served from cache
  let upstreamMs: number | null = null;
  try {
    if (!cache || Date.now() - cache.at > CACHE_MS) {
      const started = Date.now();
      // One pull at a time; concurrent requests share it
      inflight ??= build(key).finally(() => {
        inflight = null;
      });
      const fresh = await inflight;
      upstreamMs = Date.now() - started;
      // A failed refresh keeps serving the last good pull
      if (fresh) cache = fresh;
    }
    if (!cache) {
      return NextResponse.json({
        ok: false,
        keyed: Boolean(key),
        attribution: FIRMS_ATTRIBUTION,
        reason: "Gagal menghubungi NASA FIRMS.",
      });
    }
    // Villages are attached per request: the OpenStreetMap list may land after the FIRMS pull
    const settlements = await getSettlements(3_000);
    if (!body || body.snapshot !== cache || body.settlements !== settlements) {
      const nearest = nearestSettlementIndex(settlements, undefined, VILLAGE_MAX_KM);
      const withVillages: FusedHotspot[] = cache.hotspots.map((h) => ({
        ...h,
        nearestSettlement: inBox(h.lat, h.lng, SETTLEMENT_BBOX) ? nearest(h.lat, h.lng) : null,
      }));
      body = {
        snapshot: cache,
        settlements,
        prepared: prepareJson({
          ok: true,
          keyed: cache.keyed,
          hotspots: encodeHotspots(withVillages, cache.baseTime),
          detections: cache.detections,
          sources: cache.sources,
          attribution: FIRMS_ATTRIBUTION,
          fetchedAt: new Date(cache.at).toISOString(),
        }),
      };
    }
    return sendJson(request, body.prepared, {
      headers: upstreamMs === null ? {} : { "x-upstream-ms": String(upstreamMs) },
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        keyed: Boolean(key),
        attribution: FIRMS_ATTRIBUTION,
        reason: err instanceof Error ? err.message : "Gagal memuat data FIRMS.",
      },
      { status: 502 },
    );
  }
}
