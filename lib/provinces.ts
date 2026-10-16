/**
 * Indonesia's 38 provinces with the coordinates of their capital city, and
 * the place names that tie a news headline to the province. News-reported
 * crises are pinned at the capital: the story names a province or a city in
 * it, not an exact location, and the map labels those pins as news-reported.
 */

export interface Province {
  id: string;
  name: string;
  capital: string;
  lat: number;
  lng: number;
  terms: RegExp;
}

export const PROVINCES: Province[] = [
  { id: "aceh", name: "Aceh", capital: "Banda Aceh", lat: 5.55, lng: 95.32, terms: /\baceh\b|lhokseumawe|meulaboh|langsa|sabang/i },
  { id: "sumut", name: "Sumatera Utara", capital: "Medan", lat: 3.59, lng: 98.67, terms: /sumut|sumatera utara|\bmedan\b|deli serdang|\bnias\b|siantar|\btoba\b|langkat|binjai|asahan|labuhanbatu/i },
  { id: "sumbar", name: "Sumatera Barat", capital: "Padang", lat: -0.95, lng: 100.35, terms: /sumbar|sumatera barat|\bpadang\b|bukittinggi|\bagam\b|mentawai|\bsolok\b|pariaman|pasaman|payakumbuh/i },
  { id: "riau", name: "Riau", capital: "Pekanbaru", lat: 0.51, lng: 101.45, terms: /(?<!kepulauan )\briau\b|pekanbaru|\bdumai\b|\bsiak\b|bengkalis|pelalawan|indragiri|rokan|kampar|meranti|kuantan singingi/i },
  { id: "kepri", name: "Kepulauan Riau", capital: "Tanjung Pinang", lat: 0.92, lng: 104.45, terms: /kepulauan riau|\bkepri\b|\bbatam\b|tanjung ?pinang|bintan|karimun|natuna|lingga|anambas/i },
  { id: "jambi", name: "Jambi", capital: "Jambi", lat: -1.61, lng: 103.61, terms: /\bjambi\b|tanjung jabung|kerinci|sarolangun|batanghari|merangin|tebo|bungo/i },
  { id: "sumsel", name: "Sumatera Selatan", capital: "Palembang", lat: -2.98, lng: 104.76, terms: /sumsel|sumatera selatan|palembang|\bogan\b|\bmusi\b|banyuasin|lahat|prabumulih|muara enim|lubuklinggau|\boki\b/i },
  { id: "babel", name: "Kepulauan Bangka Belitung", capital: "Pangkal Pinang", lat: -2.13, lng: 106.11, terms: /bangka|belitung|\bbabel\b|pangkal ?pinang/i },
  { id: "bengkulu", name: "Bengkulu", capital: "Bengkulu", lat: -3.8, lng: 102.27, terms: /bengkulu|mukomuko|rejang lebong|kepahiang/i },
  { id: "lampung", name: "Lampung", capital: "Bandar Lampung", lat: -5.43, lng: 105.26, terms: /lampung|mesuji|tulang bawang|pringsewu|tanggamus|metro lampung/i },
  { id: "jakarta", name: "DKI Jakarta", capital: "Jakarta", lat: -6.2, lng: 106.85, terms: /jakarta|\bdki\b|kepulauan seribu/i },
  { id: "jabar", name: "Jawa Barat", capital: "Bandung", lat: -6.91, lng: 107.61, terms: /jabar|jawa barat|bandung|\bbogor\b|bekasi|\bdepok\b|cirebon|sukabumi|\bgarut\b|tasikmalaya|cianjur|karawang|purwakarta|subang|indramayu|majalengka|kuningan|sumedang|ciamis|pangandaran/i },
  { id: "banten", name: "Banten", capital: "Serang", lat: -6.12, lng: 106.15, terms: /banten|tangerang|\bserang\b|cilegon|\blebak\b|pandeglang/i },
  { id: "jateng", name: "Jawa Tengah", capital: "Semarang", lat: -6.97, lng: 110.42, terms: /jateng|jawa tengah|semarang|\bsolo\b|surakarta|magelang|banyumas|cilacap|\bkudus\b|\bpati\b|\btegal\b|pekalongan|klaten|boyolali|sragen|wonogiri|purworejo|kebumen|demak|jepara|rembang|blora|grobogan|brebes|salatiga/i },
  { id: "diy", name: "DI Yogyakarta", capital: "Yogyakarta", lat: -7.8, lng: 110.37, terms: /yogyakarta|jogja|\bdiy\b|sleman|bantul|gunungkidul|kulon ?progo/i },
  { id: "jatim", name: "Jawa Timur", capital: "Surabaya", lat: -7.25, lng: 112.75, terms: /jatim|jawa timur|surabaya|\bmalang\b|sidoarjo|banyuwangi|jember|kediri|madura|probolinggo|lumajang|pasuruan|mojokerto|bojonegoro|tuban|lamongan|gresik|blitar|tulungagung|ponorogo|madiun|ngawi|situbondo|bondowoso|bangkalan|sampang|pamekasan|sumenep|bromo|semeru/i },
  { id: "bali", name: "Bali", capital: "Denpasar", lat: -8.65, lng: 115.22, terms: /\bbali\b|denpasar|badung|gianyar|tabanan|buleleng|karangasem|jembrana|klungkung|bangli|nusa penida|kuta\b|ubud/i },
  { id: "ntb", name: "Nusa Tenggara Barat", capital: "Mataram", lat: -8.58, lng: 116.12, terms: /\bntb\b|nusa tenggara barat|mataram|lombok|sumbawa|\bbima\b|dompu|rinjani/i },
  { id: "ntt", name: "Nusa Tenggara Timur", capital: "Kupang", lat: -10.18, lng: 123.61, terms: /\bntt\b|nusa tenggara timur|kupang|flores|\bsumba\b|\btimor\b(?![- ]leste)|\bende\b|manggarai|\balor\b|lembata|labuan bajo|sikka|maumere|lewotobi|belu|rote/i },
  { id: "kalbar", name: "Kalimantan Barat", capital: "Pontianak", lat: -0.03, lng: 109.33, terms: /kalbar|kalimantan barat|pontianak|kubu raya|ketapang|sambas|sintang|sanggau|kapuas hulu|mempawah|singkawang|\blandak\b|melawi|bengkayang|kayong/i },
  { id: "kalteng", name: "Kalimantan Tengah", capital: "Palangka Raya", lat: -2.21, lng: 113.92, terms: /kalteng|kalimantan tengah|palangka ?raya|kotawaringin|katingan|pulang pisau|\bkapuas\b(?! hulu)|barito (timur|utara|selatan)|seruyan|gunung mas|lamandau|sukamara|murung raya/i },
  { id: "kalsel", name: "Kalimantan Selatan", capital: "Banjarmasin", lat: -3.32, lng: 114.59, terms: /kalsel|kalimantan selatan|banjarmasin|banjarbaru|\bbanjar\b|tanah laut|barito kuala|kotabaru|tabalong|tanah bumbu|hulu sungai|tapin|balangan/i },
  { id: "kaltim", name: "Kalimantan Timur", capital: "Samarinda", lat: -0.5, lng: 117.15, terms: /kaltim|kalimantan timur|samarinda|balikpapan|\bkutai\b|\bberau\b|bontang|\bpaser\b|\bikn\b|penajam/i },
  { id: "kaltara", name: "Kalimantan Utara", capital: "Tanjung Selor", lat: 2.84, lng: 117.37, terms: /kaltara|kalimantan utara|tarakan|nunukan|malinau|bulungan|tana tidung/i },
  { id: "sulut", name: "Sulawesi Utara", capital: "Manado", lat: 1.47, lng: 124.84, terms: /sulut|sulawesi utara|manado|bitung|minahasa|tomohon|sangihe|talaud|kotamobagu|bolaang|ruang/i },
  { id: "gorontalo", name: "Gorontalo", capital: "Gorontalo", lat: 0.54, lng: 123.06, terms: /gorontalo|pohuwato|boalemo|bone bolango/i },
  { id: "sulteng", name: "Sulawesi Tengah", capital: "Palu", lat: -0.9, lng: 119.87, terms: /sulteng|sulawesi tengah|\bpalu\b|\bposo\b|donggala|morowali|banggai|\bsigi\b|tolitoli|parigi|buol/i },
  { id: "sulbar", name: "Sulawesi Barat", capital: "Mamuju", lat: -2.68, lng: 118.89, terms: /sulbar|sulawesi barat|mamuju|majene|polewali|mamasa/i },
  { id: "sulsel", name: "Sulawesi Selatan", capital: "Makassar", lat: -5.15, lng: 119.43, terms: /sulsel|sulawesi selatan|makassar|\bgowa\b|\bmaros\b|\bbone\b(?! bolango)|pare-?pare|\bluwu\b|toraja|bulukumba|sidrap|\bwajo\b|pinrang|takalar|jeneponto|bantaeng|sinjai|soppeng|barru|pangkep|enrekang|selayar/i },
  { id: "sultra", name: "Sulawesi Tenggara", capital: "Kendari", lat: -3.97, lng: 122.51, terms: /sultra|sulawesi tenggara|kendari|konawe|kolaka|\bbuton\b|baubau|\bmuna\b|wakatobi|bombana/i },
  { id: "maluku", name: "Maluku", capital: "Ambon", lat: -3.7, lng: 128.18, terms: /\bmaluku\b(?! utara)|\bambon\b|\bseram\b|\btual\b|\bburu\b|kepulauan aru|banda neira/i },
  { id: "malut", name: "Maluku Utara", capital: "Sofifi", lat: 0.74, lng: 127.56, terms: /malut|maluku utara|ternate|tidore|halmahera|sofifi|morotai|sula\b/i },
  { id: "papua", name: "Papua", capital: "Jayapura", lat: -2.54, lng: 140.71, terms: /\bpapua\b(?! (barat|tengah|selatan|pegunungan))|jayapura|\bsarmi\b|keerom|\bbiak\b|\byapen\b/i },
  { id: "papbar", name: "Papua Barat", capital: "Manokwari", lat: -0.86, lng: 134.06, terms: /papua barat(?! daya)|manokwari|fakfak|kaimana|teluk bintuni|teluk wondama/i },
  { id: "papbd", name: "Papua Barat Daya", capital: "Sorong", lat: -0.88, lng: 131.26, terms: /papua barat daya|sorong|raja ampat|maybrat|tambrauw/i },
  { id: "papteng", name: "Papua Tengah", capital: "Nabire", lat: -3.37, lng: 135.5, terms: /papua tengah|nabire|mimika|timika|paniai|puncak jaya|intan jaya|dogiyai|deiyai/i },
  { id: "pappeg", name: "Papua Pegunungan", capital: "Wamena", lat: -4.1, lng: 138.95, terms: /papua pegunungan|wamena|jayawijaya|yahukimo|lanny jaya|tolikara|nduga|pegunungan bintang/i },
  { id: "papsel", name: "Papua Selatan", capital: "Merauke", lat: -8.49, lng: 140.4, terms: /papua selatan|merauke|boven digoel|\basmat\b|\bmappi\b/i },
];

/** Provinces named in a headline (at most `max`, in the order of the table). */
export function provincesIn(text: string, max = 3): Province[] {
  return PROVINCES.filter((p) => p.terms.test(text)).slice(0, max);
}

/** Nearest province capital to a point, for official events that come with coordinates. */
export function nearestProvince(lat: number, lng: number): Province {
  let best = PROVINCES[0];
  let bestD = Infinity;
  for (const p of PROVINCES) {
    const d = (p.lat - lat) ** 2 + ((p.lng - lng) * Math.cos((lat * Math.PI) / 180)) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}
