"use client";

import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import {
  MapPinIcon,
  NavigationIcon,
  ScissorsIcon,
  ShieldIcon,
  WifiIcon,
  WifiOffIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  BmkgVillages,
  compassName,
  FIRE_STATUS_LABEL,
  FIRMS_ATTRIBUTION,
  SECTOR_NAME,
  wibTime,
} from "@/lib/gambut";
import {
  bearingToFire,
  distanceToFireMeters,
  distanceToFirebreakMeters,
  spreadRateToward,
} from "@/lib/simulationEngine";
import { subscribeSync } from "@/lib/syncChannel";
import { useIncidents } from "@/hooks/useIncidents";
import GroundTruthButtons from "@/components/hud/GroundTruthButtons";

// Leaflet touches `window` on import, so the map loads client-only.
const HudMap = dynamic(() => import("@/components/hud/HudMap"), { ssr: false });

interface VolunteerPosition {
  lat: number;
  lng: number;
  source: "gps" | "fallback";
}

const FALLBACK_POSITION: VolunteerPosition = {
  lat: -0.2429026383,
  lng: 109.3838286841,
  source: "fallback",
};

function nearestVillageName(lat: number, lng: number): string {
  let best = BmkgVillages[0];
  let bestD = Number.POSITIVE_INFINITY;
  for (const v of BmkgVillages) {
    const d = (v.lat - lat) ** 2 + (v.lng - lng) ** 2;
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return best.name;
}

export default function HudPage() {
  const { incidents, weather, selectedIncident, selectedId, selectIncident, firmsLive } =
    useIncidents();
  const [online, setOnline] = useState(true);
  const [position, setPosition] = useState<VolunteerPosition>(FALLBACK_POSITION);
  const [verificationRequest, setVerificationRequest] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string>("");

  /* Volunteer GPS (falls back to Desa Rasau Jaya Umum when denied) */
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude, source: "gps" }),
      () => setPosition(FALLBACK_POSITION),
      { timeout: 8000 },
    );
  }, []);

  // Timestamp set client-side only (new Date() is forbidden during prerender)
  useEffect(() => {
    setUpdatedAt(new Date().toISOString());
  }, []);

  /* Listen for field-verification requests pushed from the dashboard */
  useEffect(() => {
    return subscribeSync((msg) => {
      if (msg.type === "incident:status" && msg.status === "SUSPECTED_SMOLDERING") {
        setVerificationRequest(msg.id);
        selectIncident(msg.id);
      }
    });
  }, [selectIncident]);

  const onVerify = useCallback(() => setVerificationRequest(null), []);

  const incident = selectedIncident;
  const fireBearing =
    incident !== null
      ? bearingToFire(position.lat, position.lng, incident.originLat, incident.originLng)
      : 0;
  const fireDistance =
    incident !== null
      ? distanceToFireMeters(position.lat, position.lng, incident.originLat, incident.originLng)
      : 0;
  const firebreakDistance =
    incident !== null
      ? distanceToFirebreakMeters(position.lat, position.lng, incident.firebreak)
      : 0;
  const firebreakBearing =
    incident !== null
      ? bearingToFire(
          position.lat,
          position.lng,
          incident.firebreak.coordinates[2][0],
          incident.firebreak.coordinates[2][1],
        )
      : 0;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-3 bg-slate-950 p-4 text-slate-100">
      {/* Top status bar */}
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="flex flex-col gap-2"
      >
        <div className="flex items-center gap-2">
          <ShieldIcon className="size-5 text-orange-500" />
          <h1 className="text-base font-bold">HUD MPA</h1>
          <Badge
            variant="outline"
            className={
              firmsLive
                ? "ml-auto border-emerald-500/40 text-emerald-300"
                : "ml-auto border-amber-500/40 text-amber-300"
            }
          >
            {firmsLive ? "FIRMS LIVE" : "SIMULASI"}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOnline((v) => !v)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
              online
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : "border-amber-500/40 bg-amber-500/10 text-amber-300"
            }`}
            aria-label="Toggle status koneksi"
          >
            {online ? <WifiIcon className="size-3.5" /> : <WifiOffIcon className="size-3.5" />}
            {online ? "ONLINE" : "OFFLINE (CACHED)"}
          </button>
          <span className="text-[11px] text-slate-500">
            {online ? "Data BMKG langsung" : "Prakiraan tersimpan di perangkat"}
          </span>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-slate-400">
          <MapPinIcon className="size-3.5 text-sky-400" />
          {position.source === "gps" ? "GPS" : "Koordinat fallback"}: {position.lat.toFixed(5)},{" "}
          {position.lng.toFixed(5)} · Desa {nearestVillageName(position.lat, position.lng)}
        </p>
      </motion.header>

      {/* Wind chip */}
      {weather && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="flex items-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs text-sky-200"
        >
          <span>Angin {Math.round(weather.windSpeedKmh)} km/jam</span>
          <span className="text-sky-400">→</span>
          <span>{compassName(weather.windVectorDeg)}</span>
          <span className="ml-auto">RH {Math.round(weather.relativeHumidity)}%</span>
        </motion.div>
      )}

      {/* Tactical map */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut", delay: 0.05 }}
      >
        {incidents.length > 0 ? (
          <HudMap
            incidents={incidents}
            selectedId={selectedId}
            position={position}
            onSelectIncident={selectIncident}
          />
        ) : (
          <div className="flex h-56 items-center justify-center rounded-xl border border-white/10 text-xs text-slate-500 sm:h-64">
            Memuat insiden...
          </div>
        )}
      </motion.div>

      {/* Status row: distance / bearing / ETA */}
      {incident && (
        <motion.div
          key={incident.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="grid grid-cols-3 gap-2"
        >
          <Stat label="Jarak ke api" value={`${Math.round(fireDistance)}`} unit="m" accent="red" />
          <Stat
            label="Arah api"
            value={compassName(fireBearing)}
            unit={`${Math.round(fireBearing)}°`}
            accent="orange"
          />
          <Stat
            label="Sisa waktu"
            value={`${incident.firebreak.etaFireArrivalMinutes}`}
            unit="menit"
            accent="yellow"
          />
        </motion.div>
      )}

      <AnimatePresence>
        {verificationRequest && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 300, damping: 24 }}
            className="rounded-xl border border-orange-500/50 bg-orange-500/15 px-3 py-2 text-xs font-semibold text-orange-200"
          >
            PERMINTAAN VERIFIKASI LAPANGAN: insiden {verificationRequest} dicurigai smoldering.
            Lakukan verifikasi di bawah ini.
          </motion.div>
        )}
      </AnimatePresence>

      {/* Firebreak card */}
      {incident && (
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: "easeOut", delay: 0.1 }}
          className="rounded-2xl border border-yellow-400/50 bg-yellow-400/10 p-3"
        >
          <div className="mb-2 flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-extrabold tracking-wide text-white">
            <ScissorsIcon className="size-4 shrink-0" />
            BUAT SEKAT BAKAR SEGERA
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-slate-400">Jarak ke garis potong</dt>
            <dd className="text-right font-semibold tabular-nums text-yellow-200">
              {Math.round(firebreakDistance)} m ke arah {compassName(firebreakBearing)}
            </dd>
            <dt className="text-slate-400">Sisa waktu aman</dt>
            <dd className="text-right font-semibold tabular-nums text-yellow-200">
              {incident.firebreak.etaFireArrivalMinutes} menit
            </dd>
            <dt className="text-slate-400">Panjang sekat bakar</dt>
            <dd className="text-right font-semibold tabular-nums text-yellow-200">
              {incident.firebreak.lengthMeters} m
            </dd>
            <dt className="text-slate-400">Titik GPS potong</dt>
            <dd className="text-right font-semibold tabular-nums text-yellow-200">
              {incident.firebreak.coordinates[2][0].toFixed(5)},{" "}
              {incident.firebreak.coordinates[2][1].toFixed(5)}
            </dd>
          </dl>
          <p className="mt-2 flex items-start gap-1.5 text-[11px] text-slate-300">
            <NavigationIcon className="mt-0.5 size-3.5 shrink-0 text-sky-400" />
            Insiden {incident.id} · status {FIRE_STATUS_LABEL[incident.status]} · FRP{" "}
            {incident.frpMegawatt} MW · desa terdekat {incident.nearestVillage.name} (
            {Math.round(incident.nearestVillage.distanceMeters)} m)
          </p>
        </motion.section>
      )}

      {/* Incident selector (syncs with dashboard) */}
      <section className="flex flex-wrap gap-1.5">
        <AnimatePresence mode="popLayout">
          {incidents.map((i) => (
            <motion.button
              key={i.id}
              type="button"
              layout
              whileTap={{ scale: 0.95 }}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              onClick={() => selectIncident(i.id)}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                i.id === selectedId
                  ? "border-sky-500/60 bg-sky-500/15 text-sky-200"
                  : "border-white/10 text-slate-400 hover:bg-white/5"
              }`}
            >
              {i.id}
            </motion.button>
          ))}
        </AnimatePresence>
      </section>

      {/* Ground truth verification */}
      {incident && <GroundTruthButtons incidentId={incident.id} onSent={onVerify} />}

      <p className="mt-auto text-center text-[10px] leading-relaxed text-slate-600">
        Sumber data: BMKG · Data hotspot: {firmsLive ? "NASA FIRMS (live)" : "simulasi"} ·
        Koordinat desa: Kemendagri 61.12.07{updatedAt ? ` · Update: ${wibTime(updatedAt)}` : ""}
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: string;
  unit: string;
  accent: "red" | "orange" | "yellow";
}) {
  const color =
    accent === "red"
      ? "border-red-500/30 bg-red-500/10 text-red-300"
      : accent === "orange"
        ? "border-orange-500/30 bg-orange-500/10 text-orange-300"
        : "border-yellow-400/30 bg-yellow-400/10 text-yellow-300";
  return (
    <div className={`rounded-lg border p-2 text-center ${color}`}>
      <div className="text-[10px] opacity-80">{label}</div>
      <div className="text-lg leading-tight font-bold tabular-nums">{value}</div>
      <div className="text-[9px] opacity-70">{unit}</div>
    </div>
  );
}
