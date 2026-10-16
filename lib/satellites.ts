/**
 * The five satellites behind every NASA FIRMS detection in the app, with the
 * swath width of their fire sensor. Positions come from CelesTrak orbital
 * elements (TLE) propagated with SGP4, so the map shows where each one
 * really is now: its sub-satellite point and its ground track.
 */

export interface FireSatellite {
  norad: number;
  name: string;
  sensor: "VIIRS" | "MODIS";
  /** FIRMS dataset whose detections this satellite produces. */
  firmsSource: string;
  /** Instrument swath width across track, km. */
  swathKm: number;
  operator: string;
  /** Launch date (UTC). */
  launched: string;
}

export const FIRE_SATELLITES: FireSatellite[] = [
  { norad: 37849, name: "Suomi NPP", sensor: "VIIRS", firmsSource: "VIIRS_SNPP_NRT", swathKm: 3060, operator: "NASA / NOAA", launched: "2011-10-28" },
  { norad: 43013, name: "NOAA-20", sensor: "VIIRS", firmsSource: "VIIRS_NOAA20_NRT", swathKm: 3060, operator: "NOAA / NASA", launched: "2017-11-18" },
  { norad: 54234, name: "NOAA-21", sensor: "VIIRS", firmsSource: "VIIRS_NOAA21_NRT", swathKm: 3060, operator: "NOAA / NASA", launched: "2022-11-10" },
  { norad: 25994, name: "Terra", sensor: "MODIS", firmsSource: "MODIS_NRT", swathKm: 2330, operator: "NASA", launched: "1999-12-18" },
  { norad: 27424, name: "Aqua", sensor: "MODIS", firmsSource: "MODIS_NRT", swathKm: 2330, operator: "NASA", launched: "2002-05-04" },
];

/**
 * Published mission costs, US$. The three VIIRS satellites are one program (JPSS,
 * lifecycle estimate covering Suomi NPP, JPSS-1/NOAA-20 and JPSS-2/NOAA-21, NOAA via
 * GAO-13-676); Terra "over US$1.3 billion" (Lockheed Martin build); Aqua US$952 million (2002).
 */
export const FLEET_COST = [
  { label: "JPSS program: Suomi NPP, NOAA-20, NOAA-21", usd: 11.3e9 },
  { label: "Terra (EOS AM-1)", usd: 1.3e9 },
  { label: "Aqua (EOS PM-1)", usd: 0.952e9 },
];

export interface SatelliteTle {
  norad: number;
  name: string;
  line1: string;
  line2: string;
}

/** Sub-satellite samples for one satellite over the payload's time window. */
export interface SatelliteTrack {
  norad: number;
  name: string;
  sensor: string;
  swathKm: number;
  lat: number[];
  lng: number[];
  altKm: number[];
}

export interface SatellitesPayload {
  ok: boolean;
  /** When the orbital elements were fetched from CelesTrak. */
  fetchedAt: string;
  /** First sample time (ISO) and spacing; sample i is at start + i * stepS. */
  start: string;
  stepS: number;
  sats: SatelliteTrack[];
}
