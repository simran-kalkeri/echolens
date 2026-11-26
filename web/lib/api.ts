import type {
  AlertsResponse,
  AnalystEvent,
  EvalResponse,
  FeedbackPage,
  GalaxyResponse,
  GraphResponse,
  InsightsResponse,
  OverviewResponse,
  PipelineResponse,
  ThemeDetailResponse,
  ThemesResponse,
  WorkspacesResponse,
  AspectId,
  Intent,
  Sentiment,
  Source,
  Urgency,
} from "./types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
export const USING_MOCK = !API_URL;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
  const res = await fetch(`${API_URL}${path}${qs.size ? `?${qs}` : ""}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new ApiError(res.status, `${res.status} ${res.statusText} — ${path}`);
  return res.json() as Promise<T>;
}

/** Simulated network latency so loading states are exercised in mock mode. */
const delay = (ms = 260 + Math.random() * 280) => new Promise((r) => setTimeout(r, ms));
const mock = () => import("./mock");

export interface FeedbackQuery {
  ws: string;
  q?: string;
  aspect?: AspectId;
  sentiment?: Sentiment;
  intent?: Intent;
  urgency?: Urgency;
  source?: Source;
  theme?: string;
  page?: number;
  page_size?: number;
}

export const api = {
  async workspaces(): Promise<WorkspacesResponse> {
    if (USING_MOCK) return (await mock()).buildWorkspaces();
    return get("/api/workspaces");
  },
  async overview(ws: string): Promise<OverviewResponse> {
    if (USING_MOCK) {
      await delay();
      return (await mock()).buildOverview(ws);
    }
    return get("/api/overview", { ws });
  },
  async themes(ws: string): Promise<ThemesResponse> {
    if (USING_MOCK) {
      await delay();
      return (await mock()).buildThemes(ws);
    }
    return get("/api/themes", { ws });
  },
  async theme(ws: string, id: string): Promise<ThemeDetailResponse> {
    if (USING_MOCK) {
      await delay(200);
      const t = (await mock()).buildThemeDetail(ws, id);
      if (!t) throw new ApiError(404, `Theme ${id} not found`);
      return t;
    }
    return get(`/api/themes/${encodeURIComponent(id)}`, { ws });
  },
  async graph(ws: string): Promise<GraphResponse> {
    if (USING_MOCK) {
      await delay();
      return (await mock()).buildGraph(ws);
    }
    return get("/api/graph", { ws });
  },
  async galaxy(ws: string): Promise<GalaxyResponse> {
    if (USING_MOCK) {
      await delay();
      return (await mock()).buildGalaxy(ws);
    }
    return get("/api/galaxy", { ws });
  },
  async alerts(ws: string): Promise<AlertsResponse> {
    if (USING_MOCK) {
      await delay();
      return (await mock()).buildAlerts(ws);
    }
    return get("/api/alerts", { ws });
  },
  async insights(ws: string): Promise<InsightsResponse> {
    if (USING_MOCK) {
      await delay();
      return (await mock()).buildInsights(ws);
    }
    return get("/api/insights", { ws });
  },
  async feedback(query: FeedbackQuery): Promise<FeedbackPage> {
    const { page = 1, page_size = 25 } = query;
    if (USING_MOCK) {
      await delay(180);
      return (await mock()).queryFeedback({ ...query, page, page_size });
    }
    return get("/api/feedback", { ...query, page, page_size });
  },
  async pipeline(): Promise<PipelineResponse> {
    if (USING_MOCK) {
      await delay();
      return (await mock()).PIPELINE;
    }
    return get("/api/pipeline");
  },
  async eval(): Promise<EvalResponse> {
    if (USING_MOCK) {
      await delay();
      return (await mock()).EVAL;
    }
    return get("/api/eval");
  },
};

/**
 * POST /api/analyst/ask — Server-Sent Events over a POST body, so EventSource can't be used.
 * Parses `data:` lines from a fetch ReadableStream and yields AnalystEvents.
 */
export async function* askAnalyst(ws: string, question: string, signal?: AbortSignal): AsyncGenerator<AnalystEvent> {
  if (USING_MOCK) {
    yield* (await mock()).mockAnalyst(ws, question, signal);
    return;
  }
  const res = await fetch(`${API_URL}/api/analyst/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ ws, question }),
    signal,
  });
  if (!res.ok || !res.body) {
    const error = await res.json().catch(() => null);
    const detail = typeof error?.detail === "string" ? error.detail : `Analyst request failed (${res.status})`;
    yield { type: "error", text: detail };
    return;
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    // SSE events are separated by a blank line; tolerate \r\n
    const parts = buf.split(/\r?\n\r?\n/);
    buf = parts.pop() ?? "";
    for (const part of parts) {
      const data = part
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).replace(/^ /, ""))
        .join("\n");
      if (!data || data === "[DONE]") continue;
      try {
        yield JSON.parse(data) as AnalystEvent;
      } catch {
        // ignore malformed keep-alive lines
      }
    }
  }
}
