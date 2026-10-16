import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

/**
 * Streams one exported video as a download. Served from a route, not straight from
 * public/, because production only serves public files that existed at build time
 * and the videos are recorded afterwards.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/videos/[name]">) {
  const { name } = await ctx.params;
  // Only our own export names: no path segments, mp4 only
  if (!/^[a-z0-9-]+\.mp4$/.test(name)) return new Response("Not found", { status: 404 });
  const file = path.join(process.cwd(), "public", "videos", name);
  try {
    const s = await stat(file);
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(s.size),
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
