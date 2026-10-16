"use client";

import { DownloadIcon } from "lucide-react";
import { useEffect, useState } from "react";

interface Video {
  name: string;
  url: string;
  bytes: number;
  at: string;
}

const LABEL: Record<string, string> = {
  "gambutwatch-short-landscape.mp4": "60 detik · 16:9 (YouTube)",
  "gambutwatch-short-portrait.mp4": "60 detik · 9:16 (Instagram)",
  "gambutwatch-full-landscape.mp4": "Lengkap · 16:9 (YouTube)",
  "gambutwatch-full-portrait.mp4": "Lengkap · 9:16 (Instagram)",
};

/** Download links for the exported briefing videos; renders nothing until at least one exists. */
export default function VideoDownloads() {
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/api/videos", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ videos?: Video[] }>)
      .then((j) => setVideos(j.videos ?? []))
      .catch(() => setFailed(true));
  }, []);

  if (failed) return <p className="mt-10 text-sm text-slate-400">Daftar video tidak bisa dimuat.</p>;
  if (videos === null) return <p className="mt-10 text-sm text-slate-500">Memeriksa video ekspor...</p>;
  if (videos.length === 0) return null;

  return (
    <section aria-labelledby="videos-heading" className="mt-10">
      <h2 id="videos-heading" className="text-sm font-semibold text-slate-200">
        Unduh video presentasi
      </h2>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {videos.map((v) => (
          <li key={v.name}>
            <a
              href={v.url}
              download
              className="flex min-h-11 items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm transition-colors hover:border-white/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400"
            >
              <DownloadIcon className="size-4 shrink-0 text-orange-400" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-slate-100">{LABEL[v.name] ?? v.name}</span>
                <span className="block text-xs text-slate-400">
                  MP4 · {(v.bytes / 1_048_576).toFixed(1)} MB ·{" "}
                  {new Date(v.at).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
