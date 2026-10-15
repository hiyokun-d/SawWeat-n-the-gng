/**
 * Danger areas: simulated fires grouped by kabupaten/kota, with everything
 * known about each area rolled up for the sidebar and the presentation.
 */

import type { Region } from "./geocode";
import type { NewsArticle } from "./news";
import {
  aqiBand,
  FIRE_STATUS_ORDER,
  type AirQuality,
  type FireStatus,
  type HotspotIncident,
  type ThreatLevel,
} from "./gambut";
import { stepPolygonFor } from "./simulationEngine";

/** Biomass burned per MJ of fire radiative energy (Wooster et al. 2005). */
export const KG_PER_MJ = 0.368;
/**
 * Peat fire emission factors, grams per kg of dry fuel burned
 * (Akagi et al. 2011, Atmos. Chem. Phys. 11, 4039, peatland).
 */
export const PEAT_EMISSION_G_PER_KG = { co2: 1563, co: 182, pm25: 9.1 } as const;
/** One ground crew clears about this much firebreak in the prep window (same rule as the briefing). */
export const FIREBREAK_M_PER_CREW = 150;

export interface ThreatenedVillage {
  name: string;
  threatLevel: ThreatLevel;
  etaMinutes: number;
  distanceMeters: number;
  evacuationBearingDeg: number;
  population?: number;
  incidentId: string;
}

export interface DangerArea {
  id: string;
  regency: string;
  province: string | null;
  country: string | null;
  inIndonesia: boolean;
  incidents: HotspotIncident[];
  byStatus: Record<FireStatus, number>;
  totalFrp: number;
  areaHaNow: number;
  /** Projected burned area per timeline hour 0..12 (summed per fire). */
  areaHaByHour: number[];
  villages: ThreatenedVillage[];
  /** WorldPop residents in danger zones / under smoke (summed over looked-up fires). */
  peopleDanger: number | null;
  peopleSmoke: number | null;
  air: AirQuality | null;
  biomassTph: number;
  emissionsTph: { co2: number; co: number; pm25: number };
  firebreakKm: number;
  crews: number;
  news: NewsArticle[];
  /** Higher = more urgent; used for ordering only. */
  score: number;
}

const THREAT_WEIGHT: Record<ThreatLevel, number> = { BAHAYA: 40, SIAGA: 15, WASPADA: 5, AMAN: 0 };

export function buildDangerAreas(input: {
  incidents: HotspotIncident[];
  regions: Record<string, Region | null>;
  areaNews: Record<string, NewsArticle[]>;
  air: Record<string, AirQuality>;
  population: Record<string, { danger: number | null; smoke: number | null }>;
  cellOf: (lat: number, lng: number) => string;
}): DangerArea[] {
  const groups = new Map<string, { region: Region | null; cells: Set<string>; incidents: HotspotIncident[] }>();
  for (const i of input.incidents) {
    const cell = input.cellOf(i.originLat, i.originLng);
    const region = input.regions[cell];
    // Fires whose area is not named yet wait in their own 0.5-degree bucket
    const id = region?.regency ? `${region.regency}|${region.province ?? ""}` : `cell:${cell}`;
    const g = groups.get(id) ?? { region: region ?? null, cells: new Set(), incidents: [] };
    g.cells.add(cell);
    g.incidents.push(i);
    groups.set(id, g);
  }

  const areas: DangerArea[] = [];
  for (const [id, g] of groups) {
    const live = g.incidents.filter((i) => i.status !== "EXTINGUISHED");
    const byStatus = Object.fromEntries(FIRE_STATUS_ORDER.map((s) => [s, 0])) as Record<FireStatus, number>;
    for (const i of g.incidents) byStatus[i.status] += 1;
    const totalFrp = live.reduce((s, i) => s + i.frpMegawatt, 0);
    const areaHaByHour = Array.from({ length: 13 }, (_, h) =>
      live.reduce((s, i) => s + stepPolygonFor(i, h).burnedAreaHa, 0),
    );

    const villages = new Map<string, ThreatenedVillage>();
    for (const i of live) {
      const v = i.nearestVillage;
      if (!v) continue;
      const prev = villages.get(v.name);
      if (prev && prev.etaMinutes <= v.etaMinutes) continue;
      villages.set(v.name, {
        name: v.name,
        threatLevel: v.threatLevel,
        etaMinutes: v.etaMinutes,
        distanceMeters: v.distanceMeters,
        evacuationBearingDeg: v.safeEvacuationBearingDeg,
        population: v.population,
        incidentId: i.id,
      });
    }

    let peopleDanger: number | null = null;
    let peopleSmoke: number | null = null;
    for (const i of live) {
      const p = input.population[i.id];
      if (p?.danger != null) peopleDanger = (peopleDanger ?? 0) + p.danger;
      if (p?.smoke != null) peopleSmoke = (peopleSmoke ?? 0) + p.smoke;
    }

    const airs = [...g.cells].flatMap((c) => (input.air[c]?.usAqi != null ? [input.air[c]] : []));
    const worstAir = airs.reduce<AirQuality | null>((w, a) => (!w || (a.usAqi ?? 0) > (w.usAqi ?? 0) ? a : w), null);

    const biomassTph = (totalFrp * KG_PER_MJ * 3600) / 1000;
    const firebreakM = live.reduce((s, i) => s + i.firebreak.lengthMeters, 0);
    const villageList = [...villages.values()].sort((a, b) => a.etaMinutes - b.etaMinutes);

    const score =
      byStatus.CONFIRMED_FLAMING * 3 +
      byStatus.CONFIRMED_SMOLDERING * 3 +
      byStatus.SUSPECTED_SMOLDERING +
      villageList.reduce((s, v) => s + THREAT_WEIGHT[v.threatLevel], 0) +
      (worstAir?.usAqi ? Math.max(0, worstAir.usAqi - 100) / 10 : 0) +
      totalFrp / 100;

    areas.push({
      id,
      regency: g.region?.regency ?? `Area ${[...g.cells][0]}`,
      province: g.region?.province ?? null,
      country: g.region?.country ?? null,
      inIndonesia: g.incidents.some((i) => i.inIndonesia),
      incidents: g.incidents,
      byStatus,
      totalFrp,
      areaHaNow: areaHaByHour[0],
      areaHaByHour,
      villages: villageList,
      peopleDanger,
      peopleSmoke,
      air: worstAir,
      biomassTph,
      emissionsTph: {
        co2: (biomassTph * PEAT_EMISSION_G_PER_KG.co2) / 1000,
        co: (biomassTph * PEAT_EMISSION_G_PER_KG.co) / 1000,
        pm25: (biomassTph * PEAT_EMISSION_G_PER_KG.pm25) / 1000,
      },
      firebreakKm: firebreakM / 1000,
      crews: Math.ceil(firebreakM / FIREBREAK_M_PER_CREW),
      news: g.region?.regency ? (input.areaNews[g.region.regency] ?? []) : [],
      score,
    });
  }
  // Indonesia first, then urgency
  return areas.sort((a, b) => Number(b.inIndonesia) - Number(a.inIndonesia) || b.score - a.score);
}

export function airLabel(a: AirQuality | null): string {
  return a?.usAqi != null ? `AQI ${Math.round(a.usAqi)} (${aqiBand(a.usAqi).label})` : "belum ada data";
}
