"use client";

import { AnimatePresence, motion } from "motion/react";
import { ChevronDownIcon, CrosshairIcon, ExternalLinkIcon, NewspaperIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  aqiBand,
  compassName,
  FIRE_STATUS_COLOR,
  FIRE_STATUS_LABEL,
  FIRE_STATUS_ORDER,
  THREAT_COLOR,
  THREAT_LABEL,
  wibTime,
  aqiTextColor,
} from "@/lib/gambut";
import type { DangerArea } from "@/lib/dangerAreas";

export const fmt = (n: number, digits = 0) =>
  n.toLocaleString("id-ID", { maximumFractionDigits: digits, minimumFractionDigits: digits });

/** Burned-area growth per forecast hour as bars; the current timeline hour is highlighted. */
export function HourBars({
  values,
  hourOffset,
  height = 40,
  label,
}: {
  values: number[];
  hourOffset: number;
  height?: number;
  label: string;
}) {
  const max = Math.max(1e-6, ...values);
  return (
    <div>
      <div className="flex items-end gap-0.5" style={{ height }} role="img" aria-label={label}>
        {values.map((v, h) => (
          <motion.span
            key={h}
            className={`flex-1 rounded-t-sm ${h === hourOffset ? "bg-red-400" : "bg-red-500/45"}`}
            initial={{ height: 0 }}
            animate={{ height: `${Math.max(4, (v / max) * 100)}%` }}
            transition={{ delay: h * 0.025, duration: 0.35, ease: "easeOut" }}
            title={`t+${h} jam: ${fmt(v, 1)} ha`}
          />
        ))}
      </div>
      <div className="mt-0.5 flex justify-between text-[9px] text-muted-foreground">
        <span>kini</span>
        <span>+6 j</span>
        <span>+12 j</span>
      </div>
    </div>
  );
}

/** Stacked bar of fire statuses. */
export function StatusBar({ byStatus }: { byStatus: DangerArea["byStatus"] }) {
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="flex h-1.5 overflow-hidden rounded-full bg-slate-800" aria-hidden>
      {FIRE_STATUS_ORDER.map((s) =>
        byStatus[s] > 0 ? (
          <motion.span
            key={s}
            initial={{ width: 0 }}
            animate={{ width: `${(byStatus[s] / total) * 100}%` }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            style={{ background: FIRE_STATUS_COLOR[s] }}
          />
        ) : null,
      )}
    </div>
  );
}

export function DangerAreaList({
  areas,
  hourOffset,
  onFocus,
}: {
  areas: DangerArea[];
  hourOffset: number;
  onFocus: (incidentId: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const openId = open ?? areas[0]?.id ?? null;

  return (
    <section className="space-y-2" aria-label="Area berbahaya">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Area Berbahaya ({areas.length})
        </h2>
        <span className="text-[10px] text-muted-foreground">urut: tingkat bahaya</span>
      </div>
      {areas.length === 0 && (
        <p className="rounded-md border border-white/10 bg-slate-950/60 px-3 py-4 text-center text-xs text-muted-foreground">
          Belum ada area tersimulasi di peta ini.
        </p>
      )}
      {areas.map((a, idx) => (
        <AreaCard
          key={a.id}
          area={a}
          rank={idx + 1}
          open={a.id === openId}
          onToggle={() => setOpen(a.id === openId ? "__none__" : a.id)}
          hourOffset={hourOffset}
          onFocus={onFocus}
        />
      ))}
    </section>
  );
}

function AreaCard({
  area: a,
  rank,
  open,
  onToggle,
  hourOffset,
  onFocus,
}: {
  area: DangerArea;
  rank: number;
  open: boolean;
  onToggle: () => void;
  hourOffset: number;
  onFocus: (incidentId: string) => void;
}) {
  const worst = a.villages.find((v) => v.threatLevel !== "AMAN") ?? null;
  const band = a.air?.usAqi != null ? aqiBand(a.air.usAqi) : null;

  return (
    <div className="rounded-lg border border-white/10 bg-slate-950/60">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start gap-2 p-2.5 text-left focus-visible:outline-2 focus-visible:outline-sky-400"
      >
        <span className="mt-0.5 w-5 shrink-0 text-xs font-bold tabular-nums text-muted-foreground">{rank}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold">{a.regency}</span>
          <span className="block truncate text-[10px] text-muted-foreground">
            {[a.province, a.inIndonesia ? null : a.country].filter(Boolean).join(" · ") || "wilayah sedang dicari"}
            {" · "}
            {a.incidents.length} titik · {fmt(a.areaHaByHour[12], 0)} ha di +12 j
          </span>
          <span className="mt-1.5 block">
            <StatusBar byStatus={a.byStatus} />
          </span>
          <span className="mt-1 flex flex-wrap gap-x-2 text-[10px]">
            {worst && (
              <span style={{ color: THREAT_COLOR[worst.threatLevel] }}>
                {THREAT_LABEL[worst.threatLevel]}: {worst.name}
              </span>
            )}
            {band && <span style={{ color: aqiTextColor(a.air!.usAqi!) }}>AQI {Math.round(a.air!.usAqi!)}</span>}
            {a.news.length > 0 && <span className="text-sky-300">{a.news.length} berita</span>}
          </span>
        </span>
        <ChevronDownIcon
          className={`mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="space-y-3 border-t border-white/10 p-2.5">
              <HourBars
                values={a.areaHaByHour}
                hourOffset={hourOffset}
                label={`Proyeksi luas terbakar ${a.regency} per jam`}
              />

              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                <Row k="Luas kini / +12 j" v={`${fmt(a.areaHaNow, 1)} / ${fmt(a.areaHaByHour[12], 1)} ha`} />
                <Row k="Total FRP" v={`${fmt(a.totalFrp)} MW`} />
                <Row
                  k="Warga zona bahaya"
                  v={a.peopleDanger === null ? "dihitung..." : `${fmt(a.peopleDanger)} jiwa`}
                />
                <Row
                  k="Warga di jalur asap"
                  v={a.peopleSmoke === null ? "dihitung..." : `${fmt(a.peopleSmoke)} jiwa`}
                />
                <Row k="Kualitas udara" v={band ? `AQI ${Math.round(a.air!.usAqi!)} ${band.label}` : "-"} />
                <Row k="PM2.5" v={a.air?.pm25 != null ? `${fmt(a.air.pm25)} µg/m³` : "-"} />
                <Row k="Biomassa terbakar" v={`${fmt(a.biomassTph)} t/jam`} />
                <Row k="Emisi CO₂" v={`${fmt(a.emissionsTph.co2)} t/jam`} />
                <Row k="Emisi CO" v={`${fmt(a.emissionsTph.co, 1)} t/jam`} />
                <Row k="Emisi PM2.5" v={`${fmt(a.emissionsTph.pm25, 2)} t/jam`} />
                <Row k="Sekat bakar total" v={`${fmt(a.firebreakKm, 1)} km`} />
                <Row k="Regu dibutuhkan" v={fmt(a.crews)} />
              </dl>

              <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                {FIRE_STATUS_ORDER.map((s) => (
                  <li key={s} className="flex items-center gap-1">
                    <span className="size-1.5 rounded-full" style={{ background: FIRE_STATUS_COLOR[s] }} />
                    {a.byStatus[s]} {FIRE_STATUS_LABEL[s].toLowerCase()}
                  </li>
                ))}
              </ul>

              {band && <p className="text-[11px] leading-snug text-slate-300">{band.advice}</p>}

              {a.villages.length > 0 && (
                <div>
                  <p className="mb-1 text-[10px] font-semibold text-muted-foreground uppercase">
                    Desa & arah evakuasi
                  </p>
                  <table className="w-full text-[11px]">
                    <tbody>
                      {a.villages.slice(0, 12).map((v) => (
                        <tr key={v.name} className="border-t border-white/5">
                          <td className="py-1 pr-1">
                            <span className="flex items-center gap-1.5">
                              <span
                                className="size-2 shrink-0 rounded-full"
                                style={{ background: THREAT_COLOR[v.threatLevel] }}
                              />
                              <span className="truncate">{v.name}</span>
                            </span>
                          </td>
                          <td className="py-1 text-right tabular-nums text-muted-foreground">
                            {Number.isFinite(v.etaMinutes) ? `${fmt(v.etaMinutes)} mnt` : "> 48 j"}
                          </td>
                          <td className="py-1 pl-2 text-right text-emerald-300">
                            ke {compassName(v.evacuationBearingDeg)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div>
                <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-muted-foreground uppercase">
                  <NewspaperIcon className="size-3" /> Berita tentang {a.regency}
                </p>
                {!a.inIndonesia ? (
                  <p className="text-[11px] text-muted-foreground">Berita hanya dicari untuk wilayah Indonesia.</p>
                ) : a.news.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">Belum ada berita karhutla 30 hari terakhir.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {a.news.map((n) => (
                      <li key={n.id}>
                        <a
                          href={n.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group flex gap-1.5 text-[11px] leading-snug text-slate-200 hover:text-sky-300"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="line-clamp-2 group-hover:underline">{n.title}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {n.source} · {new Date(n.publishedAt).toLocaleDateString("id-ID")}{" "}
                              {wibTime(n.publishedAt)}
                            </span>
                          </span>
                          <ExternalLinkIcon className="mt-0.5 size-3 shrink-0 opacity-60" />
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <Button
                size="sm"
                variant="outline"
                className="w-full text-xs"
                onClick={() => onFocus(a.villages[0]?.incidentId ?? a.incidents[0].id)}
              >
                <CrosshairIcon className="size-3.5" />
                Fokus peta ke area ini
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[10px] text-muted-foreground">{k}</dt>
      <dd className="truncate font-semibold tabular-nums">{v}</dd>
    </div>
  );
}
