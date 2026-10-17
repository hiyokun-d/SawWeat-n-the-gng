import { gzipSync } from "node:zlib";

/** Bodies smaller than this go out as is: gzip framing would not pay for itself. */
const MIN_GZIP_BYTES = 1024;

export interface PreparedJson {
  text: string;
  gz: Buffer | null;
}

/** Serialize and compress once, for a body served to many requests (the FIRMS snapshot). */
export function prepareJson(body: unknown): PreparedJson {
  const text = JSON.stringify(body);
  return { text, gz: text.length >= MIN_GZIP_BYTES ? gzipSync(text, { level: 6 }) : null };
}

function acceptsGzip(request: Request): boolean {
  return /\bgzip\b/.test(request.headers.get("accept-encoding") ?? "");
}

/**
 * JSON response, gzipped when the browser accepts it. Next 16 compresses pages
 * but sends route handler bodies uncompressed, and the FIRMS table alone is 3 MB raw.
 */
export function sendJson(request: Request, prepared: PreparedJson, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  headers.append("Vary", "Accept-Encoding");
  if (prepared.gz && acceptsGzip(request)) {
    headers.set("Content-Encoding", "gzip");
    return new Response(new Uint8Array(prepared.gz), { ...init, headers });
  }
  return new Response(prepared.text, { ...init, headers });
}

export function jsonResponse(request: Request, body: unknown, init: ResponseInit = {}): Response {
  return sendJson(request, prepareJson(body), init);
}
