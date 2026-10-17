import { z } from "zod";
import {
  newsSeverity,
  recencyWeight,
  type CrisesPayload,
  type CrisisArticle,
  type CrisisEvent,
  type CrisisKind,
  type FeedStatus,
  type GovAction,
  type GovResponse,
  type PublicVoice,
} from "@/lib/crises";
import { googleNewsRss, isIndonesianForestFire, type NewsArticle } from "@/lib/news";
import { nearestProvince, provincesIn } from "@/lib/provinces";
import { jsonResponse } from "@/lib/http";

const CACHE_MS = 15 * 60_000;
const TIMEOUT_MS = 8_000;

/** News crises: one Google News query per kind plus a filter that must match the headline. */
const NEWS_CRISES: { kind: CrisisKind; query: string; must: RegExp[] }[] = [
  {
    kind: "fuel",
    query: '"kelangkaan BBM" OR "krisis BBM" OR "BBM langka" OR "antrean SPBU" OR "kelangkaan solar" OR "elpiji langka"',
    must: [/bbm|spbu|pertalite|solar|bensin|elpiji|lpg|pertamax/i, /langka|kelangkaan|krisis|antre|antrean|kosong|habis/i],
  },
  {
    kind: "flood",
    query: 'banjir OR "tanah longsor" OR "banjir bandang"',
    // An event, not a budget or planning story that mentions floods
    must: [/banjir|longsor/i, /terendam|merendam|terdampak|mengungsi|pengungsi|korban|tewas|hanyut|rusak|melanda|diterjang|tertimbun|evakuasi|ketinggian|meluap|jebol/i],
  },
  {
    kind: "volcano",
    query: 'erupsi gunung OR "status awas" OR "awan panas guguran"',
    must: [/erupsi|awan panas|status (awas|siaga) gunung|gunung .* (siaga|awas)|lava/i],
  },
  {
    kind: "drought",
    query: 'kekeringan OR "krisis air bersih" OR "kesulitan air bersih"',
    must: [/kekeringan|krisis air|air bersih/i],
  },
  {
    kind: "haze",
    query: '"kabut asap" OR "ISPA meningkat" OR "kualitas udara buruk"',
    must: [/kabut asap|ispa|kualitas udara/i],
  },
  {
    kind: "food",
    query: '"harga beras naik" OR "harga pangan naik" OR "harga cabai melonjak" OR "kenaikan harga pangan"',
    must: [/harga (beras|pangan|cabai|bawang|minyak goreng|telur|gula)/i, /naik|melonjak|mahal|kenaikan|meroket/i],
  },
  {
    kind: "power",
    query: '"pemadaman listrik" OR "listrik padam" OR blackout PLN',
    must: [/listrik|pln|blackout/i, /padam|pemadaman|blackout/i],
  },
  {
    kind: "outbreak",
    query: '"kejadian luar biasa" OR "status KLB" OR wabah penyakit',
    must: [/\bklb\b|kejadian luar biasa|wabah/i],
  },
];

const GOV_QUERY =
  'karhutla OR "kebakaran hutan" OR "kebakaran lahan" water bombing OR "modifikasi cuaca" OR "siaga darurat" OR BNPB OR Kemenhut OR "Manggala Agni" OR tersangka';
const GOV_TERMS =
  /bnpb|bpbd|water bombing|helikopter|modifikasi cuaca|\btmc\b|hujan buatan|siaga darurat|tanggap darurat|kemenhut|klhk|manggala agni|satgas|tersangka|polda|polres|presiden|menteri|gubernur|bupati|pemerintah|\btni\b|kapolri|penegakan hukum|disegel|sanksi|pidana/i;

const VOICE_QUERY =
  '(karhutla OR "kabut asap" OR "kebakaran hutan") (WALHI OR Greenpeace OR viral OR warganet OR influencer OR aktivis OR petisi)';
/** Ordered: the first match names the speaker. */
const VOICE_WHO: [RegExp, string][] = [
  [/walhi/i, "WALHI"],
  [/greenpeace/i, "Greenpeace"],
  [/pantau gambut/i, "Pantau Gambut"],
  [/auriga/i, "Auriga Nusantara"],
  [/jikalahari/i, "Jikalahari"],
  [/\bicel\b/i, "ICEL"],
  [/masyarakat adat|\baman\b/i, "Masyarakat adat"],
  [/influencer|selebgram|youtuber|artis|tiktoker/i, "Influencer"],
  [/petisi/i, "Petisi publik"],
  [/aktivis|koalisi/i, "Aktivis"],
  [/viral|warganet|netizen|medsos|media sosial/i, "Warganet"],
];

function govAction(text: string): GovAction {
  if (/water bombing|helikopter|bom air|pemadaman udara/i.test(text)) return "air";
  if (/modifikasi cuaca|\btmc\b|hujan buatan|semai/i.test(text)) return "weather";
  if (/siaga darurat|tanggap darurat|status darurat|status siaga/i.test(text)) return "status";
  if (/tersangka|ditangkap|diamankan|polda|polres|disegel|sanksi|pidana|gugat|penegakan hukum/i.test(text)) return "law";
  if (/manggala agni|satgas|regu|personel|pemadaman|dipadamkan|patroli/i.test(text)) return "ground";
  return "policy";
}

function cleanTitle(a: NewsArticle): string {
  const suffix = ` - ${a.source}`;
  return a.title.endsWith(suffix) ? a.title.slice(0, -suffix.length) : a.title;
}

function toArticle(a: NewsArticle): CrisisArticle {
  return { title: cleanTitle(a), source: a.source, url: a.url, publishedAt: a.publishedAt };
}

const WINDOW_MS = 14 * 86_400_000;

function fresh(a: NewsArticle, now: number): boolean {
  return now - Date.parse(a.publishedAt) <= WINDOW_MS;
}

async function newsCrises(now: number): Promise<{ events: CrisisEvent[]; feeds: FeedStatus[] }> {
  const results = await Promise.allSettled(
    NEWS_CRISES.map((c) => googleNewsRss(`${c.query} when:14d`)),
  );
  const events: CrisisEvent[] = [];
  const feeds: FeedStatus[] = [];
  NEWS_CRISES.forEach((c, i) => {
    const r = results[i];
    if (r.status !== "fulfilled") {
      feeds.push({ id: `news:${c.kind}`, label: `Google News · ${c.kind}`, ok: false, count: 0 });
      return;
    }
    const byProvince = new Map<string, { lat: number; lng: number; name: string; list: NewsArticle[] }>();
    const seen = new Set<string>();
    for (const a of r.value) {
      if (!fresh(a, now) || seen.has(a.url)) continue;
      const title = cleanTitle(a);
      if (!c.must.every((re) => re.test(title))) continue;
      seen.add(a.url);
      for (const p of provincesIn(title)) {
        const slot = byProvince.get(p.id) ?? { lat: p.lat, lng: p.lng, name: p.name, list: [] };
        slot.list.push(a);
        byProvince.set(p.id, slot);
      }
    }
    let count = 0;
    for (const [pid, slot] of byProvince) {
      const list = slot.list.sort((x, y) => y.publishedAt.localeCompare(x.publishedAt));
      const score = list.reduce((s, a) => s + recencyWeight(a.publishedAt, now), 0);
      // Distinct outlets, not reposts of one wire story, set the article count
      const outlets = new Set(list.map((a) => a.source)).size;
      count += 1;
      events.push({
        id: `news:${c.kind}:${pid}`,
        kind: c.kind,
        province: slot.name,
        title: cleanTitle(list[0]),
        lat: slot.lat,
        lng: slot.lng,
        at: list[0].publishedAt,
        severity: newsSeverity(score, outlets),
        score,
        basis: "news",
        source: `${outlets} media, ${list.length} artikel`,
        url: list[0].url,
        articles: list.slice(0, 6).map(toArticle),
      });
    }
    feeds.push({ id: `news:${c.kind}`, label: `Google News · ${c.kind}`, ok: true, count });
  });
  return { events, feeds };
}

const BmkgQuakeSchema = z.object({
  DateTime: z.string(),
  Coordinates: z.string(),
  Magnitude: z.string(),
  Kedalaman: z.string(),
  Wilayah: z.string(),
  Potensi: z.string().optional(),
  Dirasakan: z.string().optional(),
});
const BmkgListSchema = z.object({
  Infogempa: z.object({ gempa: z.array(BmkgQuakeSchema) }),
});

async function bmkgQuakes(now: number): Promise<CrisisEvent[]> {
  const urls = [
    "https://data.bmkg.go.id/DataMKG/TEWS/gempaterkini.json",
    "https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json",
  ];
  const lists = await Promise.all(
    urls.map(async (u) => {
      const res = await fetch(u, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`BMKG gempa HTTP ${res.status}`);
      return BmkgListSchema.parse(await res.json()).Infogempa.gempa;
    }),
  );
  const seen = new Set<string>();
  const events: CrisisEvent[] = [];
  for (const q of lists.flat()) {
    const at = Date.parse(q.DateTime);
    const mag = Number(q.Magnitude);
    const [lat, lng] = q.Coordinates.split(",").map(Number);
    // Small felt tremors are routine; keep M4+ from the last 14 days
    if (seen.has(q.DateTime) || !Number.isFinite(at) || now - at > WINDOW_MS || !(mag >= 4)) continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    seen.add(q.DateTime);
    // BMKG ends the region with its province code ("-NTT", "-JABAR"); the nearest capital is the fallback
    const p = provincesIn(q.Wilayah.replace(/-/g, " "), 1)[0] ?? nearestProvince(lat, lng);
    events.push({
      id: `bmkg:${q.DateTime}`,
      kind: "quake",
      province: p.name,
      title: `M${q.Magnitude} ${q.Wilayah}`,
      lat,
      lng,
      at: new Date(at).toISOString(),
      severity: mag >= 6.5 ? 3 : mag >= 5.5 ? 2 : 1,
      score: mag,
      basis: "official",
      source: "BMKG",
      url: "https://www.bmkg.go.id/gempabumi/gempabumi-terkini",
      detail: [`kedalaman ${q.Kedalaman}`, q.Potensi, q.Dirasakan ? `dirasakan ${q.Dirasakan}` : null]
        .filter(Boolean)
        .join(" · "),
      articles: [],
    });
  }
  return events;
}

const GdacsSchema = z.object({
  features: z.array(
    z.object({
      geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]).rest(z.number()) }),
      properties: z.object({
        eventtype: z.string(),
        eventid: z.number(),
        name: z.string(),
        alertlevel: z.string(),
        todate: z.string(),
        url: z.object({ report: z.string() }).partial().optional(),
      }),
    }),
  ),
});

const GDACS_KIND: Record<string, CrisisKind | undefined> = {
  FL: "flood",
  VO: "volcano",
  TC: "cyclone",
  DR: "drought",
  EQ: "quake",
};

async function gdacs(now: number): Promise<CrisisEvent[]> {
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const url = `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?country=Indonesia&fromDate=${day(
    now - 30 * 86_400_000,
  )}&toDate=${day(now)}`;
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 204) return [];
  if (!res.ok) throw new Error(`GDACS HTTP ${res.status}`);
  const parsed = GdacsSchema.parse(await res.json());
  return parsed.features.flatMap((f) => {
    const p = f.properties;
    const kind = GDACS_KIND[p.eventtype];
    // BMKG already covers earthquakes with finer detail; GDACS adds only the orange/red ones
    if (!kind || (kind === "quake" && p.alertlevel === "Green")) return [];
    const [lng, lat] = f.geometry.coordinates;
    const severity = p.alertlevel === "Red" ? 3 : p.alertlevel === "Orange" ? 2 : 1;
    return [
      {
        id: `gdacs:${p.eventtype}:${p.eventid}`,
        kind,
        province: nearestProvince(lat, lng).name,
        title: p.name.replace(/\s+/g, " ").trim(),
        lat,
        lng,
        at: new Date(`${p.todate}Z`).toISOString(),
        severity,
        score: severity * 2,
        basis: "official" as const,
        source: `GDACS (${p.alertlevel})`,
        url: p.url?.report,
        articles: [],
      },
    ];
  });
}

async function government(now: number): Promise<GovResponse[]> {
  const list = await googleNewsRss(`${GOV_QUERY} when:14d`);
  const seen = new Set<string>();
  return list
    .filter((a) => fresh(a, now) && isIndonesianForestFire(a) && GOV_TERMS.test(a.title))
    .filter((a) => (seen.has(a.url) ? false : (seen.add(a.url), true)))
    .sort((x, y) => y.publishedAt.localeCompare(x.publishedAt))
    .slice(0, 24)
    .map((a) => ({
      ...toArticle(a),
      id: `gov:${a.id}`,
      action: govAction(a.title),
      province: provincesIn(cleanTitle(a), 1)[0]?.name ?? null,
    }));
}

async function voices(now: number): Promise<PublicVoice[]> {
  const list = await googleNewsRss(`${VOICE_QUERY} when:30d`);
  const seen = new Set<string>();
  return list.flatMap((a) => {
    if (seen.has(a.url) || now - Date.parse(a.publishedAt) > 30 * 86_400_000) return [];
    const title = cleanTitle(a);
    if (!/karhutla|kebakaran (hutan|lahan)|kabut asap|asap|gambut/i.test(title)) return [];
    const who = VOICE_WHO.find(([re]) => re.test(title))?.[1];
    if (!who) return [];
    seen.add(a.url);
    return [{ ...toArticle(a), id: `voice:${a.id}`, who }];
  }).slice(0, 16);
}

async function build(): Promise<CrisesPayload> {
  const now = Date.now();
  const [news, quakes, alerts, gov, voice] = await Promise.allSettled([
    newsCrises(now),
    bmkgQuakes(now),
    gdacs(now),
    government(now),
    voices(now),
  ]);
  const value = <T,>(r: PromiseSettledResult<T>, fallback: T) => (r.status === "fulfilled" ? r.value : fallback);
  const newsPart = value(news, { events: [], feeds: [] });
  const events = [...value(quakes, []), ...value(alerts, []), ...newsPart.events].sort(
    (a, b) => b.severity - a.severity || b.score - a.score,
  );
  const feeds: FeedStatus[] = [
    { id: "bmkg-gempa", label: "BMKG gempa", ok: quakes.status === "fulfilled", count: value(quakes, []).length },
    { id: "gdacs", label: "GDACS", ok: alerts.status === "fulfilled", count: value(alerts, []).length },
    ...newsPart.feeds,
    { id: "gov", label: "Google News · respons pemerintah", ok: gov.status === "fulfilled", count: value(gov, []).length },
    { id: "voices", label: "Google News · suara publik", ok: voice.status === "fulfilled", count: value(voice, []).length },
  ];
  return {
    ok: feeds.some((f) => f.ok),
    updatedAt: new Date(now).toISOString(),
    events,
    government: value(gov, []),
    voices: value(voice, []),
    feeds,
  };
}

let cache: { at: number; data: CrisesPayload } | null = null;
let inflight: Promise<CrisesPayload> | null = null;

/** Every crisis in Indonesia from official feeds and news, refreshed every 15 minutes. */
export async function GET(request: Request) {
  new URL(request.url).searchParams.get("refresh");
  const started = Date.now();
  let upstreamMs: number | null = null;
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    inflight ??= build().finally(() => {
      inflight = null;
    });
    const fresh = await inflight;
    upstreamMs = Date.now() - started;
    // A refresh where every feed failed keeps serving the last good one
    if (fresh.ok || !cache) cache = { at: Date.now(), data: fresh };
  }
  return jsonResponse(request, cache.data, {
    status: cache.data.ok ? 200 : 502,
    headers: {
      "Cache-Control": "public, s-maxage=600, stale-while-revalidate=900",
      ...(upstreamMs === null ? {} : { "x-upstream-ms": String(upstreamMs) }),
    },
  });
}
