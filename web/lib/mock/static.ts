import type { EvalResponse, PipelineResponse } from "../types";

export const PIPELINE: PipelineResponse = {
  run_id: "run_2022-07-01_0412",
  started_at: "2022-07-01T04:12:08Z",
  finished_at: "2022-07-01T05:03:51Z",
  stages: [
    {
      id: "ingest", name: "Ingestion & Validation", engine: "spark", status: "success", rows_in: 1_284_310, rows_out: 1_271_944, duration_s: 214,
      description: "Reads app-store reviews, support tickets and survey exports; enforces schema, language and timestamp validity.",
      metrics: { sources: 3, schema_version: "v4", rejected_rows: 12_366, partitions: 64 },
      checks: [
        { name: "Schema conformance", passed: true, value: "99.04%" },
        { name: "Null text rate < 0.5%", passed: true, value: "0.21%" },
        { name: "Timestamp in range", passed: true, value: "100%" },
        { name: "Language = en", passed: true, value: "96.8%" },
      ],
    },
    {
      id: "clean_dedup", name: "Cleaning & Deduplication", engine: "spark", status: "success", rows_in: 1_271_944, rows_out: 1_108_502, duration_s: 388,
      description: "Normalizes text, strips PII, and removes exact plus near-duplicates via MinHash LSH (Jaccard ≥ 0.85).",
      metrics: { exact_dupes: 96_210, near_dupes: 67_232, pii_redacted: 18_440, minhash_bands: 32 },
      checks: [
        { name: "Duplicate rate after dedup < 1%", passed: true, value: "0.34%" },
        { name: "PII leakage (regex audit)", passed: true, value: "0 hits" },
        { name: "Min text length ≥ 3 tokens", passed: true, value: "99.6%" },
      ],
    },
    {
      id: "nlp", name: "NLP Intelligence Pipeline", engine: "kaggle-gpu", status: "success", rows_in: 1_108_502, rows_out: 1_108_502, duration_s: 1_046,
      description: "Fine-tuned DeBERTa-v3 multi-task heads for sentiment, intent and urgency on a Kaggle T4 x2.",
      metrics: { model: "deberta-v3-base", batch_size: 256, throughput_rps: 1_060, gpu: "T4 x2" },
      checks: [
        { name: "Sentiment macro-F1 ≥ 0.85", passed: true, value: "0.891" },
        { name: "Intent macro-F1 ≥ 0.75", passed: true, value: "0.812" },
        { name: "Prediction drift (PSI) < 0.2", passed: true, value: "0.07" },
      ],
    },
    {
      id: "absa", name: "Aspect Sentiment & Urgency", engine: "kaggle-gpu", status: "success", rows_in: 1_108_502, rows_out: 1_431_877, duration_s: 612,
      description: "Aspect-based sentiment over 14 fixed L1 aspects; one row per (feedback, aspect) pair.",
      metrics: { aspects: 14, avg_aspects_per_item: 1.29, urgency_critical: 21_480 },
      checks: [
        { name: "Aspect micro-F1 ≥ 0.75", passed: true, value: "0.784" },
        { name: "Unassigned ('other') < 15%", passed: true, value: "9.8%" },
      ],
    },
    {
      id: "embed_cluster", name: "Embeddings & Topic Clustering", engine: "kaggle-gpu", status: "success", rows_in: 1_108_502, rows_out: 412, duration_s: 1_380,
      description: "bge-small embeddings → UMAP → HDBSCAN; clusters named by an LLM into L2 themes.",
      metrics: { embedding_dim: 384, clusters: 412, noise_pct: "18.2%", umap_neighbors: 30 },
      checks: [
        { name: "Silhouette ≥ 0.15", passed: true, value: "0.21" },
        { name: "Noise share < 25%", passed: true, value: "18.2%" },
        { name: "Theme name coherence (LLM judge)", passed: false, value: "0.71 / 0.75" },
      ],
    },
    {
      id: "analytics", name: "Analytics & Trend Detection", engine: "duckdb", status: "success", rows_in: 1_431_877, rows_out: 74_520, duration_s: 41,
      description: "Daily aggregates per workspace × theme × aspect × sentiment in DuckDB; seasonality-adjusted baselines.",
      metrics: { aggregates: 74_520, workspaces: 6, days: 181 },
      checks: [
        { name: "Row count reconciles", passed: true, value: "Δ 0" },
        { name: "No gaps in daily series", passed: true, value: "181 / 181" },
      ],
    },
    {
      id: "emerging", name: "Emerging Issue Detection", engine: "python", status: "success", rows_in: 74_520, rows_out: 23, duration_s: 18,
      description: "Poisson surprise and robust z-score on daily negative counts; flags new themes with no history.",
      metrics: { alerts: 23, critical: 3, method: "poisson + robust-z" },
      checks: [
        { name: "Injected incidents detected", passed: true, value: "5 / 6" },
        { name: "False alerts / week < 2", passed: true, value: "0.9" },
      ],
    },
    {
      id: "retrieval", name: "Semantic Retrieval", engine: "python", status: "success", rows_in: 1_108_502, rows_out: 1_108_502, duration_s: 96,
      description: "Hybrid retrieval: BM25 + dense (bge-small) fused with RRF, reranked by a cross-encoder.",
      metrics: { index: "faiss-hnsw", recall_at_10: 0.874, p95_latency_ms: 142 },
      checks: [
        { name: "Recall@10 ≥ 0.80", passed: true, value: "0.874" },
        { name: "p95 latency < 300ms", passed: true, value: "142ms" },
      ],
    },
    {
      id: "insights", name: "LLM Insight Generation", engine: "groq", status: "success", rows_in: 412, rows_out: 412, duration_s: 233,
      description: "Llama-3.1-70B on Groq writes theme summaries with [#id] citations; claims verified by an NLI checker.",
      metrics: { model: "llama-3.1-70b", tokens: "1.9M", cost_usd: 1.12, groundedness: "92.6%" },
      checks: [
        { name: "Groundedness ≥ 0.90", passed: true, value: "0.926" },
        { name: "Citation validity", passed: true, value: "99.1%" },
      ],
    },
    {
      id: "dashboard", name: "Interactive Dashboard", engine: "python", status: "success", rows_in: null, rows_out: null, duration_s: 12,
      description: "FastAPI serves precomputed aggregates and the analyst agent to the Next.js frontend.",
      metrics: { endpoints: 12, cache_hit_rate: "96%" },
      checks: [{ name: "Smoke tests", passed: true, value: "12 / 12" }],
    },
  ],
  edges: [
    { source: "ingest", target: "clean_dedup" },
    { source: "clean_dedup", target: "nlp" },
    { source: "nlp", target: "absa" },
    { source: "nlp", target: "embed_cluster" },
    { source: "absa", target: "analytics" },
    { source: "embed_cluster", target: "analytics" },
    { source: "analytics", target: "emerging" },
    { source: "analytics", target: "retrieval" },
    { source: "retrieval", target: "insights" },
    { source: "emerging", target: "dashboard" },
    { source: "insights", target: "dashboard" },
  ],
};

const SENT_LABELS = ["negative", "neutral", "positive"];
const INTENT_LABELS = ["complaint", "bug_report", "feature_req", "question", "praise", "churn_risk"];

export const EVAL: EvalResponse = {
  generated_at: "2022-07-01T05:10:00Z",
  summary: [
    { name: "Sentiment macro-F1", value: 0.891, baseline: 0.742, baseline_name: "VADER", threshold: 0.85, passed: true },
    { name: "Intent macro-F1", value: 0.812, baseline: 0.611, baseline_name: "zero-shot BART", threshold: 0.75, passed: true },
    { name: "Retrieval nDCG@10", value: 0.781, baseline: 0.642, baseline_name: "BM25", threshold: 0.7, passed: true },
    { name: "Groundedness", value: 0.926, baseline: 0.71, baseline_name: "no-retrieval LLM", threshold: 0.9, passed: true },
    { name: "Incident recall", value: 0.833, threshold: 0.8, passed: true },
    { name: "Topic coherence (NPMI)", value: 0.118, baseline: 0.081, baseline_name: "LDA", threshold: 0.12, passed: false },
  ],
  classification: [
    {
      task: "sentiment", dataset: "gold-2k (human labelled)",
      metrics: [
        { name: "Macro-F1", value: 0.891, threshold: 0.85, passed: true },
        { name: "Accuracy", value: 0.913 },
        { name: "ECE", value: 0.034, threshold: 0.05, passed: true },
      ],
      per_class: [
        { label: "negative", precision: 0.94, recall: 0.93, f1: 0.935, support: 1012 },
        { label: "neutral", precision: 0.79, recall: 0.81, f1: 0.8, support: 402 },
        { label: "positive", precision: 0.93, recall: 0.94, f1: 0.935, support: 586 },
      ],
      confusion: { labels: SENT_LABELS, matrix: [[941, 58, 13], [44, 326, 32], [9, 26, 551]] },
    },
    {
      task: "intent", dataset: "gold-2k (human labelled)",
      metrics: [
        { name: "Macro-F1", value: 0.812, threshold: 0.75, passed: true },
        { name: "Accuracy", value: 0.846 },
      ],
      per_class: [
        { label: "complaint", precision: 0.86, recall: 0.89, f1: 0.875, support: 640 },
        { label: "bug_report", precision: 0.88, recall: 0.86, f1: 0.87, support: 412 },
        { label: "feature_request", precision: 0.82, recall: 0.8, f1: 0.81, support: 266 },
        { label: "question", precision: 0.71, recall: 0.66, f1: 0.684, support: 158 },
        { label: "praise", precision: 0.93, recall: 0.95, f1: 0.94, support: 398 },
        { label: "churn_risk", precision: 0.74, recall: 0.7, f1: 0.72, support: 126 },
      ],
      confusion: {
        labels: INTENT_LABELS,
        matrix: [
          [570, 31, 12, 9, 2, 16],
          [34, 354, 8, 14, 0, 2],
          [18, 6, 213, 22, 5, 2],
          [21, 13, 15, 104, 3, 2],
          [4, 0, 9, 2, 378, 5],
          [24, 3, 2, 3, 6, 88],
        ],
      },
    },
    {
      task: "urgency", dataset: "gold-2k (human labelled)",
      metrics: [
        { name: "Macro-F1", value: 0.744, threshold: 0.7, passed: true },
        { name: "Critical recall", value: 0.86, threshold: 0.8, passed: true },
      ],
      per_class: [
        { label: "low", precision: 0.82, recall: 0.85, f1: 0.835, support: 780 },
        { label: "medium", precision: 0.7, recall: 0.68, f1: 0.69, support: 640 },
        { label: "high", precision: 0.69, recall: 0.66, f1: 0.675, support: 430 },
        { label: "critical", precision: 0.77, recall: 0.86, f1: 0.812, support: 150 },
      ],
      confusion: { labels: ["low", "medium", "high", "critical"], matrix: [[663, 98, 17, 2], [121, 435, 76, 8], [22, 88, 284, 36], [1, 4, 16, 129]] },
    },
    {
      task: "aspects", dataset: "SemEval-style multi-label (1.2k)",
      metrics: [
        { name: "Micro-F1", value: 0.784, threshold: 0.75, passed: true },
        { name: "Macro-F1", value: 0.712 },
      ],
      per_class: [
        { label: "bugs_errors", precision: 0.85, recall: 0.83, f1: 0.84, support: 310 },
        { label: "pricing_billing", precision: 0.88, recall: 0.86, f1: 0.87, support: 188 },
        { label: "ads", precision: 0.91, recall: 0.9, f1: 0.905, support: 140 },
        { label: "features", precision: 0.72, recall: 0.75, f1: 0.735, support: 290 },
        { label: "ui_ux", precision: 0.66, recall: 0.61, f1: 0.634, support: 122 },
        { label: "connectivity_devices", precision: 0.79, recall: 0.74, f1: 0.764, support: 96 },
      ],
      confusion: null,
    },
  ],
  clustering: [
    { name: "Silhouette", value: 0.21, threshold: 0.15, passed: true },
    { name: "Topic coherence (NPMI)", value: 0.118, baseline: 0.081, baseline_name: "LDA", threshold: 0.12, passed: false },
    { name: "Topic diversity", value: 0.86, threshold: 0.8, passed: true },
    { name: "Noise share", value: 18.2, unit: "%", threshold: 25, passed: true },
    { name: "Label purity vs gold themes", value: 0.74 },
  ],
  retrieval: {
    metrics: [
      { name: "Recall@10", value: 0.874, baseline: 0.712, baseline_name: "BM25", threshold: 0.8, passed: true },
      { name: "nDCG@10", value: 0.781, baseline: 0.642, baseline_name: "BM25", threshold: 0.7, passed: true },
      { name: "MRR", value: 0.736, baseline: 0.588, baseline_name: "BM25" },
      { name: "p95 latency", value: 142, unit: "ms", threshold: 300, passed: true },
    ],
    by_method: [
      { method: "BM25", recall_at_10: 0.712, ndcg_at_10: 0.642, mrr: 0.588 },
      { method: "Dense (bge-small)", recall_at_10: 0.803, ndcg_at_10: 0.701, mrr: 0.655 },
      { method: "Hybrid (RRF)", recall_at_10: 0.851, ndcg_at_10: 0.748, mrr: 0.702 },
      { method: "Hybrid + rerank", recall_at_10: 0.874, ndcg_at_10: 0.781, mrr: 0.736 },
    ],
  },
  trends: {
    metrics: [
      { name: "Incident recall", value: 0.833, threshold: 0.8, passed: true },
      { name: "Median detection delay", value: 1, unit: "days", threshold: 2, passed: true },
      { name: "False alerts / week", value: 0.9, threshold: 2, passed: true },
    ],
    incidents: [
      { name: "Android 12 crash regression", injected_at: "2022-02-28", detected_at: "2022-03-01", delay_days: 1 },
      { name: "Login loop after update", injected_at: "2022-02-03", detected_at: "2022-02-04", delay_days: 1 },
      { name: "Premium price increase", injected_at: "2022-04-03", detected_at: "2022-04-03", delay_days: 0 },
      { name: "Offline downloads disappear", injected_at: "2022-05-09", detected_at: "2022-05-12", delay_days: 3 },
      { name: "Podcast feed outage (synthetic)", injected_at: "2022-03-20", detected_at: "2022-03-22", delay_days: 2 },
      { name: "Lyrics licensing gap (synthetic, slow drift)", injected_at: "2022-01-15", detected_at: null, delay_days: null },
    ],
  },
  grounding: [
    { name: "Groundedness (NLI-verified claims)", value: 0.926, baseline: 0.71, baseline_name: "no-retrieval LLM", threshold: 0.9, passed: true },
    { name: "Citation precision", value: 0.951, threshold: 0.9, passed: true },
    { name: "Citation validity (id exists)", value: 0.991, threshold: 0.98, passed: true },
    { name: "Answer relevance (LLM judge)", value: 4.4, unit: "/5" },
  ],
  cost: [
    { name: "LLM cost per full run", value: 1.12, unit: "USD" },
    { name: "Cost per 1k feedback", value: 0.001, unit: "USD" },
    { name: "Analyst p50 latency", value: 2.8, unit: "s", threshold: 5, passed: true },
    { name: "GPU hours per run", value: 0.84, unit: "h" },
    { name: "Tokens per analyst answer", value: 3_420 },
  ],
};
