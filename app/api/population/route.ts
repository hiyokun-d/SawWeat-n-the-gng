import { z } from "zod";
import { populationInRing, WORLDPOP_YEAR } from "@/lib/population";

const MAX_ZONES = 40;
const CONCURRENCY = 4;
const CACHE_MS = 6 * 3600_000;
const cache = new Map<string, { at: number; people: number }>();

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

  return Response.json(
    { ok: true, year: WORLDPOP_YEAR, results },
    { headers: todo.length > 0 ? { "x-upstream-ms": String(Date.now() - started) } : {} },
  );
}
