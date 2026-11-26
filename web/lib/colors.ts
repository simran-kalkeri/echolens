import type { Intent, Sentiment, Source, Urgency } from "./types";

/**
 * Single source of truth for data colors (dark surface). Mirrors the CSS tokens in globals.css,
 * duplicated here because ECharts / WebGL need raw hex values.
 * Categorical order follows the validated dark palette (blue, orange, aqua, yellow, magenta, green, violet, red).
 */
export const C = {
  bg: "#0a0b0d",
  panel: "#101114",
  raised: "#15171b",
  border: "#212329",
  borderStrong: "#2c2f36",
  grid: "#1c1e23",
  text: "#e8e9ec",
  text2: "#a1a4ad",
  text3: "#6c707a",
  accent: "#4f8ff7",
  accentSoft: "rgba(79,143,247,0.14)",
};

export const SENTIMENT_COLOR: Record<Sentiment, string> = {
  negative: "#e5636a",
  neutral: "#7d818b",
  positive: "#3fb68b",
};

export const URGENCY_COLOR: Record<Urgency, string> = {
  low: "#6c707a",
  medium: "#c99a2e",
  high: "#ec835a",
  critical: "#e5484d",
};

export const CATEGORICAL = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#0ca30c", "#9085e9", "#e66767"];

/** Extended set for >8 clusters in the galaxy (labels at centroids give secondary identity). */
export const CLUSTER = [
  ...CATEGORICAL,
  "#5fb3d9", "#b07fd6", "#8fb339", "#d98b6a", "#6f8ccf", "#d4b35a", "#4fbfae", "#c96b9b", "#9aa3b5",
];

export const SOURCE_COLOR: Record<Source, string> = { review: CATEGORICAL[0], ticket: CATEGORICAL[1], survey: CATEGORICAL[2] };

export const INTENT_COLOR: Record<Intent, string> = {
  complaint: CATEGORICAL[0],
  bug_report: CATEGORICAL[1],
  feature_request: CATEGORICAL[2],
  question: CATEGORICAL[3],
  praise: CATEGORICAL[4],
  churn_risk: CATEGORICAL[7],
};

/** Diverging -1..1 → red / gray / green for continuous sentiment. */
export function sentimentScale(v: number): string {
  const t = Math.max(-1, Math.min(1, v));
  const neg = [229, 99, 106];
  const mid = [96, 100, 110];
  const pos = [63, 182, 139];
  const [a, b, k] = t < 0 ? [mid, neg, -t] : [mid, pos, t];
  const mix = (i: number) => Math.round(a[i] + (b[i] - a[i]) * Math.pow(k, 0.8));
  return `rgb(${mix(0)},${mix(1)},${mix(2)})`;
}

export function clusterColor(id: number) {
  return id < 0 ? "#4a4e57" : CLUSTER[id % CLUSTER.length];
}
