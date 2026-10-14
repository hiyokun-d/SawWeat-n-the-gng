"use client";

import { FlameIcon, CheckCircle2Icon, CloudFogIcon } from "lucide-react";
import { useState } from "react";
import { publishSync } from "@/lib/syncChannel";
import type { FireStatus } from "@/lib/gambut";

export interface GroundTruthButtonsProps {
  incidentId: string;
  onSent?: (status: FireStatus) => void;
}

const VERIFY_ACTIONS: {
  status: FireStatus;
  label: string;
  sub: string;
  icon: React.ElementType;
  className: string;
}[] = [
  {
    status: "CONFIRMED_FLAMING",
    label: "API PERMUKAAN AKTIF",
    sub: "Api menyala di permukaan",
    icon: FlameIcon,
    className: "border-red-500/50 bg-red-500/15 text-red-200 hover:bg-red-500/25",
  },
  {
    status: "CONFIRMED_SMOLDERING",
    label: "BARA / ASAP BAWAH TANAH",
    sub: "Cegah satelit menandai padam palsu",
    icon: CloudFogIcon,
    className: "border-orange-500/50 bg-orange-500/15 text-orange-200 hover:bg-orange-500/25",
  },
  {
    status: "EXTINGUISHED",
    label: "SUDAH PADAM TOTAL",
    sub: "Hentikan simulasi perambatan",
    icon: CheckCircle2Icon,
    className: "border-emerald-500/50 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25",
  },
];

/**
 * One-click field verification panel (prd.md ground-truth loop).
 * Sends status updates back to the BPBD dashboard over BroadcastChannel.
 */
export default function GroundTruthButtons({ incidentId, onSent }: GroundTruthButtonsProps) {
  const [sent, setSent] = useState<FireStatus | null>(null);

  const verify = (status: FireStatus) => {
    const verifiedBy = "Regu MPA Lapangan";
    publishSync({
      type: "incident:status",
      id: incidentId,
      status,
      verifiedBy,
      verifiedAt: new Date().toISOString(),
    });
    setSent(status);
    onSent?.(status);
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
        Verifikasi Lapangan 1-Klik
      </p>
      {VERIFY_ACTIONS.map(({ status, label, sub, icon: Icon, className }) => (
        <button
          key={status}
          type="button"
          onClick={() => verify(status)}
          className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors active:scale-[0.98] ${className} ${
            sent === status ? "ring-2 ring-white/30" : ""
          }`}
        >
          <Icon className="size-7 shrink-0" />
          <span className="min-w-0">
            <span className="block text-sm font-bold">{label}</span>
            <span className="block text-xs opacity-80">{sub}</span>
          </span>
          {sent === status && (
            <span className="ml-auto shrink-0 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold">
              TERKIRIM
            </span>
          )}
        </button>
      ))}
      {sent && (
        <p className="text-center text-[11px] text-slate-500">
          Status terkirim ke Dasbor Pusdalops BPBD
        </p>
      )}
    </div>
  );
}
