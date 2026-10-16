import Link from "next/link";
import { ViewTransition } from "react";
import { FlameIcon, LayoutDashboardIcon, MonitorPlayIcon, SmartphoneIcon } from "lucide-react";
import VideoDownloads from "@/components/VideoDownloads";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-400";

export default function Home() {
  return (
    <main className="relative flex min-h-dvh flex-col justify-center overflow-hidden bg-slate-950 px-6 py-12 text-slate-100 sm:px-12">
      {/* One warm glow low on the page: the fire on the horizon, the only accent on this screen */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[55%] bg-[radial-gradient(ellipse_at_50%_100%,rgba(234,88,12,0.28),transparent_65%)]"
      />
      <div className="relative mx-auto w-full max-w-4xl">
        <div className="flex items-center gap-3">
          <FlameIcon className="size-8 text-orange-500" aria-hidden />
          <ViewTransition name="gw-brand" share="gw-morph" default="none">
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">GambutWatch</h1>
          </ViewTransition>
        </div>
        <p className="mt-5 max-w-2xl text-xl leading-snug text-white sm:text-2xl">
          Every fire in Indonesia, seen from orbit, projected 12 hours ahead, so firebreaks go up and villages move out
          before it arrives.
        </p>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-300">
          Setiap titik api di Indonesia dari satelit, diproyeksikan 12 jam ke depan, dengan garis sekat bakar, arah
          evakuasi, kualitas udara, dan krisis nasional lain di satu peta.
        </p>

        <nav aria-label="Buka aplikasi" className="mt-10 grid gap-3 sm:grid-cols-[1.4fr_1fr]">
          <Link
            href="/dashboard"
            className={`group flex flex-col gap-2 rounded-xl border border-orange-500/30 bg-orange-500/[0.07] p-5 transition-colors hover:border-orange-400/60 hover:bg-orange-500/[0.12] ${focusRing}`}
          >
            <LayoutDashboardIcon className="size-6 text-orange-400" aria-hidden />
            <span className="text-lg font-semibold">Dasbor Pusdalops</span>
            <span className="text-sm leading-relaxed text-slate-300">
              Peta 3D seluruh Indonesia: titik api, rambatan, asap, udara, satelit, dan krisis nasional.
            </span>
          </Link>
          <div className="grid gap-3">
            <Link
              href="/hud"
              className={`flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 transition-colors hover:border-sky-400/40 hover:bg-sky-500/[0.06] ${focusRing}`}
            >
              <SmartphoneIcon className="size-5 shrink-0 text-sky-400" aria-hidden />
              <span>
                <span className="block font-semibold">HUD regu lapangan</span>
                <span className="block text-sm text-slate-300">Kompas taktis dan verifikasi satu klik</span>
              </span>
            </Link>
            <Link
              href="/present?cut=short"
              className={`flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 transition-colors hover:border-white/25 ${focusRing}`}
            >
              <MonitorPlayIcon className="size-5 shrink-0 text-slate-300" aria-hidden />
              <span>
                <span className="block font-semibold">Presentasi 60 detik</span>
                <span className="block text-sm text-slate-300">Urgensi dan zona prioritas</span>
              </span>
            </Link>
            <Link
              href="/present?cut=full"
              className={`flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 transition-colors hover:border-white/25 ${focusRing}`}
            >
              <MonitorPlayIcon className="size-5 shrink-0 text-slate-300" aria-hidden />
              <span>
                <span className="block font-semibold">Presentasi lengkap</span>
                <span className="block text-sm text-slate-300">Semua data, krisis, berita, dan respons</span>
              </span>
            </Link>
          </div>
        </nav>

        <VideoDownloads />

        <p className="mt-10 max-w-2xl text-xs leading-relaxed text-slate-400">
          Data langsung: NASA FIRMS, BMKG, Open-Meteo / Copernicus CAMS, WorldPop, OpenStreetMap, GDACS, CelesTrak, Google
          News. Untuk demo dua layar, buka Dasbor dan HUD berdampingan: verifikasi lapangan tersinkron lewat
          BroadcastChannel.
        </p>
      </div>
    </main>
  );
}
