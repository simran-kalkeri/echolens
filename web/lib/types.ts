// COPIED from docs/api-contract.ts - keep in sync, do not change shapes.
// EchoLens API contract — single source of truth shared by api/ (FastAPI) and web/ (Next.js).
// All endpoints are GET unless noted. Base URL: process.env.NEXT_PUBLIC_API_URL (e.g. http://localhost:8000).
// Every workspace-scoped endpoint takes ?ws=<workspace id>.
// Dates are ISO strings "YYYY-MM-DD" (daily granularity) unless named *_at (full ISO datetime).

export type Source = "review" | "ticket" | "survey";
export type Sentiment = "positive" | "neutral" | "negative";
export type Intent = "complaint" | "bug_report" | "feature_request" | "question" | "praise" | "churn_risk";
export type Urgency = "low" | "medium" | "high" | "critical";

// L1 aspect categories (fixed, supervised). L2 themes are discovered by clustering and named by the LLM.
export type AspectId =
  | "performance_reliability" | "bugs_errors" | "ui_ux" | "pricing_billing" | "account_access"
  | "customer_service" | "delivery_logistics" | "ads" | "content_catalog" | "connectivity_devices"
  | "features" | "privacy_security" | "updates" | "other";

export interface Workspace {
  id: string;            // "spotify" | "apple" | "amazon" | "uber" | "delta" | "xbox"
  name: string;          // "Spotify"
  sources: Source[];
  n_feedback: number;
  date_min: string;
  date_max: string;
}

export interface Feedback {
  id: string;
  ws: string;
  source: Source;
  text: string;
  created_at: string;
  rating: number | null;          // 1..5 for reviews/surveys
  sentiment: Sentiment;
  sentiment_score: number;        // -1..1
  intent: Intent;
  urgency: Urgency;
  aspects: { aspect: AspectId; sentiment: Sentiment }[];
  theme_id: string | null;
  theme_name: string | null;
}

// GET /api/workspaces
export type WorkspacesResponse = Workspace[];

// GET /api/overview?ws=
export interface OverviewResponse {
  kpis: {
    total: number;
    negative_pct: number;         // 0..100
    sentiment_index: number;      // -100..100 (pos% - neg%)
    avg_rating: number | null;
    open_alerts: number;
    themes: number;
    critical_count: number;
  };
  sentiment_trend: { date: string; positive: number; neutral: number; negative: number }[];
  theme_stream: { date: string; [themeName: string]: number | string }[]; // top-8 themes daily counts (streamgraph)
  channel_mix: { source: Source; count: number }[];
  intent_mix: { intent: Intent; count: number }[];
  urgency_mix: { urgency: Urgency; count: number }[];
  aspect_sentiment: { aspect: AspectId; label: string; positive: number; neutral: number; negative: number }[];
  top_movers: { theme_id: string; name: string; delta_pct: number; neg_share: number; count: number }[];
  calendar: { date: string; negative: number; total: number }[];   // calendar heatmap
}

// GET /api/themes?ws=
export interface Theme {
  id: string;
  name: string;
  description: string;
  aspect: AspectId;
  count: number;
  neg_share: number;              // 0..1
  sentiment_score: number;        // -1..1 mean
  keywords: string[];
  trend: { date: string; count: number }[];
}
export interface ThemesResponse {
  aspects: { id: AspectId; label: string; count: number; positive: number; neutral: number; negative: number; themes: Theme[] }[];
}

// GET /api/themes/{theme_id}?ws=
export interface ThemeDetailResponse extends Theme {
  intent_mix: { intent: Intent; count: number }[];
  urgency_mix: { urgency: Urgency; count: number }[];
  related: { id: string; name: string; weight: number }[];
  evidence: Feedback[];           // most representative items (closest to centroid)
  summary: string | null;         // LLM summary (markdown) with [#feedback_id] citations
}

// GET /api/graph?ws=   (knowledge graph: aspects, themes, intents, sources + co-occurrence edges)
export interface GraphResponse {
  nodes: {
    id: string;
    label: string;
    type: "aspect" | "theme" | "intent" | "source";
    size: number;                 // feedback volume
    sentiment: number;            // -1..1
    community: number;            // Louvain community id
    pagerank: number;
  }[];
  edges: { source: string; target: string; weight: number; kind: "belongs_to" | "co_occurs" | "has_intent" | "from_source" }[];
}

// GET /api/galaxy?ws=   (3D UMAP projection of embeddings, sampled ≤ 6000 points)
export interface GalaxyResponse {
  points: { id: string; x: number; y: number; z: number; cluster: number; sentiment: number; text: string }[];
  clusters: { id: number; theme_id: string; name: string; centroid: [number, number, number]; count: number }[];
}

// GET /api/alerts?ws=
export interface Alert {
  id: string;
  kind: "spike" | "emerging_theme";
  theme_id: string;
  theme_name: string;
  start_date: string;
  peak_date: string;
  severity: "low" | "medium" | "high" | "critical";
  score: number;                  // anomaly score (z or Poisson surprise)
  baseline: number;               // expected daily negative count
  observed: number;               // observed at peak
  series: { date: string; count: number; expected: number; upper: number }[];
  evidence: Feedback[];
  summary: string | null;         // LLM explanation with [#feedback_id] citations
}
export type AlertsResponse = Alert[];

// GET /api/feedback?ws=&q=&aspect=&sentiment=&intent=&urgency=&source=&theme=&page=1&page_size=25
// q triggers hybrid semantic search; otherwise newest first.
export interface FeedbackPage { items: Feedback[]; total: number; page: number; page_size: number }

// GET /api/pipeline   (latest pipeline run; DAG mirrors the architecture diagram)
export interface PipelineStage {
  id: string;                     // "ingest" | "clean_dedup" | "nlp" | "absa" | "embed_cluster" | "analytics" | "retrieval" | "emerging" | "insights" | "dashboard"
  name: string;
  engine: "spark" | "kaggle-gpu" | "groq" | "python" | "duckdb";
  status: "success" | "failed" | "skipped" | "running";
  rows_in: number | null;
  rows_out: number | null;
  duration_s: number;
  description: string;
  metrics: Record<string, number | string>;
  checks: { name: string; passed: boolean; value: string }[];   // data-quality checks
}
export interface PipelineResponse {
  run_id: string;
  started_at: string;
  finished_at: string;
  stages: PipelineStage[];
  edges: { source: string; target: string }[];
}

// GET /api/eval   (quantitative evaluation report)
export interface MetricRow { name: string; value: number; baseline?: number; baseline_name?: string; threshold?: number; passed?: boolean; unit?: string }
export interface EvalResponse {
  generated_at: string;
  summary: MetricRow[];           // headline numbers
  classification: {
    task: string;                 // "sentiment" | "intent" | "urgency" | "aspects"
    dataset: string;
    metrics: MetricRow[];
    per_class: { label: string; precision: number; recall: number; f1: number; support: number }[];
    confusion: { labels: string[]; matrix: number[][] } | null;
  }[];
  clustering: MetricRow[];
  retrieval: { metrics: MetricRow[]; by_method: { method: string; recall_at_10: number; ndcg_at_10: number; mrr: number }[] };
  trends: { metrics: MetricRow[]; incidents: { name: string; injected_at: string; detected_at: string | null; delay_days: number | null }[] };
  grounding: MetricRow[];
  cost: MetricRow[];
}

// POST /api/analyst/ask   body: { ws: string; question: string }
// Response: text/event-stream, each `data:` line is one AnalystEvent JSON.
export type AnalystEvent =
  | { type: "status"; text: string }
  | { type: "tool"; name: string; args: Record<string, unknown>; summary: string }
  | { type: "token"; text: string }
  | {
      type: "final";
      answer: string;             // markdown; citations inline as [#feedback_id]
      citations: Feedback[];
      claims: { text: string; supported: boolean; citation_ids: string[] }[];
      groundedness: number;       // 0..1 share of supported claims
    }
  | { type: "error"; text: string };

// GET /api/insights?ws=   precomputed insight cards
export interface Insight { id: string; title: string; body: string; kind: "pain_point" | "feature_request" | "emerging" | "praise"; citations: Feedback[]; groundedness: number; theme_id: string | null }
export type InsightsResponse = Insight[];
