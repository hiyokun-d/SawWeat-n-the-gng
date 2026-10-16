import { readdir, stat } from "node:fs/promises";
import path from "node:path";

/** Exported presentation videos in public/videos (written by `bun run record`). */
export async function GET(request: Request) {
  new URL(request.url).searchParams.get("refresh");
  const dir = path.join(process.cwd(), "public", "videos");
  try {
    const names = (await readdir(dir)).filter((n) => n.endsWith(".mp4")).sort();
    const videos = await Promise.all(
      names.map(async (name) => {
        const s = await stat(path.join(dir, name));
        return { name, url: `/api/videos/${name}`, bytes: s.size, at: s.mtime.toISOString() };
      }),
    );
    return Response.json({ ok: true, videos }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: true, videos: [] }, { headers: { "Cache-Control": "no-store" } });
  }
}
