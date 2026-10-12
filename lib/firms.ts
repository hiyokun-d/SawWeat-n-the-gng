import { cacheLife } from "next/cache";
import type { BBox, Fire } from "./fire-types";

const FIRMS_BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv";

function normaliseConfidence(raw: string): Fire["confidence"] {
  const v = raw.trim().toLowerCase();
  if (v === "h" || v === "high") return "high";
  if (v === "l" || v === "low") return "low";
  if (v === "n" || v === "nominal") return "nominal";
  const pct = Number(v);
  if (Number.isFinite(pct)) return pct >= 80 ? "high" : pct >= 30 ? "nominal" : "low";
  return "nominal";
}

function parseCsv(csv: string): Fire[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(",");
  const col = (name: string) => header.indexOf(name);
  const iLat = col("latitude");
  const iLng = col("longitude");
  // VIIRS uses bright_ti4, MODIS uses brightness
  const iBright = col("bright_ti4") >= 0 ? col("bright_ti4") : col("brightness");
  const iDate = col("acq_date");
  const iTime = col("acq_time");
  const iSat = col("satellite");
  const iInst = col("instrument");
  const iConf = col("confidence");
  const iFrp = col("frp");
  const iDn = col("daynight");

  if (iLat < 0 || iLng < 0) {
    // FIRMS returns plain-text errors (e.g. invalid key) with a 200 status
    throw new Error(`Unexpected FIRMS response: ${lines[0].slice(0, 200)}`);
  }

  return lines.slice(1).map((line, i) => {
    const c = line.split(",");
    const time = c[iTime].padStart(4, "0");
    return {
      id: `${c[iDate]}-${time}-${c[iLat]}-${c[iLng]}-${i}`,
      lat: Number(c[iLat]),
      lng: Number(c[iLng]),
      brightness: Number(c[iBright]),
      frp: Number(c[iFrp]),
      confidence: normaliseConfidence(c[iConf]),
      acquiredAt: `${c[iDate]}T${time.slice(0, 2)}:${time.slice(2)}:00Z`,
      satellite: c[iSat],
      instrument: c[iInst],
      daynight: c[iDn] === "N" ? "N" : "D",
    };
  });
}

export async function fetchFirmsFires(source: string, bbox: BBox, days: number): Promise<Fire[]> {
  "use cache";
  cacheLife("minutes");

  const key = process.env.MAP_KEY;
  if (!key) throw new Error("MAP_KEY is not set in .env");

  const area = bbox.map((n) => n.toFixed(4)).join(",");
  const res = await fetch(`${FIRMS_BASE}/${key}/${source}/${area}/${days}`);
  if (!res.ok) throw new Error(`FIRMS request failed: ${res.status} ${res.statusText}`);
  return parseCsv(await res.text());
}
