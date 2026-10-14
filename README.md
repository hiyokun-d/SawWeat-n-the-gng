# GambutWatch

Tactical Decision Support System (PWA) untuk memproyeksikan perambatan kebakaran
lahan gambut pada jendela waktu emas (0-12 jam pertama) dan menghasilkan rekomendasi
garis potong sekat bakar (firebreak) secara otomatis. Wilayah operasional:
Kabupaten Kubu Raya, Kalimantan Barat.

## Arsitektur

```
joints/
├── app/
│   ├── page.tsx                 # Launcher split-screen (buka Dasbor + HUD)
│   ├── dashboard/page.tsx       # Layar 1: Dasbor Pusdalops BPBD (Desktop)
│   ├── hud/page.tsx             # Layar 2: Mobile Tactical HUD MPA
│   └── api/
│       ├── weather/route.ts     # Proxy BMKG prakiraan cuaca (adm4)
│       ├── maritime/route.ts    # Proxy BMKG maritim (perairan P.V.04)
│       └── tactical-brief/route.ts  # Generator instruksi SOP BPBD
├── components/
│   ├── map/
│   │   ├── GambutMap.tsx        # Peta Leaflet: KHG, nowcast, forecast, firebreak
│   │   └── TimelineSlider.tsx   # Slider t+0 s.d t+12 jam + play/pause
│   └── hud/
│       ├── VectorCompass.tsx    # Kompas SVG arah angin & kepala api
│       └── GroundTruthButtons.tsx # 3 tombol verifikasi 1-klik MPA
├── hooks/useIncidents.ts        # State bersama: seed, cuaca BMKG, engine, sync
├── lib/
│   ├── gambut.ts                # Kontrak data (prd.md) + skema BMKG
│   ├── simulationEngine.ts      # Rumus Cellular Automata, nowcast, forecast, firebreak
│   └── syncChannel.ts           # BroadcastChannel + localStorage Desktop <-> Mobile
└── data/
    ├── khgKalbar.geojson.ts     # Poligon KHG Sungai Kapuas - Sungai Ambawang
    └── seedIncidents.ts         # 4 insiden seed Kubu Raya (fallback demo)
```

## Rumus Algoritma (lib/simulationEngine.ts)

Laju rambatan api permukaan menuju sel tetangga pada sudut arah:

```
R(theta) = R0 * (1 + w(theta))^m
```

- R0 (meter/jam): gambut DALAM (>3m) = 28, SEDANG (1-3m) = 18, DANGKAL (<1m) = 12
- m (koefisien retardasi kelembapan) = 0.25 + 1.4 - RH/100
- w (distribusi elips angin) = 0.12 * windSpeedKmh * (1 + cos(theta))^2 / 1.8,
  dengan theta = selisih sudut rambatan terhadap arah dorongan angin.
  Head fire (theta = 0): dorongan maksimal. Backfire (theta = 180): w = 0.

Poligon dibangun dari 24 titik setiap 15 derajat via `turf.destination`:

```
D_nowcast(theta)    = R(theta) * t_latency
D_forecast(theta,h) = R(theta) * (t_latency + h)
```

Garis firebreak: 5 titik busur pada sudut [wind-35, wind-17.5, wind, wind+17.5,
wind+35], jarak D_forecast(theta, 3) + 120 m penyangga, dirender sebagai garis
putus-putus #FACC15.

## Integrasi API BMKG

| Sumber | Endpoint | Kegunaan |
| --- | --- | --- |
| Prakiraan cuaca | `https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4={kode}` | Suhu, kelembapan, kecepatan dan arah angin (Desa Rasau Jaya Umum, 61.12.07.2001) |
| Maritim | `https://maritim.bmkg.go.id/marine2026-data/perairan/P.V.04.json` | Kondisi Perairan Kubu Raya: gelombang, angin laut |
| Hotspot | `https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/VIIRS_*_NRT/{bbox}/3` | Titik api satelit VIIRS near-real-time (butuh MAP_KEY gratis) |

### Setup NASA FIRMS (untuk data titik api real)

1. Daftar gratis di https://firms.modaps.eosdis.nasa.gov/api/ (isi email, key dikirim instan)
2. Copy `.env.example` menjadi `.env.local` dan isi `MAP_KEY=...`
3. Restart dev server

Tanpa `MAP_KEY`, aplikasi tetap berjalan dengan skenario simulasi 4 hotspot
(penanda "SIMULASI" di HUD, banner peringatan di dasbor). Dengan key, titik api
asli VIIRS near-real-time menggantikan skenario simulasi, tombol demo
"Simulasi: Hotspot" disembunyikan, dan badge HUD berubah "FIRMS LIVE".
Deteksi confidence tinggi dianggap api permukaan aktif; nominal/low menunggu
verifikasi lapangan. Atribusi NASA FIRMS wajib ditampilkan dan sudah ada di
dasbor, HUD, dan peta.

Peta dua mesin (tanpa API key): MapLibre GL sebagai mesin utama (proyeksi globe,
terrain Mapterhorn, bangunan 3D, kolom FRP, animasi intro) dengan tiga gaya
OpenFreeMap (Liberty, Bright, Positron) yang bisa diganti di sidebar dasbor;
Leaflet dengan raster OpenStreetMap tampil lebih dulu lalu memudar saat MapLibre
siap, dan menjadi cadangan permanen jika WebGL tidak tersedia. Hotspot, poligon
nowcast/prakiraan, garis sekat bakar, batas KHG, dan desa terpapar dirender pada
kedua mesin. Animasi (Framer Motion) diterapkan pada panel sidebar, kartu insiden,
notice satelit, timeline, dan jarum kompas HUD.

BMKG mewajibkan atribusi; aplikasi menampilkan "Sumber data: BMKG" pada dasbor,
HUD, peta, dan footer. Kuota akses 60 permintaan/menit per IP.

## Fitur Demo (untuk juri)

1. **Dasbor + HUD dua jendela**: buka `/dashboard` dan `/hud` berdampingan.
   Perubahan status dari HUD langsung tersinkronisasi ke dasbor (BroadcastChannel).
2. **Timeline slider**: geser t+0 s.d t+12 jam atau tekan Play untuk animasi
   perambatan; metrik laju R dan luas terancam (ha) update dinamis.
3. **Skenario 1 - Hotspot baru di luar poligon**: tombol "Simulasi: Hotspot Baru"
   menambah titik api di luar prediksi, menggabungkan poligon (turf.union), dan
   menggeser garis firebreak ke depan.
4. **Skenario 2 - Smoldering blindness**: tombol "Simulasi: Hotspot Hilang"
   mengubah status hotspot yang hilang dari satelit menjadi SUSPECTED_SMOLDERING
   (poligon oranye berkedip) dan mengirim permintaan verifikasi ke HUD MPA.
5. **Verifikasi lapangan 1-klik**: tiga tombol di HUD (api aktif / bara bawah
   tanah / padam total) mengubah status insiden di dasbor.
6. **Mode offline**: toggle ONLINE/OFFLINE (CACHED) di HUD; status terakhir
   insiden dipulihkan dari localStorage saat tab dimuat ulang.

## Menjalankan

```bash
bun install
bun run dev      # http://localhost:3000
bun run build    # build produksi
```
