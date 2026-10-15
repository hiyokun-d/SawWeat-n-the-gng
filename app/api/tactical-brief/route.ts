import { NextRequest } from "next/server";
import { z } from "zod";
import { compassName, FIRE_STATUS_LABEL } from "@/lib/gambut";

const BriefRequestSchema = z.object({
  incidentId: z.string(),
  status: z.enum([
    "UNVERIFIED_HOTSPOT",
    "CONFIRMED_FLAMING",
    "SUSPECTED_SMOLDERING",
    "CONFIRMED_SMOLDERING",
    "EXTINGUISHED",
  ]),
  telemetry: z.object({
    windSpeedKmh: z.number(),
    windDirectionDeg: z.number(),
    windVectorDeg: z.number(),
    relativeHumidity: z.number(),
    temperatureC: z.number(),
  }),
  firebreak: z.object({
    lengthMeters: z.number(),
    etaFireArrivalMinutes: z.number(),
    centerLat: z.number(),
    centerLng: z.number(),
    /** Engine note on where the forecast wind pushes the head fire. */
    notes: z.string().optional(),
  }),
  nearestVillage: z
    .object({
      name: z.string(),
      distanceMeters: z.number(),
      threatLevel: z.enum(["AMAN", "WASPADA", "SIAGA", "BAHAYA"]),
      safeEvacuationBearingDeg: z.number(),
    })
    .nullable(),
  headFireRate: z.number(),
  burnedAreaHa: z.number(),
  hourOffset: z.number().optional(),
});

function crewsFor(lengthMeters: number): number {
  if (lengthMeters <= 300) return 1;
  if (lengthMeters <= 600) return 2;
  return 3;
}

function wibTime(offsetMinutes: number): string {
  const d = new Date(Date.now() + offsetMinutes * 60_000);
  return d.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Pontianak",
  });
}

/**
 * AI Tactical Dispatch Generator: converts spatial telemetry into a short
 * BPBD SOP command briefing (prd.md). Rule-based so it works with no API key;
 * the same contract can later be swapped for an LLM call. The goal is damage
 * limitation: cut the spread path and clear the threatened village.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Body harus JSON" }, { status: 400 });
  }

  const parsed = BriefRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Payload briefing tidak valid" }, { status: 400 });
  }

  const { incidentId, status, telemetry, firebreak, nearestVillage, headFireRate, burnedAreaHa, hourOffset } =
    parsed.data;

  if (status === "EXTINGUISHED") {
    return Response.json({
      ok: true,
      brief:
        `Insiden ${incidentId} dinyatakan padam total. Hentikan simulasi perambatan, ` +
        `petahankan regu di lokasi untuk pemantauan smoldering bawah tanah selama 24 jam, ` +
        `dan laporkan ke Pusdalops BPBD Kab. Kubu Raya.`,
    });
  }

  const windDirName = compassName(telemetry.windVectorDeg);
  const crews = crewsFor(firebreak.lengthMeters);
  const deadline = wibTime(firebreak.etaFireArrivalMinutes);
  const center = `${firebreak.centerLat.toFixed(5)}, ${firebreak.centerLng.toFixed(5)}`;

  const sentences: string[] = [];
  sentences.push(
    `Angin berhembus ${Math.round(telemetry.windSpeedKmh)} km/jam ke ${windDirName} ` +
      `(kelembapan ${Math.round(telemetry.relativeHumidity)}%, suhu ${Math.round(telemetry.temperatureC)}°C) ` +
      `mendorong kepala api ${Math.round(headFireRate)} m/jam` +
      (nearestVillage ? ` (permukiman terdekat: ${nearestVillage.name}).` : "."),
  );
  if (firebreak.notes) sentences.push(firebreak.notes);
  sentences.push(
    `Kerahkan ${crews} regu MPA untuk memotong jalur sekat bakar sepanjang ` +
      `${firebreak.lengthMeters} m di sekitar koordinat ${center} sebelum pukul ${deadline} WIB ` +
      `(sisa waktu aman ${firebreak.etaFireArrivalMinutes} menit).`,
  );

  if (nearestVillage && (nearestVillage.threatLevel === "BAHAYA" || nearestVillage.threatLevel === "SIAGA")) {
    sentences.push(
      `Status ${nearestVillage.threatLevel}: ${nearestVillage.name} berjarak ` +
        `${Math.round(nearestVillage.distanceMeters)} m dari titik api. Siapkan jalur evakuasi ` +
        `warga ke arah ${compassName(nearestVillage.safeEvacuationBearingDeg)} ` +
        `(tegak lurus arah angin).`,
    );
  }

  if (status === "SUSPECTED_SMOLDERING" || status === "CONFIRMED_SMOLDERING") {
    sentences.push(
      `Peringatan smoldering: titik panas hilang dari satelit namun ${FIRE_STATUS_LABEL[status].toLowerCase()}. ` +
        `Jangan tandai padam sebelum verifikasi lapangan; gali lubang uji kedalaman 0,5 m di sekitar koordinat.`,
    );
  } else if (status === "UNVERIFIED_HOTSPOT") {
    sentences.push(
      `Titik panas belum terverifikasi (FRP rendah/awal). Kirim satu regu untuk konfirmasi ` +
        `sebelum membakar lahan secara preventif.`,
    );
  }

  sentences.push(
    `Estimasi luas terancam ${burnedAreaHa.toFixed(2)} ha pada t+${hourOffset ?? 0} jam.`,
  );

  return Response.json({ ok: true, brief: sentences.join(" ") });
}
