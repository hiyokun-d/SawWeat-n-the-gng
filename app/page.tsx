import Link from "next/link";
import { FlameIcon, LayoutDashboardIcon, SmartphoneIcon } from "lucide-react";

export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-slate-950 p-6 text-slate-100">
      <div className="flex flex-col items-center gap-3 text-center">
        <FlameIcon className="size-10 text-orange-500" />
        <h1 className="text-3xl font-bold tracking-tight">GambutWatch</h1>
        <p className="max-w-xl text-sm leading-relaxed text-slate-400">
          Tactical Decision Support System untuk perambatan kebakaran lahan gambut: nowcast
          posisi api, proyeksi t+12 jam, dan rekomendasi garis sekat bakar otomatis untuk
          Kabupaten Kubu Raya, Kalimantan Barat. Data cuaca langsung dari BMKG.
        </p>
      </div>

      <div className="grid w-full max-w-2xl gap-4 sm:grid-cols-2">
        <Link
          href="/dashboard"
          className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-orange-500/40 hover:bg-orange-500/5"
        >
          <LayoutDashboardIcon className="size-6 text-orange-400" />
          <span className="text-lg font-semibold">Dasbor Pusdalops BPBD</span>
          <span className="text-xs leading-relaxed text-slate-400">
            Peta interaktif KHG gambut, poligon nowcast dan forecast, garis rekomendasi
            sekat bakar, timeline slider, dan AI tactical briefing.
          </span>
        </Link>
        <Link
          href="/hud"
          className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-sky-500/40 hover:bg-sky-500/5"
        >
          <SmartphoneIcon className="size-6 text-sky-400" />
          <span className="text-lg font-semibold">HUD MPA (Mobile)</span>
          <span className="text-xs leading-relaxed text-slate-400">
            Kompas vektor taktis, instruksi sekat bakar, dan panel verifikasi lapangan
            satu klik yang tersinkronasi ke dasbor.
          </span>
        </Link>
      </div>

      <p className="max-w-xl text-center text-[11px] leading-relaxed text-slate-600">
        Untuk demo dua layar: buka Dasbor dan HUD di dua jendela berdampingan. Perubahan
        status dari lapangan langsung tersinkronisasi ke dasbor melalui BroadcastChannel.
        Sumber data cuaca: BMKG (api.bmkg.go.id dan maritim.bmkg.go.id).
      </p>
    </main>
  );
}
