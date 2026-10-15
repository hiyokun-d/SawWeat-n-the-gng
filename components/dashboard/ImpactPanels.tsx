"use client";

import { motion } from "motion/react";
import { CloudFogIcon, HomeIcon, UsersIcon } from "lucide-react";
import {
  AQI_BANDS,
  aqiBand,
  FIRE_STATUS_COLOR,
  FIRE_STATUS_LABEL,
  FIRE_STATUS_ORDER,
  THREAT_COLOR,
  THREAT_LABEL,
  type AirQuality,
  type FireStatus,
  type HotspotIncident,
  type ThreatLevel,
} from "@/lib/gambut";
import { stepPolygonFor } from "@/lib/simulationEngine";
import { cellKey, type HotspotFilter, type ViewStats, type ZonePopulation } from "@/hooks/useIncidents";
import { KG_PER_MJ, PEAT_EMISSION_G_PER_KG, type DangerArea } from "@/lib/dangerAreas";
import { HourBars, fmt } from "./DangerAreas";

const AGE_OPTIONS: { label: string; hours: number | null }[] = [
  { label: "Semua", hours: null },
  { label: "24 jam", hours: 24 },
  { label: "6 jam", hours: 6 },
  { label: "3 jam", hours: 3 },
];

/* ------------------------------------------------------------------ filter */

export function FilterPanel({
  filter,
  onChange,
  shown,
}: {
  filter: HotspotFilter;
  onChange: (f: HotspotFilter) => void;
  /** Fires on the map after filtering. */
  shown: number;
}) {
  const toggleStatus = (status: FireStatus) => {
    const has = filter.statuses.includes(status);
    // Never filter everything away: the last active status cannot be switched off
    if (has && filter.statuses.length === 1) return;
    onChange({
      ...filter,
      statuses: has ? filter.statuses.filter((s) => s !== status) : [...filter.statuses, status],
    });
  };

  return (
    <section className="space-y-2" aria-label="Filter titik api">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Filter Peta
        </h2>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {fmt(shown)} titik tampil
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FIRE_STATUS_ORDER.map((status) => {
          const on = filter.statuses.includes(status);
          return (
            <button
              key={status}
              type="button"
              aria-pressed={on}
              onClick={() => toggleStatus(status)}
              className={`flex min-h-8 items-center gap-1.5 rounded-md border px-2 text-[11px] transition-colors focus-visible:outline-2 focus-visible:outline-sky-400 ${
                on
                  ? "border-white/20 bg-slate-800 text-slate-100"
                  : "border-white/5 bg-transparent text-slate-500 line-through"
              }`}
            >
              <span
                className="inline-block size-2 rounded-full"
                style={{ background: FIRE_STATUS_COLOR[status], opacity: on ? 1 : 0.35 }}
              />
              {FIRE_STATUS_LABEL[status]}
            </button>
          );
        })}
      </div>

      <Segmented
        label="Wilayah"
        options={[
          { label: "Seluruh dunia", value: "all" },
          { label: "Indonesia saja", value: "indonesia" },
        ]}
        value={filter.region}
        onChange={(region) => onChange({ ...filter, region: region as HotspotFilter["region"] })}
      />
      <Segmented
        label="Terdeteksi"
        options={AGE_OPTIONS.map((o) => ({ label: o.label, value: String(o.hours) }))}
        value={String(filter.maxAgeHours)}
        onChange={(v) => onChange({ ...filter, maxAgeHours: v === "null" ? null : Number(v) })}
      />
    </section>
  );
}

function Segmented({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { label: string; value: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[10px] text-muted-foreground">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex flex-1 rounded-md bg-slate-900 p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            onClick={() => onChange(o.value)}
            className={`relative min-h-7 flex-1 rounded px-1.5 text-[11px] transition-colors focus-visible:outline-2 focus-visible:outline-sky-400 ${
              o.value === value ? "text-slate-100" : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {o.value === value && (
              <motion.span
                layoutId={`seg-${label}`}
                className="absolute inset-0 rounded bg-slate-700"
                transition={{ type: "spring", stiffness: 500, damping: 40 }}
              />
            )}
            <span className="relative">{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ impact */

/**
 * Overall impact in view. Fire counts and FRP cover every fire in view;
 * spread, villages and residents cover the simulated ones. Areas are summed
 * per fire, so overlapping projections are counted more than once.
 */
export function ImpactPanel({
  incidents,
  hourOffset,
  air,
  areas,
  viewStats,
  population,
}: {
  incidents: HotspotIncident[];
  hourOffset: number;
  air: Record<string, AirQuality>;
  areas: DangerArea[];
  viewStats: ViewStats;
  population: Record<string, ZonePopulation>;
}) {
  const live = incidents.filter((i) => i.status !== "EXTINGUISHED");
  const byHour = Array.from({ length: 13 }, (_, h) => live.reduce((s, i) => s + stepPolygonFor(i, h).burnedAreaHa, 0));

  const villages = areas.flatMap((a) => a.villages);
  const byLevel = (lvl: ThreatLevel) => villages.filter((v) => v.threatLevel === lvl).length;
  const threatened = villages.filter((v) => v.threatLevel !== "AMAN").sort((a, b) => a.etaMinutes - b.etaMinutes);

  const pops = Object.values(population);
  const peopleDanger = pops.reduce((s, p) => s + (p.danger ?? 0), 0);
  const peopleSmoke = pops.reduce((s, p) => s + (p.smoke ?? 0), 0);

  // Emissions from every fire in view (FRP is known for all of them)
  const biomass = (viewStats.totalFrp * KG_PER_MJ * 3600) / 1000;
  const co2 = (biomass * PEAT_EMISSION_G_PER_KG.co2) / 1000;
  const co = (biomass * PEAT_EMISSION_G_PER_KG.co) / 1000;
  const pm25 = (biomass * PEAT_EMISSION_G_PER_KG.pm25) / 1000;
  const firebreakKm = areas.reduce((s, a) => s + a.firebreakKm, 0);
  const crews = areas.reduce((s, a) => s + a.crews, 0);

  const cells = [...new Set(live.map((i) => cellKey(i.originLat, i.originLng)))];
  const airCells = cells.flatMap((k) => (air[k]?.usAqi != null ? [air[k]] : []));
  const bandCounts = AQI_BANDS.map((band) => ({
    band,
    n: airCells.filter((a) => aqiBand(a.usAqi!) === band).length,
  }));

  return (
    <section className="space-y-3" aria-label="Ringkasan dampak">
      <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Dampak di Area Peta
      </h2>

      <div className="grid grid-cols-3 gap-1.5 text-center">
        <Big label="titik api" value={fmt(viewStats.fires)} />
        <Big label="di Indonesia" value={fmt(viewStats.indonesia)} />
        <Big label="baru (3 jam)" value={fmt(viewStats.fresh)} />
      </div>

      {incidents.length > 0 && (
        <div className="space-y-1.5 rounded-lg border border-white/10 bg-slate-950/60 p-3">
          <p className="text-[10px] text-muted-foreground">
            Luas terproyeksi terbakar ({live.length} titik tersimulasi)
          </p>
          <p className="text-lg font-bold tabular-nums text-red-400">
            {fmt(byHour[hourOffset] ?? 0, 1)} ha{" "}
            <span className="text-xs font-normal text-muted-foreground">pada t+{hourOffset} jam</span>
          </p>
          <HourBars values={byHour} hourOffset={hourOffset} label="Proyeksi luas terbakar per jam" />
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <Stat
          icon={<UsersIcon className="size-3.5" />}
          label="Warga zona bahaya"
          value={pops.length ? fmt(peopleDanger) : "dihitung..."}
          sub={`radius sebaran +12 j + 2 km, ${pops.length} titik teratas (WorldPop)`}
        />
        <Stat
          icon={<CloudFogIcon className="size-3.5" />}
          label="Warga di jalur asap"
          value={pops.length ? fmt(peopleSmoke) : "dihitung..."}
          sub="di bawah kerucut asap saat ini"
        />
        <Stat
          icon={<HomeIcon className="size-3.5" />}
          label="Desa terancam"
          value={fmt(threatened.length)}
          sub={`${byLevel("BAHAYA")} bahaya · ${byLevel("SIAGA")} siaga · ${byLevel("WASPADA")} waspada · ${byLevel("AMAN")} aman`}
        />
        <Stat
          label="Sekat bakar & regu"
          value={`${fmt(firebreakKm, 1)} km`}
          sub={`${fmt(crews)} regu (150 m per regu)`}
        />
        <Stat label="Biomassa terbakar" value={`${fmt(biomass)} t/jam`} sub={`total FRP ${fmt(viewStats.totalFrp)} MW`} />
        <Stat label="Emisi CO₂" value={`${fmt(co2)} t/jam`} sub={`CO ${fmt(co)} t/jam · PM2.5 ${fmt(pm25, 1)} t/jam`} />
      </div>

      <div>
        <p className="mb-1 text-[10px] text-muted-foreground">
          Kualitas udara di {airCells.length} area api
        </p>
        <div className="flex h-2 overflow-hidden rounded-full bg-slate-800" role="img" aria-label="Sebaran kategori AQI">
          {bandCounts.map(({ band, n }) =>
            n > 0 ? (
              <motion.span
                key={band.label}
                initial={{ width: 0 }}
                animate={{ width: `${(n / Math.max(1, airCells.length)) * 100}%` }}
                transition={{ duration: 0.5 }}
                style={{ background: band.color }}
                title={`${band.label}: ${n} area`}
              />
            ) : null,
          )}
        </div>
        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
          {bandCounts
            .filter((b) => b.n > 0)
            .map(({ band, n }) => (
              <li key={band.label} className="flex items-center gap-1">
                <span className="size-1.5 rounded-full" style={{ background: band.color }} />
                {n} {band.label.toLowerCase()}
              </li>
            ))}
        </ul>
      </div>

      <div>
        <p className="mb-1 text-[10px] text-muted-foreground">Status semua titik di area peta</p>
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
          {FIRE_STATUS_ORDER.map((s) => (
            <li key={s} className="flex items-center gap-1">
              <span className="inline-block size-1.5 rounded-full" style={{ background: FIRE_STATUS_COLOR[s] }} />
              {fmt(viewStats.byStatus[s])} {FIRE_STATUS_LABEL[s].toLowerCase()}
            </li>
          ))}
        </ul>
        <p className="mt-1 text-[10px] text-muted-foreground">
          Satelit:{" "}
          {Object.entries(viewStats.bySatellite)
            .sort((a, b) => b[1] - a[1])
            .map(([sat, n]) => `${sat} ${fmt(n)}`)
            .join(" · ")}
          {viewStats.insideKhg > 0 ? ` · ${viewStats.insideKhg} di dalam KHG` : ""}
        </p>
      </div>

      {threatened.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] text-muted-foreground">Desa paling cepat terjangkau api</p>
          <ol className="space-y-1">
            {threatened.slice(0, 8).map((v) => (
              <li key={v.name} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    className="inline-block size-2 shrink-0 rounded-full"
                    style={{ background: THREAT_COLOR[v.threatLevel] }}
                    aria-label={THREAT_LABEL[v.threatLevel]}
                  />
                  <span className="truncate">{v.name}</span>
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {Number.isFinite(v.etaMinutes) ? `${fmt(v.etaMinutes)} mnt` : "> 48 jam"}
                  {v.population ? ` · ${fmt(v.population)} jiwa` : ""}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <p className="text-[10px] leading-snug text-muted-foreground">
        Luas dijumlah per titik (tumpang tindih terhitung ganda). Penduduk: WorldPop 2020. Biomassa: FRP x
        0,368 kg/MJ (Wooster dkk. 2005). Emisi gambut: CO₂ 1.563, CO 182, PM2.5 9,1 g/kg (Akagi dkk. 2011).
      </p>
    </section>
  );
}

function Big({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-900/80 px-1 py-2">
      <p className="text-base font-bold tabular-nums">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-md bg-slate-900/80 p-2">
      <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className="text-sm font-semibold tabular-nums">{value}</p>
      <p className="text-[10px] leading-tight text-muted-foreground">{sub}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ air */

/** Air quality where the selected fire burns, with the 12 h PM2.5 outlook and field advice. */
export function AirCard({ air }: { air: AirQuality | undefined }) {
  if (!air) {
    return <p className="text-xs text-muted-foreground">Memuat kualitas udara area ini...</p>;
  }
  if (air.usAqi === null) {
    return <p className="text-xs text-muted-foreground">Model kualitas udara tidak punya nilai untuk area ini.</p>;
  }
  const band = aqiBand(air.usAqi);
  const series = air.forecast.filter((f) => f.pm25 !== null).slice(0, 13);
  const maxPm = Math.max(1, ...series.map((f) => f.pm25 ?? 0));

  return (
    <div className="space-y-2 rounded-lg border p-3" style={{ borderColor: `${band.color}66` }}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold" style={{ color: band.color }}>
          AQI {Math.round(air.usAqi)} · {band.label}
        </span>
        <span className="text-[10px] text-muted-foreground">Open-Meteo / CAMS</span>
      </div>
      <dl className="grid grid-cols-4 gap-1 text-center text-[10px]">
        {[
          ["PM2.5", air.pm25, "µg/m³"],
          ["PM10", air.pm10, "µg/m³"],
          ["CO", air.co, "µg/m³"],
          ["AOD", air.aod, "asap"],
        ].map(([k, v, unit]) => (
          <div key={k as string} className="rounded bg-slate-900/80 py-1">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="font-semibold tabular-nums">
              {v === null ? "-" : fmt(v as number, (v as number) < 10 ? 1 : 0)}
            </dd>
            <dd className="text-[9px] text-muted-foreground">{unit}</dd>
          </div>
        ))}
      </dl>
      {series.length > 1 && (
        <div>
          <p className="mb-1 text-[10px] text-muted-foreground">PM2.5 12 jam ke depan</p>
          <div className="flex h-10 items-end gap-0.5" role="img" aria-label="Grafik prakiraan PM2.5">
            {series.map((f, i) => (
              <motion.span
                key={f.at}
                className="flex-1 rounded-t-sm"
                style={{ background: aqiBand(f.usAqi ?? 0).color }}
                initial={{ height: 0 }}
                animate={{ height: `${Math.max(6, ((f.pm25 ?? 0) / maxPm) * 100)}%` }}
                transition={{ delay: i * 0.03, duration: 0.4, ease: "easeOut" }}
                title={`+${i} jam: ${fmt(f.pm25 ?? 0, 0)} µg/m³`}
              />
            ))}
          </div>
        </div>
      )}
      <p className="text-[11px] leading-snug text-slate-300">{band.advice}</p>
    </div>
  );
}
