Executive Summary
Nama Produk: GambutWatch
Definisi Singkat: Tactical Decision Support System berbasis Progressive Web App (PWA) untuk memproyeksikan perambatan kebakaran lahan gambut pada jendela waktu emas (golden hours, 0–12 jam pertama) dan menghasilkan rekomendasi garis potong sekat bakar (firebreak) secara otomatis.
Pernyataan Masalah: Kebakaran hutan dan lahan gambut di Indonesia telah menghanguskan 202.010,96 hektare lahan sepanjang Januari–Agustus 2026 dan memicu potensi kerugian ekonomi hingga Rp 123,1 triliun. Sistem pemantauan satelit saat ini bersifat pasif dengan latensi 3–6 jam serta mengalami kebutaan sensor terhadap kebakaran bawah permukaan tanah (smoldering fire). Akibatnya, satuan Masyarakat Peduli Api (MPA) dan posko BPBD mengalami disorientasi taktis di lapangan dalam menentukan posisi pembuatan sekat bakar sebelum api meresap ke kedalaman gambut kritis (>0,5 meter).

Arsitektur Tech Stack (Zero-Friction Hackathon Stack)
Gunakan satu repositori terpadu (Monorepo / Fullstack Next.js) untuk merender tampilan Desktop dan Mobile secara responsif:
Framework Utama: Next.js 14+ (App Router) dengan TypeScript.
Styling & Komponen UI: Tailwind CSS + Shadcn UI + Lucide Icons (Tema Dominan: High-Contrast Dark Mode bg-slate-950).
Geospatial & Map Engine: react-leaflet (Leaflet.js) atau react-map-gl (Mapbox GL JS) + pustaka kalkulasi geometri spasial @turf/turf (wajib diinstal untuk menghitung poligon rambatan, jarak desa, dan garis busur firebreak).
Real-Time Sync (Desktop Mobile Demo): Gunakan BroadcastChannel API bawaan peramban dikombinasikan dengan localStorage (atau Supabase Realtime). Saat demo video 2 menit, membuka /dashboard (Desktop) dan /hud (Mobile) di dua jendela berdampingan akan menghasilkan sinkronisasi instan (0 ms latensi) tanpa risiko kegagalan server.
Integrasi AI (Wajib Dicantumkan di Pitch Deck):
Spatial Predictive Engine: Algoritma 2D Cellular Automata untuk simulasi fisik perambatan api.
AI Tactical Dispatch Generator: Integrasi API LLM (Gemini API / OpenAI SDK) untuk mengonversi telemetri spasial menjadi instruksi komando singkat berformat SOP BPBD bagi regu lapangan
Kontrak Data & TypeScript Interfaces (types/gambut.ts)
Salin skema ini sebagai fondasi data antara frontend, engine simulasi, dan API route:
export type FireStatus =
| 'UNVERIFIED_HOTSPOT' // Baru masuk dari satelit NASA FIRMS
| 'CONFIRMED_FLAMING' // Api permukaan aktif (Terverifikasi MPA / Hotspot baru di dalam poligon)
| 'SUSPECTED_SMOLDERING' // Titik panas hilang di satelit, dicurigai merambat di bawah tanah gambut
| 'CONFIRMED_SMOLDERING' // MPA mengonfirmasi masih ada asap/bara bawah tanah
| 'EXTINGUISHED'; // MPA mengonfirmasi padam total di lapangan

export type ThreatLevel = 'AMAN' | 'WASPADA' | 'SIAGA' | 'BAHAYA';

export interface WeatherTelemetry {
windSpeedKmh: number; // Kecepatan angin pada ketinggian 10m (km/jam)
windDirectionDeg: number; // Arah datang angin (0-360 derajat)
windVectorDeg: number; // Arah dorongan angin = (windDirectionDeg + 180) % 360
relativeHumidity: number; // Kelembapan udara relatif (%)
temperatureC: number; // Suhu udara (°C)
updatedAt: string;
}

export interface PeatlandZone {
khgId: string;
name: string; // Contoh: "KHG Sungai Kapuas - Sungai Ambawang"
depthCategory: 'DANGKAL (<1m)' | 'SEDANG (1-3m)' | 'DALAM (>3m)';
baseSpreadRateR0: number; // Laju rambatan dasar tanpa angin (meter/jam)
}

export interface TimeStepPolygon {
hourOffset: number; // 0 (Nowcast saat ini), +1, +3, +6, +9, +12
timestamp: string; // Jam aktual (misal "15:00 WIB")
geojsonPolygon: GeoJSON.Feature<GeoJSON.Polygon>;
burnedAreaHa: number; // Estimasi luas terbakar (Hektare)
maxSpreadRadiusM: number; // Jarak rambatan terjauh ke arah angin (Meter)
}

export interface FirebreakRecommendation {
targetHourOffset: number; // Default: t+3 jam (waktu persiapan regu darat)
coordinates: [number, number][]; // Array [lat, lng] pembentuk garis busur sekat bakar
lengthMeters: number; // Panjang sekat bakar yang harus digali/ditebas
safetyBufferMeters: number; // Jarak aman dari kepala api saat ini
etaFireArrivalMinutes: number; // Sisa waktu sebelum api menyentuh garis ini
tacticalNotes: string; // Dihasilkan oleh AI / Rule-based SOP
}

export interface HotspotIncident {
id: string;
originLat: number;
originLng: number;
satelliteAcquisitionTime: string; // Contoh: "2026-10-14T09:00:00Z" (3 jam lalu)
systemReceivedTime: string; // Contoh: "2026-10-14T12:00:00Z" (Saat ini)
frpMegawatt: number; // Fire Radiative Power dari VIIRS (MW)
confidence: 'low' | 'nominal' | 'high';
status: FireStatus;
peatlandInfo: PeatlandZone;
weather: WeatherTelemetry;
nowcastPolygon: TimeStepPolygon; // Posisi api saat ini (mengejar jeda 3-6 jam satelit)
forecastPolygons: TimeStepPolygon[]; // Proyeksi t+1 s.d. t+12 jam
firebreak: FirebreakRecommendation;
nearestVillage: {
name: string;
lat: number;
lng: number;
distanceMeters: number;
threatLevel: ThreatLevel;
safeEvacuationBearingDeg: number; // Tegak lurus arah angin
};
lastVerifiedBy?: string; // Contoh: "Regu MPA Desa Rasau Jaya"
lastVerifiedAt?: string;
}

Spesifikasi Logika Inti & Rumus Algoritma (lib/simulationEngine.ts)
Bagian ini merupakan inti penilaian Implementasi Teknis (30%). Seluruh kalkulasi dieksekusi di sisi klien (client-side) menggunakan @turf/turf agar sangat cepat dan tetap berjalan saat mode luring (offline).
Rumus Laju Perambatan Api (Cellular Automata / Empirical Spread)
Laju rambatan api permukaan menuju sel tetangga pada sudut arah dihitung dengan persamaan:
R()=R0(1+w())m
Implementasi Parameter Kode:
Laju Dasar Gambut (R0):
Gambut Dalam (>3m, kering terdegradasi): R0=28meter/jam.
Gambut Sedang (1-3m): R0=18meter/jam.
Gambut Dangkal (<1m): R0=12meter/jam.
Koefisien Retardasi Kelembapan (m):
m=0.25,1.4-RelativeHumidity100
(Semakin rendah kelembapan udara di bawah 50%, nilai m semakin besar mempercepat rambatan api).
Koefisien Dorongan Vektor Angin (w()):
Untuk setiap sudut arah kompas {0°, 15°, 30°, ..., 345°} (24 titik sudut pembentuk poligon):
Hitung selisih sudut terhadap arah dorongan angin (=-windVectorDeg).
Gunakan distribusi elips angin
w()=0.12windSpeedKmh1+()21.8
Pada arah searah dorongan angin (=0), (0)=1, sehingga api terdorong maju dengan kecepatan maksimal (head fire). Pada arah berlawanan angin (=180), cos(180°)= -1 → w = 0, sehingga api hanya merayap lambat dengan kecepatan dasar (backfire).

Mekanisme Waktu: Nowcasting vs Forecasting
Hitung Jeda Latensi Satelit (tlatency):
tlatency=WaktuSekarang(t0)-WaktuPotretSatelit(tacq)
(Default simulasi demo: tlatency=3jam, misalnya satelit memotret pukul 09.00, data masuk pukul 12.00).
Generate Poligon Nowcast (Posisi Api Aktual Saat Ini pada t0):
Untuk setiap sudut dari 24 titik keliling, hitung jarak tempuh api selama jeda latensi:
Dnowcast()=R()tlatency
Gunakan fungsi turf.destination(originPoint, D_nowcast / 1000, theta, { units: 'kilometers' }) untuk mendapatkan 24 titik koordinat, lalu bungkus menjadi turf.polygon(). Poligon inilah yang menjadi posisi api jam ke-0 (t0) di layar pengguna.
Generate Poligon Forecast (t+1 s.d. t+12 Jam):
Ketika pengguna menggeser slider ke jam h[1,12], jarak dari titik awal pada sudut adalah:
Dforecast(,h)=R()(tlatency+h)
Hitung luas area terbakar secara otomatis menggunakan turf.area(polygon) / 10000 (konversi m2 ke Hektare).

Algoritma Generator Garis Firebreak (Sekat Bakar)
Garis rekomendasi sekat bakar harus memotong jalur kepala api (head fire) pada horizon waktu persiapan regu darat (hprep=3jam dari sekarang) ditambah jarak penyangga keselamatan (safety buffer = 120meter):
Ambil sudut dorongan angin utama wind=windVectorDeg.
Buat 5 titik busur pemotong pada sudut:[wind-35,wind-17.5,wind,wind+17.5,wind+35].
Untuk masing-masing dari 5 sudut tersebut, letakkan titik koordinat pada jarak:
Dfirebreak()=Dforecast(,3)+120meter
Hubungkan kelima titik tersebut menjadi turf.lineString(). Tampilkan di peta sebagai garis putus-putus kuning terang (#FACC15) dengan label "REKOMENDASI SEKAT BAKAR (POTONG DI SINI)".

Logika Asimilasi Data Satelit & Smoldering Blindness
Sediakan 3 tombol simulasi pembaruan satelit di pojok atas dasbor untuk didemokan kepada juri:
Skenario 1: "Simulasi Update Satelit: Hotspot Baru di Luar Poligon": Sistem menambahkan titik api baru di luar batas prediksi, melakukan re-anchoring (menggabungkan dua poligon dengan turf.union), dan menggeser garis firebreak lebih jauh ke depan disertai peringatan suara/visual ke MPA.
Skenario 2: "Simulasi Update Satelit: Hotspot Hilang (Smoldering Blindness)": Titik panas dari satelit menghilang karena tertutup tanah/asap. Sistem menolak mengubah status menjadi padam, melainkan mengubah status menjadi SUSPECTED_SMOLDERING (poligon berubah warna menjadi Oranye Berkedip) dan mengirim permintaan verifikasi lapangan ke tampilan HP MPA.
CATATAN (Oktober 2026): tombol simulasi pembaruan satelit (Skenario 1 dan 2) sudah dihapus atas keputusan tim; seluruh hotspot hanya bersumber dari data NASA FIRMS.

Integrasi API Publik & Strategi Fallback Data
Cuaca Mikro Lokal (Open-Meteo API — Tanpa API Key / Gratis):
Endpoint:
[https://api.open-meteo.com/v1/forecast?latitude=-0.1234&longitude=109.5678&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m&timezone=Asia%2FBangkok](https://api.open-meteo.com/v1/forecast?latitude=-0.1234&longitude=109.5678&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m&timezone=Asia%2FBangkok)

Titik Panas Satelit (NASA FIRMS API + Fallback Seed):
Endpoint Live VIIRS 375m: [https://firms.modaps.eosdis.nasa.gov/api/country/csv/](https://firms.modaps.eosdis.nasa.gov/api/country/csv/){MAP_KEY}/VIIRS_SNPP_NRT/IDN/1
ATURAN WAJIB HACKATHON (Fallback Seed Data): Buat berkas data/mockIncidentsKalbar.json berisi 4 titik insiden realistis di Kabupaten Kubu Raya, Kalimantan Barat (wilayah kebakaran gambut tertinggi nasional 2026: 38.310 ha), lengkap dengan poligon GeoJSON Kesatuan Hidrologis Gambut (KHG) Sungai Kapuas. Jika saat penilaian juri sedang turun hujan di Kalimantan sehingga API NASA FIRMS kosong, aplikasi tetap memuat skenario krisis dari data seed yang dikombinasikan dengan cuaca live Open-Meteo
CATATAN (Oktober 2026): fallback seed tidak lagi diterapkan atas keputusan tim; hotspot hanya bersumber dari NASA FIRMS, dan kondisi kosong ditangani dengan empty state yang menjelaskan status sumber data.
Spesifikasi Fitur & Antarmuka Pengguna (Dual-View)
Layar 1: Dasbor Strategis Pusdalops BPBD (Route: /dashboard — Desktop 16:9)
Top Bar:
Nama Sektor: Kab. Kubu Raya, Kalimantan Barat.
Badge Status: Jumlah Hotspot Aktif, Jumlah Titik Suspected Smoldering, serta tombol Switch ke Mode Demo Update Satelit.
Left Panel (Lebar 340px):
Kartu Telemetri Cuaca: Kecepatan angin (km/j), kompas arah dorongan angin, kelembapan relatif (%), dan indikator kekeringan gambut.
Daftar Insiden Prioritas: Kartu titik api yang dapat diklik. Menampilkan ID, kategori kedalaman gambut, FRP (MW), dan badge status (UNVERIFIED, CONFIRMED FLAMING, SUSPECTED SMOLDERING, EXTINGUISHED).
AI Tactical Briefing Box: Kotak ringkasan instruksi operasional otomatis dari AI (contoh: "Angin berhembus 22 km/jam ke Timur Laut menuju Desa Rasau Jaya. Kerahkan 1 regu MPA untuk memotong jalur sekat bakar sepanjang 380m pada koordinat terlampir sebelum pukul 15.30 WIB").
Center Interactive Map:
Merender poligon KHG Gambut (arsir cokelat/hijau tua), titik asal api, poligon Nowcast (t0), poligon Forecast yang membesar secara dinamis sesuai slider, garis kuning Firebreak, dan pin Desa terdekat.
Bottom Floating Timeline Slider:
Tombol Play / Pause animasi rambatan otomatis.
Slider geser dari t+0h (Nowcast Saat Ini) t+1h t+3h t+6h t+9h t+12h.
Metrik dinamis di sebelah slider: Laju Rambatan (R) dalam meter/jam dan Estimasi Luas Terancam dalam Hektare.

Layar 2: Mobile Tactical HUD untuk Relawan MPA (Route: /hud — Mobile Viewport 9:16)
Top Status Bar:
Indikator Koneksi: Tombol toggle simulasi ONLINE vs OFFLINE (CACHED) untuk membuktikan fitur Offline-First di depan juri.
Koordinat GPS Relawan & Nama Desa.
Kompas Vektor Taktis (Tengah Atas):
Lingkaran kompas SVG interaktif yang menunjukkan dua jarum panah besar:
Panah Biru: Arah dorongan angin lokal.
Panah Merah/Oranye: Arah posisi api dari tempat relawan berdiri, jarak (meter), dan kecepatan merambat mendekat (m/jam).
Kartu Instruksi Sekat Bakar (Firebreak Card):
Banner status kontras tinggi: BUAT SEKAT BAKAR SEGERA.
Informasi taktis: Jarak ke garis potong aman (misal 150m ke arah Barat Daya), sisa waktu aman sebelum api tiba (145 Menit), dan titik koordinat GPS.
Panel Verifikasi Lapangan 1-Klik (Ground-Truth Loop — Bawah):
Tiga tombol besar untuk dikirim kembali ke Dasbor BPBD:
[ 🔥 API PERMUKAAN AKTIF ] Mengubah status di dasbor menjadi CONFIRMED_FLAMING.
[ 💨 BARA / ASAP BAWAH TANAH ] Mengubah status menjadi CONFIRMED_SMOLDERING (mencegah satelit menandai padam palsu).
[ ✅ SUDAH PADAM TOTAL ] Mengubah status menjadi EXTINGUISHED dan menghentikan poligon simulasi.
Struktur Direktori Repositori GitHub
gambutwatch/
├── README.md # WAJIB: Penjelasan alur, arsitektur, rumus CA, & cara run lokal
├── package.json # Dependencies: next, react, leaflet, @turf/turf, lucide-react
├── src/
│ ├── app/
│ │ ├── page.tsx # Landing / Split-Screen Launcher (Buka Dashboard & HUD sekaligus)
│ │ ├── dashboard/
│ │ │ └── page.tsx # Layar 1: Dasbor Pusdalops BPBD (Desktop View)
│ │ ├── hud/
│ │ │ └── page.tsx # Layar 2: Mobile Tactical HUD MPA (Mobile View)
│ │ └── api/
│ │ ├── weather/route.ts # Proxy ke Open-Meteo API
│ │ └── tactical-brief/route.ts # Endpoint LLM AI untuk generate instruksi SOP
│ ├── components/
│ │ ├── map/
│ │ │ ├── PeatMap.tsx # Komponen Peta Leaflet/Mapbox + Render Poligon & Firebreak
│ │ │ └── TimelineSlider.tsx # Slider t+0 s/d t+12 jam + Play/Pause animasi
│ │ ├── hud/
│ │ │ ├── VectorCompass.tsx # Kompas SVG arah angin & kepala api
│ │ │ └── GroundTruthButtons.tsx # 3 Tombol verifikasi 1-klik MPA
│ ├── lib/
│ │ ├── simulationEngine.ts # Rumus Cellular Automata, Nowcast, Forecast, & Firebreak
│ │ └── syncChannel.ts # BroadcastChannel + LocalStorage sync antara Desktop & Mobile
│ └── data/
│ ├── khgKalbar.geojson.ts # Poligon Kesatuan Hidrologis Gambut Kubu Raya
│ └── hotspotSource.ts # Konversi titik panas VIIRS jadi sumber insiden mesin simulasi
