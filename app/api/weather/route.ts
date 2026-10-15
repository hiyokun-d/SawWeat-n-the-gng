import { NextRequest } from "next/server";
import { BmkgVillages, DEFAULT_ADM4 } from "@/lib/gambut";
import { fetchBmkg, fetchOpenMeteoBatch } from "@/lib/weatherProviders";

const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" };

/**
 * Weather for the village given by adm4 (Kemendagri code), with the
 * forecast ahead for the spread model. BMKG
 * (api.bmkg.go.id/publik/prakiraan-cuaca) answers first; Open-Meteo at the
 * village coordinate covers a slow or failing BMKG. The response names its
 * source because both providers require attribution. When neither answers
 * the route fails: the engine does not simulate on made-up weather.
 */
export async function GET(request: NextRequest) {
  const adm4 = request.nextUrl.searchParams.get("adm4") ?? DEFAULT_ADM4;
  if (!/^\d{2}\.\d{2}\.\d{2}\.\d{4}$/.test(adm4)) {
    return Response.json(
      { ok: false, error: `Kode wilayah adm4 tidak valid: ${adm4}` },
      { status: 400 },
    );
  }

  const failures: string[] = [];
  const started = Date.now();
  const timing = () => ({ ...CACHE_HEADERS, "x-upstream-ms": String(Date.now() - started) });
  try {
    const { telemetry, lokasi } = await fetchBmkg(adm4);
    return Response.json({ ok: true, source: "bmkg", lokasi, telemetry }, { headers: timing() });
  } catch (err) {
    failures.push(err instanceof Error ? err.message : "BMKG tidak merespons");
  }

  const village = BmkgVillages.find((v) => v.adm4 === adm4) ?? BmkgVillages[0];
  try {
    const [telemetry] = await fetchOpenMeteoBatch([village]);
    return Response.json({ ok: true, source: "open-meteo", telemetry }, { headers: timing() });
  } catch (err) {
    failures.push(err instanceof Error ? err.message : "Open-Meteo tidak merespons");
  }

  return Response.json(
    { ok: false, error: `Data cuaca tidak tersedia: ${failures.join("; ")}` },
    { status: 503, headers: { "x-upstream-ms": String(Date.now() - started) } },
  );
}
