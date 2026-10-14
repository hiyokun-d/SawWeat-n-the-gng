"use client";

import { useEffect, useState, useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ExternalLinkIcon, NewspaperIcon, RefreshCwIcon, SearchIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { NewsArticle } from "@/app/api/news/route";
import { wibTime } from "@/lib/gambut";

export interface NewsPortalModalProps {
  open: boolean;
  onClose: () => void;
  articles: NewsArticle[];
  loading?: boolean;
  onRefresh?: () => Promise<void>;
  updatedAt?: string;
}

export default function NewsPortalModal({
  open,
  onClose,
  articles,
  loading = false,
  onRefresh,
  updatedAt,
}: NewsPortalModalProps) {
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const filteredArticles = useMemo(() => {
    if (!search.trim()) return articles;
    const q = search.toLowerCase();
    return articles.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.source.toLowerCase().includes(q) ||
        a.snippet.toLowerCase().includes(q),
    );
  }, [articles, search]);

  return (
    <AnimatePresence>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="news-modal-title"
          aria-describedby="news-modal-desc"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 10 }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            className="relative flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 text-slate-100 shadow-2xl"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-slate-800/80 px-4 py-3 sm:px-6">
              <div className="flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400">
                  <NewspaperIcon className="size-4" />
                </div>
                <div>
                  <h2 id="news-modal-title" className="text-sm font-bold sm:text-base">
                    Portal Berita Karhutla &amp; BMKG
                  </h2>
                  <p id="news-modal-desc" className="text-[11px] text-slate-400">
                    Pembaruan informasi kebakaran hutan, lahan gambut, dan cuaca terkini
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                {onRefresh && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => void onRefresh()}
                    disabled={loading}
                    aria-label="Segarkan berita"
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-400 hover:text-slate-100 focus-visible:ring-2 focus-visible:ring-sky-400"
                  >
                    <RefreshCwIcon className={`size-4 ${loading ? "animate-spin" : ""}`} />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onClose}
                  aria-label="Tutup jendela berita"
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-400 hover:text-slate-100 focus-visible:ring-2 focus-visible:ring-sky-400"
                >
                  <XIcon className="size-4" />
                </Button>
              </div>
            </div>

            <div className="shrink-0 border-b border-slate-800/60 bg-slate-900/40 px-4 py-2 sm:px-6">
              <div className="relative">
                <SearchIcon className="absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-slate-500" />
                <Input
                  type="text"
                  placeholder="Cari berita berdasarkan judul, topik, atau media..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Cari artikel berita"
                  className="h-9 border-slate-800 bg-slate-950/80 pl-9 text-xs placeholder:text-slate-500 focus-visible:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-400"
                />
              </div>
            </div>

            <ScrollArea className="min-h-0 flex-1 px-4 py-3 sm:px-6">
              {loading && articles.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-xs text-slate-400">
                  <RefreshCwIcon className="mb-2 size-5 animate-spin text-sky-400" />
                  <span>Memuat arsip berita dari sumber resmi BMKG dan media...</span>
                </div>
              ) : filteredArticles.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400">
                  {search.trim() ? (
                    <p>Tidak ada artikel yang cocok dengan pencarian &quot;{search}&quot;.</p>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <p>Belum ada artikel berita karhutla yang tersedia saat ini.</p>
                      {onRefresh && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void onRefresh()}
                          className="min-h-[44px] px-4 text-xs"
                        >
                          Segarkan Ulang
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-2.5 pb-2">
                  {filteredArticles.map((article) => (
                    <article
                      key={article.id}
                      className="group rounded-xl border border-slate-800/80 bg-slate-900/50 p-3.5 transition-colors hover:border-slate-700 hover:bg-slate-900/90"
                    >
                      <div className="mb-1.5 flex flex-wrap items-center gap-2">
                        <Badge
                          variant="outline"
                          className="border-sky-500/30 bg-sky-500/10 px-2 py-0 text-[10px] font-medium text-sky-300"
                        >
                          {article.source}
                        </Badge>
                        <time dateTime={article.publishedAt} className="text-[10px] text-slate-400">
                          {wibTime(article.publishedAt)}
                        </time>
                      </div>
                      <h3 className="text-xs font-semibold leading-snug text-slate-200 group-hover:text-sky-300 sm:text-sm">
                        <a
                          href={article.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 focus-visible:underline focus-visible:outline-none"
                        >
                          <span>{article.title}</span>
                          <ExternalLinkIcon className="size-3 shrink-0 opacity-70" />
                        </a>
                      </h3>
                      <p className="mt-1 text-xs leading-relaxed text-slate-400 line-clamp-2">
                        {article.snippet}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </ScrollArea>

            <div className="flex shrink-0 items-center justify-between border-t border-slate-800 bg-slate-950 px-4 py-2.5 text-[10px] text-slate-400 sm:px-6">
              <span>Sumber: Google News RSS &amp; BMKG Media Network</span>
              {updatedAt && <span>Diperbarui: {wibTime(updatedAt)}</span>}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
