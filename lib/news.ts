const NEWS_TIMEOUT_MS = 6_000;

/**
 * Karhutla news helpers shared by the national feed (/api/news) and the
 * per-area feed (/api/areas): Google News RSS parsing and the relevance
 * filter that keeps Indonesian forest and land fire stories only.
 */

export interface NewsArticle {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  snippet: string;
}

function decodeEntities(text: string): string {
  return text
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** Items without a title, link or valid date are dropped rather than given placeholder values. */
export function parseRssArticles(xml: string): NewsArticle[] {
  const items = xml.match(/<item>([\s\S]*?)<\/item>/g) ?? [];
  return items.flatMap((item) => {
    const pick = (re: RegExp) => {
      const m = item.match(re);
      return m ? decodeEntities(m[1]).trim() : "";
    };
    const title = pick(/<title>([\s\S]*?)<\/title>/);
    const url = pick(/<link>([\s\S]*?)<\/link>/);
    const published = Date.parse(pick(/<pubDate>([\s\S]*?)<\/pubDate>/));
    if (!title || !url || Number.isNaN(published)) return [];

    const source = pick(/<source[^>]*>([\s\S]*?)<\/source>/) || new URL(url).hostname;
    let snippet = pick(/<description>([\s\S]*?)<\/description>/)
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (snippet.length > 200) snippet = `${snippet.slice(0, 197)}...`;

    return [
      {
        id: `news-rss-${published}-${title.length}`,
        title,
        source,
        url,
        publishedAt: new Date(published).toISOString(),
        snippet: snippet || title,
      },
    ];
  });
}

/** Must mention a forest/land fire. */
const FIRE_TERMS =
  /karhutla|kebakaran (hutan|lahan|gambut)|lahan gambut terbakar|hutan terbakar|titik panas|hotspot|kabut asap|asap karhutla|pemadaman (api|kebakaran)|water bombing|manggala agni/i;

/** Places that mark a story as Indonesian. */
const INDONESIA_TERMS =
  /indonesia|kalimantan|kalbar|kalteng|kalsel|kaltim|kaltara|sumatera|sumatra|riau|jambi|sumsel|palembang|pekanbaru|pontianak|palangka|banjarmasin|kubu raya|ketapang|sambas|sintang|kapuas|ogan|musi|bangka|belitung|aceh|lampung|bengkulu|sulawesi|papua|ntt|ntb|nusa tenggara|jawa|bali|maluku|bnpb|bpbd|klhk|kementerian kehutanan|kemenhut|bmkg|tni|polri|polda|polres|manggala agni/i;

/** Foreign fires that Indonesian outlets also cover; dropped unless the story is also about Indonesia. */
const FOREIGN_TERMS =
  /amerika|california|kanada|canada|australia|yunani|turki|spanyol|portugal|prancis|chili|bolivia|brasil|amazon|siberia|rusia|korea|jepang|hawaii|los angeles|eropa|israel|lebanon/i;

export function isIndonesianForestFire(a: NewsArticle): boolean {
  const text = `${a.title} ${a.snippet}`;
  if (!FIRE_TERMS.test(text)) return false;
  // "Karhutla" is itself an Indonesian term, so it needs no place name
  if (!/karhutla/i.test(text) && !INDONESIA_TERMS.test(text)) return false;
  // A foreign place in the headline means the story is about that fire
  if (FOREIGN_TERMS.test(a.title)) return false;
  return true;
}


/** Google News RSS search (Indonesian edition), relevance-filtered, newest first. */
export async function searchKarhutlaNews(query: string, limit: number): Promise<NewsArticle[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=id&gl=ID&ceid=ID:id`;
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(NEWS_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Google News RSS HTTP ${res.status}`);
  return parseRssArticles(await res.text())
    .filter(isIndonesianForestFire)
    .sort((x, y) => y.publishedAt.localeCompare(x.publishedAt))
    .slice(0, limit);
}
