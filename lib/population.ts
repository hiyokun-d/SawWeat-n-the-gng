/**
 * Residents inside a polygon from WorldPop (api.worldpop.org, dataset
 * wpgppop: 100 m gridded population, latest year available on the stats
 * service). Server-only. The service takes one plain Polygon per request.
 */

const WORLDPOP_URL = "https://api.worldpop.org/v1/services/stats";
const TASKS_URL = "https://api.worldpop.org/v1/tasks";
export const WORLDPOP_YEAR = 2020;
const TIMEOUT_MS = 45_000;

interface WorldPopReply {
  status?: string;
  error?: boolean;
  error_message?: string | null;
  taskid?: string;
  data?: { total_population?: number };
}

async function getJson(url: string, deadline: number): Promise<WorldPopReply> {
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(Math.max(1_000, deadline - Date.now())),
  });
  if (!res.ok) throw new Error(`WorldPop HTTP ${res.status}`);
  return (await res.json()) as WorldPopReply;
}

/**
 * Async task mode: the synchronous mode can hang for minutes when the service
 * is busy, while creating a task answers at once and finishes in seconds.
 */
export async function populationInRing(ring: [number, number][]): Promise<number> {
  const deadline = Date.now() + TIMEOUT_MS;
  const geojson = JSON.stringify({
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } }],
  });
  const params = new URLSearchParams({
    dataset: "wpgppop",
    year: String(WORLDPOP_YEAR),
    geojson,
    runasync: "true",
  });
  let reply = await getJson(`${WORLDPOP_URL}?${params}`, deadline);
  while (reply.status !== "finished") {
    if (reply.error) throw new Error(reply.error_message ?? "WorldPop error");
    if (!reply.taskid || Date.now() > deadline) throw new Error("WorldPop tidak selesai tepat waktu");
    await new Promise((r) => setTimeout(r, 1_000));
    reply = await getJson(`${TASKS_URL}/${reply.taskid}`, deadline);
  }
  const total = reply.data?.total_population;
  if (typeof total !== "number") throw new Error("WorldPop tidak mengirim jumlah penduduk");
  return Math.round(total);
}
