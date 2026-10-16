/**
 * National crisis tracker: everything else hurting Indonesia right now, so
 * the fire picture sits in context. Two kinds of evidence, never mixed up:
 * - official: BMKG earthquakes and GDACS alerts, with their own coordinates;
 * - news: Google News coverage, pinned at the capital of the province the
 *   headline names, and always labeled as news-reported.
 */

export type CrisisKind =
  | "fuel"
  | "flood"
  | "quake"
  | "volcano"
  | "drought"
  | "haze"
  | "food"
  | "power"
  | "outbreak"
  | "cyclone";

export type CrisisBasis = "official" | "news";

export interface CrisisArticle {
  title: string;
  source: string;
  url: string;
  publishedAt: string;
}

export interface CrisisEvent {
  id: string;
  kind: CrisisKind;
  /** Province name; for news events the pin sits at its capital. */
  province: string;
  title: string;
  lat: number;
  lng: number;
  /** Newest report or event time. */
  at: string;
  /** 1 watch, 2 serious, 3 severe. */
  severity: 1 | 2 | 3;
  /** Ranking score (recency-weighted coverage, or official alert level). */
  score: number;
  basis: CrisisBasis;
  source: string;
  url?: string;
  detail?: string;
  articles: CrisisArticle[];
}

export type GovAction = "air" | "weather" | "status" | "law" | "ground" | "policy";

export interface GovResponse extends CrisisArticle {
  id: string;
  action: GovAction;
  province: string | null;
}

export interface PublicVoice extends CrisisArticle {
  id: string;
  /** Who is speaking, from the headline (organization or "warganet"). */
  who: string;
}

export interface FeedStatus {
  id: string;
  label: string;
  ok: boolean;
  count: number;
}

export interface CrisesPayload {
  ok: boolean;
  updatedAt: string;
  events: CrisisEvent[];
  government: GovResponse[];
  voices: PublicVoice[];
  feeds: FeedStatus[];
}

export const CRISIS_LABEL: Record<CrisisKind, { en: string; id: string }> = {
  fuel: { en: "Fuel shortage", id: "Kelangkaan BBM" },
  flood: { en: "Flood & landslide", id: "Banjir & longsor" },
  quake: { en: "Earthquake", id: "Gempa bumi" },
  volcano: { en: "Volcanic activity", id: "Aktivitas gunung api" },
  drought: { en: "Drought & clean water", id: "Kekeringan & air bersih" },
  haze: { en: "Haze & respiratory illness", id: "Kabut asap & ISPA" },
  food: { en: "Food price spike", id: "Lonjakan harga pangan" },
  power: { en: "Power outage", id: "Pemadaman listrik" },
  outbreak: { en: "Disease outbreak", id: "Wabah / KLB" },
  cyclone: { en: "Tropical cyclone", id: "Siklon tropis" },
};

export const GOV_ACTION_LABEL: Record<GovAction, { en: string; id: string }> = {
  air: { en: "Aerial firefighting", id: "Pemadaman udara" },
  weather: { en: "Weather modification", id: "Modifikasi cuaca" },
  status: { en: "Emergency status", id: "Status darurat" },
  law: { en: "Law enforcement", id: "Penegakan hukum" },
  ground: { en: "Ground crews", id: "Pemadaman darat" },
  policy: { en: "Policy & coordination", id: "Kebijakan & koordinasi" },
};

/** Severity ring: the same warm ramp the fire layer uses, so "worse" reads the same everywhere. */
export const SEVERITY_COLOR: Record<1 | 2 | 3, string> = {
  1: "#cbd5e1",
  2: "#fbbf24",
  3: "#ef4444",
};

export const SEVERITY_LABEL: Record<1 | 2 | 3, { en: string; id: string }> = {
  1: { en: "Watch", id: "Waspada" },
  2: { en: "Serious", id: "Serius" },
  3: { en: "Severe", id: "Parah" },
};

/** Coverage half-life: a story three days old counts half as much as one from today. */
const HALF_LIFE_DAYS = 3;

export function recencyWeight(publishedAt: string, now = Date.now()): number {
  const days = Math.max(0, (now - Date.parse(publishedAt)) / 86_400_000);
  return Math.pow(0.5, days / HALF_LIFE_DAYS);
}

/**
 * News severity from recency-weighted coverage: many outlets reporting the
 * same province this week is a stronger signal than one old article.
 */
export function newsSeverity(score: number, articles: number): 1 | 2 | 3 {
  if (score >= 4 || articles >= 8) return 3;
  if (score >= 1.5 || articles >= 3) return 2;
  return 1;
}
