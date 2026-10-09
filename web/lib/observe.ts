/**
 * Server-side client for the I-observe FastAPI service.
 *
 * Every call happens on the Next.js server, never in the browser, so there is no CORS
 * surface and no credential ever reaches the client. The Python service is untouched.
 */
import { envFromRoot } from "./env";

export const OBSERVE_BASE = process.env.OBSERVE_API_URL ?? "http://127.0.0.1:8000";

function headers(): Record<string, string> {
  // The dashboard's registered user account makes /query and /api/events require a login.
  // API_TOKEN is the backend's documented server-to-server path (see _check_auth).
  const token = envFromRoot("API_TOKEN") ?? envFromRoot("IOBSERVE_TOKEN");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Evidence paths come back as "/evidence/..." relative URLs on the FastAPI origin. */
export function absolute(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  return `${OBSERVE_BASE}${url.startsWith("/") ? "" : "/"}${url}`;
}

async function json<T>(res: Response, label: string): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${label} failed: HTTP ${res.status} ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export type EvidenceItem = {
  event_id?: string;
  timestamp_hms?: string;
  recorded_at?: string;
  identity?: string | null;
  identity_score?: number | null;
  shirt_color?: string | null;
  action?: string | null;
  event_type?: string | null;
  vlm?: string | null;
  image_url?: string | null;
  clip_url?: string | null;
};

export type QueryResult = {
  answer?: string;
  identity?: string | null;
  track_id?: number | null;
  window?: Record<string, unknown>;
  evidence?: EvidenceItem[];
  total_events?: number;
  people?: Record<string, number>;
  actions?: Record<string, number>;
};

/** Natural-language question over the recorded timeline. */
export async function queryTimeline(question: string): Promise<QueryResult> {
  const res = await fetch(`${OBSERVE_BASE}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers() },
    body: JSON.stringify({ question }),
    cache: "no-store",
  });
  return json<QueryResult>(res, "query_timeline");
}

export type EventRow = {
  id?: string;
  recorded_at?: string;
  timestamp_hms?: string;
  event_type?: string;
  identity?: string | null;
  identity_score?: number | null;
  shirt_color?: string | null;
  action?: string | null;
  shirt_color_hex?: string | null;
  image_url?: string | null;
  clip_url?: string | null;
};

export async function listEvents(options: {
  limit?: number;
  identity?: string;
  eventType?: string;
} = {}): Promise<{ count: number; events: EventRow[] }> {
  const params = new URLSearchParams();
  params.set("limit", String(options.limit ?? 20));
  if (options.identity) params.set("identity", options.identity);
  const res = await fetch(`${OBSERVE_BASE}/api/events?${params}`, {
    headers: headers(),
    cache: "no-store",
  });
  const data = await json<{ count: number; events: EventRow[] }>(res, "list_events");
  if (options.eventType) {
    const needle = options.eventType.toLowerCase();
    const events = data.events.filter(
      (e) =>
        (e.event_type ?? "").toLowerCase().includes(needle) ||
        (e.action ?? "").toLowerCase().includes(needle),
    );
    return { count: events.length, events };
  }
  return data;
}

export type SystemStatus = {
  api?: { ok: boolean; detail: string };
  postgres?: { ok: boolean; detail: string };
  redis?: { ok: boolean; detail: string };
  face?: { ok: boolean; detail: string };
  objects?: { ok: boolean; detail: string };
  vlm?: { ok: boolean; detail: string; model?: string };
  identities?: Array<{ name: string; points?: number }>;
  counts?: { events?: number };
  config?: Record<string, unknown>;
};

export async function systemStatus(): Promise<SystemStatus> {
  const res = await fetch(`${OBSERVE_BASE}/api/status`, { headers: headers(), cache: "no-store" });
  return json<SystemStatus>(res, "system_status");
}

/**
 * Trim API payloads before they reach the model.
 *
 * The raw /query response can carry hundreds of evidence rows. Every one of them would be
 * billed as input tokens and would dilute the answer, so tool results are reduced to the
 * few fields a human actually reads.
 */
export function compactQuery(result: QueryResult, maxEvidence = 8) {
  return {
    answer: result.answer ?? null,
    identity: result.identity ?? null,
    track_id: result.track_id ?? null,
    window: result.window ?? null,
    total_events: result.total_events ?? result.evidence?.length ?? 0,
    people: result.people ?? null,
    actions: result.actions ?? null,
    evidence: (result.evidence ?? []).slice(0, maxEvidence).map((e) => ({
      when: e.recorded_at ?? e.timestamp_hms ?? null,
      identity: e.identity ?? null,
      event: e.event_type ?? null,
      action: e.action ?? null,
      shirt_color: e.shirt_color ?? null,
      description: e.vlm ? e.vlm.slice(0, 120) : null,
      image_url: absolute(e.image_url) ?? null,
    })),
  };
}

export function compactEvents(data: { count: number; events: EventRow[] }) {
  return {
    count: data.count,
    events: data.events.slice(0, 15).map((e) => ({
      when: e.recorded_at ?? e.timestamp_hms ?? null,
      identity: e.identity ?? null,
      event: e.event_type ?? null,
      action: e.action ?? null,
      image_url: absolute(e.image_url) ?? null,
    })),
  };
}

export function compactStatus(s: SystemStatus) {
  return {
    api: s.api?.detail ?? null,
    postgres: s.postgres?.detail ?? null,
    face: s.face?.detail ?? null,
    objects: s.objects?.detail ?? null,
    vlm: s.vlm?.detail ?? null,
    counts: s.counts ?? null,
    identities: (s.identities ?? []).map((i) => i.name),
  };
}
