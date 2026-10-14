/**
 * BroadcastChannel + localStorage sync between the desktop dashboard and
 * the mobile HUD (prd.md: 0 ms latency across two browser windows).
 */

export type SyncMessage =
  | {
      type: "incident:status";
      id: string;
      status: string;
      verifiedBy: string;
      verifiedAt: string;
    }
  | {
      type: "incident:select";
      id: string;
    }
  | {
      type: "weather:telemetry";
      telemetry: {
        windSpeedKmh: number;
        windDirectionDeg: number;
        windVectorDeg: number;
        relativeHumidity: number;
        temperatureC: number;
        updatedAt: string;
      };
    }
  | {
      type: "incident:satellite-update";
      kind: "new-hotspot" | "hotspot-lost";
    };

const CHANNEL_NAME = "gambutwatch";
const STORAGE_KEY = "gambutwatch:status";

type Handler = (msg: SyncMessage) => void;

/** Subscribe to live cross-window messages. Returns an unsubscribe fn. */
export function subscribeSync(handler: Handler): () => void {
  if (typeof window === "undefined") return () => {};

  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event: MessageEvent<SyncMessage>) => handler(event.data);
  } catch {
    // BroadcastChannel unavailable; localStorage events still work.
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      handler(JSON.parse(event.newValue) as SyncMessage);
    } catch {
      // ignore malformed payloads
    }
  };
  window.addEventListener("storage", onStorage);

  return () => {
    channel?.close();
    window.removeEventListener("storage", onStorage);
  };
}

/** Publish a message to all other windows/tabs. */
export function publishSync(msg: SyncMessage): void {
  if (typeof window === "undefined") return;
  try {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage(msg);
    channel.close();
  } catch {
    // fall through to localStorage
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(msg));
  } catch {
    // storage may be full or disabled; the live channel already delivered
  }
}

/** Persist the latest status of every incident so a reloaded tab restores state. */
export function persistStatuses(
  statuses: Record<string, { status: string; verifiedBy?: string; verifiedAt?: string }>,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ type: "snapshot", statuses }));
  } catch {
    // ignore
  }
}

export function loadPersistedStatuses(): Record<
  string,
  { status: string; verifiedBy?: string; verifiedAt?: string }
> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { type?: string; statuses?: Record<string, { status: string; verifiedBy?: string; verifiedAt?: string }> };
    if (parsed.type === "snapshot" && parsed.statuses) return parsed.statuses;
  } catch {
    // ignore
  }
  return {};
}
