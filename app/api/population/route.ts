import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { populationInRing, WORLDPOP_YEAR } from "@/lib/population";

const MAX_ZONES = 40;
// WorldPop runs each zone as an async task; ten in flight finish a 40-zone batch in a few rounds
const CONCURRENCY = 10;
const CACHE_MS = 6 * 3600_000;
const cache = new Map<string, { at: number; people: number }>();

// WorldPop is slow and sometimes unreachable for minutes; headcounts it did return are kept on
// disk so a server restart (or a video recording run) does not have to ask again
const CACHE_FILE = path.join(process.cwd(), ".cache", "population.json");
let loaded: Promise<void> | null = null;
function loadDisk() {
  loaded ??= readFile(CACHE_FILE, "utf8")
    .then((text) => {
      const now = Date.now();
      for (const [k, v] of Object.entries(JSON.parse(text) as Record<string, { at: number; people: number }>)) {
        if (now - v.at < CACHE_MS && !cache.has(k)) cache.set(k, v);
      }
    })
    .catch(() => {});
  return loaded;
}
async function saveDisk() {
  try {
    await mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify(Object.fromEntries(cache)));
  } catch {
    // Disk cache is an optimization only
  }
}

const BodySchema = z.object({
  zones: z
    .array(
      z.object({
        id: z.string().max(80),
        ring: z.array(z.tuple([z.number(), z.number()])).min(4).max(64),
      }),
    )
    .max(MAX_ZONES),
});

/** Same shape rounded to ~100 m shares a cache entry (WorldPop's own resolution). */
function shapeKey(ring: [number, number][]): string {
  return ring.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`).join(";");
}

/**
 * Residents inside each zone (danger zone around a fire, smoke plume) from
 * WorldPop. POST { zones: [{ id, ring: [[lng, lat], ...] }] }.
 */
export async function POST(request: Request) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Payload zona tidak valid" }, { status: 400 });
  }

  await loadDisk();
  const started = Date.now();
  const now = Date.now();
  const results: Record<string, number | null> = {};
  const todo = parsed.data.zones.filter((z) => {
    const hit = cache.get(shapeKey(z.ring));
    if (hit && now - hit.at < CACHE_MS) {
      results[z.id] = hit.people;
      return false;
    }
    return true;
  });

  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    await Promise.all(
      todo.slice(i, i + CONCURRENCY).map(async (z) => {
        try {
          const people = await populationInRing(z.ring);
          cache.set(shapeKey(z.ring), { at: Date.now(), people });
          results[z.id] = people;
        } catch {
          results[z.id] = null;
        }
      }),
    );
  }

  if (todo.some((z) => results[z.id] !== null)) void saveDisk();
  const answered = Object.values(results).some((v) => v !== null);
  return Response.json(
    // ok=false when WorldPop answered nothing, so the client's feed health shows the outage
    { ok: answered || parsed.data.zones.length === 0, year: WORLDPOP_YEAR, results, ...(answered ? {} : { error: "WorldPop tidak merespons" }) },
    { headers: todo.length > 0 ? { "x-upstream-ms": String(Date.now() - started) } : {} },
  );
}
