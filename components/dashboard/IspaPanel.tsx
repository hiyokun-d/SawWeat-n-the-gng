"use client";

import { motion } from "motion/react";
import { ExternalLinkIcon, StethoscopeIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cellKey, type ZonePopulation } from "@/hooks/useIncidents";
import { trackedJson } from "@/lib/apiHealth";
import { reportedSeries, ISPA_SOURCES, type IspaPayload } from "@/lib/ispa";
import type { HotspotIncident } from "@/lib/gambut";
import { fmt } from "./DangerAreas";

const REFRESH_MS = 30 * 60_000;

function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00+07:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" });
}

/**
 * ISPA from karhutla smoke: what Kemenkes and local health offices reported
 * (real counts, linked), and a day-by-day model of extra cases among residents
 * in the monitored smoke plumes. The two are kept apart and labeled.
 */
export function IspaPanel({
  incidents,
  population,
}: {
  incidents: HotspotIncident[];
  population: Record<string, ZonePopulation>;
}) {
  // Largest counted smoke plume per 0.5-degree area: overlapping plumes are not summed
  const cells = useMemo(() => {
    const byCell = new Map<string, number>();
    for (const i of incidents) {
      const smoke = population[i.id]?.smoke;
      if (!i.inIndonesia || !smoke) continue;
      const k = cellKey(i.originLat, i.originLng);
      byCell.set(k, Math.max(byCell.get(k) ?? 0, smoke));
    }
    return [...byCell.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      // Rounded so a recount that moves a plume by a few residents does not refetch
      .map(([k, n]) => `${k},${Math.round(n / 1000) * 1000}`)
      .join(";");
  }, [incidents, population]);

  const [state, setState] = useState<{ key: string; data: IspaPayload | null; error: string | null } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), REFRESH_MS);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      trackedJson<IspaPayload & { error?: string }>("ispa", `/api/ispa?cells=${encodeURIComponent(cells)}`, {
        isOk: (j) => j.ok === true,
        count: (j) => j.reports?.length ?? null,
      })
        .then((data) => !cancelled && setState({ key: cells, data, error: data.ok ? null : (data.error ?? "Data ISPA belum tersedia") }))
        .catch((err) => !cancelled && setState({ key: cells, data: null, error: err instanceof Error ? err.message : "Gagal memuat ISPA" }));
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [cells, tick]);

  // Every headcount came back empty: WorldPop is down, not slow
  const pops = Object.values(population);
  const worldPopDown = pops.length > 0 && pops.every((p) => p.smoke === null);
  const data = state?.data ?? null;
  const series = useMemo(() => (data ? reportedSeries(data.reports) : []), [data]);
  const latest = series.at(-1) ?? null;
  const local = useMemo(
    () => (data?.reports ?? []).filter((r) => r.scope === "local" && !r.underFive).slice(0, 5),
    [data],
  );
  const days = data?.model.days ?? [];
  const maxCases = Math.max(1, ...days.map((d) => d.high));

  return (
    <section className="space-y-2.5" aria-labelledby="ispa-heading">
      <h2 id="ispa-heading" className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        <StethoscopeIcon className="size-3.5 text-rose-400" aria-hidden />
        ISPA akibat asap
      </h2>

      {!state && (
        <p className="rounded-md border border-white/10 bg-slate-950/60 px-3 py-3 text-xs text-muted-foreground">
          Memuat laporan Kemenkes dan PM2.5 harian...
        </p>
      )}
      {state?.error && !data?.reports.length && (
        <p className="rounded-md border border-orange-500/30 bg-orange-950/30 px-3 py-3 text-xs text-orange-200">{state.error}</p>
      )}

      {/* Reported: the Ministry's running total and the daily rise between its reports */}
      {latest && (
        <div className="rounded-lg border border-white/10 bg-slate-950/60 p-3">
          <p className="text-[10px] text-muted-foreground">Dilaporkan Kemenkes, wilayah terdampak karhutla</p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums text-rose-300">{fmt(latest.total)}</p>
          <p className="text-[11px] text-slate-300">
            kasus kumulatif, dipublikasikan {dayLabel(latest.date)}
            {latest.perDay !== null && (
              <>
                {" "}· <span className="font-semibold text-rose-200">+{fmt(latest.perDay)}/hari</span> sejak laporan sebelumnya
              </>
            )}
          </p>
          {series.length > 1 && (
            <ol className="mt-2 space-y-0.5 text-[10px] text-muted-foreground">
              {series.map((d) => (
                <li key={d.date} className="flex justify-between gap-2 tabular-nums">
                  <a href={d.report.url} target="_blank" rel="noopener noreferrer" className="hover:text-slate-200 hover:underline">
                    {dayLabel(d.date)} · {d.report.source}
                  </a>
                  <span>
                    {fmt(d.total)}
                    {d.perDay !== null ? ` (+${fmt(d.perDay)}/hari)` : ""}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <p className="mt-2 text-[10px] text-muted-foreground">
            Angka dibaca dari judul berita yang mengutip Kemenkes; tidak ada nilai yang diisi di antara laporan.
          </p>
        </div>
      )}

      {local.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] text-muted-foreground">Laporan daerah terbaru</p>
          <ul className="space-y-1">
            {local.map((r) => (
              <li key={`${r.url}|${r.count}`}>
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-2 rounded-md px-1.5 py-1 text-[11px] hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-sky-400"
                >
                  <span className="w-14 shrink-0 text-right font-semibold tabular-nums text-rose-200">{fmt(r.count)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-slate-200">{r.title}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {r.source} · {dayLabel(r.publishedAt.slice(0, 10))}
                    </span>
                  </span>
                  <ExternalLinkIcon className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Modeled: extra cases per day among residents in the monitored smoke plumes */}
      {data && (
        <div className="rounded-lg border border-white/10 bg-slate-950/60 p-3">
          <p className="text-[10px] text-muted-foreground">Model: kasus tambahan per hari di jalur asap yang dipantau</p>
          {days.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {cells
                ? "PM2.5 harian belum tersedia untuk area ini."
                : worldPopDown
                  ? "WorldPop tidak merespons, jadi warga di jalur asap belum terhitung; model tampil begitu hitungan masuk."
                  : "Menunggu hitungan penduduk WorldPop di jalur asap."}
            </p>
          ) : (
            <>
              <div className="mt-2 flex h-20 items-end gap-1" role="img" aria-label="Perkiraan kasus ISPA tambahan per hari">
                {days.map((d, i) => (
                  <div key={d.date} className="relative flex h-full flex-1 flex-col justify-end" title={`${dayLabel(d.date)}${d.forecast ? " (prakiraan)" : ""}: ${fmt(d.cases)} kasus (${fmt(d.low)}–${fmt(d.high)}), PM2.5 maks ${d.maxPm25} µg/m³`}>
                    {/* Light band: the dose-response 95% CI; solid bar: the central estimate */}
                    <span className="absolute inset-x-0 bottom-0 rounded-t-sm bg-rose-500/15" style={{ height: `${(d.high / maxCases) * 100}%` }} />
                    <motion.span
                      className={`relative rounded-t-sm ${d.forecast ? "border border-dashed border-rose-400/70 bg-rose-500/25" : "bg-rose-500/70"}`}
                      initial={{ height: 0 }}
                      animate={{ height: `${Math.max(3, (d.cases / maxCases) * 100)}%` }}
                      transition={{ delay: i * 0.04, duration: 0.4, ease: "easeOut" }}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-0.5 flex justify-between text-[9px] text-muted-foreground">
                <span>{dayLabel(days[0].date)}</span>
                <span>garis putus: prakiraan</span>
                <span>{dayLabel(days[days.length - 1].date)}</span>
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                Konservatif: hanya {fmt(data.model.residents)} warga di jalur asap {data.model.areas} area yang dipantau, bukan
                seluruh provinsi. Risiko +0,50% per 10 µg/m³ PM2.5 di atas 15 µg/m³ (WHO 2021) dari{" "}
                <a href={ISPA_SOURCES.rr.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-slate-200">
                  {ISPA_SOURCES.rr.label}
                </a>
                ; laju dasar dari{" "}
                <a href={ISPA_SOURCES.baseline.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-slate-200">
                  7,9 juta kasus Jan–Agu 2025
                </a>{" "}
                dan {ISPA_SOURCES.population.label}; PM2.5 harian Copernicus CAMS. Pada asap gambut yang sangat pekat model ini
                cenderung terlalu rendah.
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
