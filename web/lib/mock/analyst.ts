import type { AnalystEvent, Feedback } from "../types";
import { buildAlerts, getModel, N_DAYS } from "./generate";

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

function score(q: string, words: string[]) {
  const ql = q.toLowerCase();
  return words.reduce((s, w) => s + (ql.includes(w.toLowerCase()) ? (w.length > 5 ? 2 : 1) : 0), 0);
}

/** Simulates the SSE stream of POST /api/analyst/ask. */
export async function* mockAnalyst(ws: string, question: string, signal?: AbortSignal): AsyncGenerator<AnalystEvent> {
  const m = getModel(ws);
  const ranked = [...m.themes]
    .map((t) => ({ t, s: score(question, [...t.seed.keywords, ...t.seed.name.split(" ")]) }))
    .sort((a, b) => b.s - a.s || b.t.negCount - a.t.negCount);
  const primary = ranked[0].t;
  const secondary = ranked[1].t;
  const ev1 = (m.byTheme.get(primary.seed.id) ?? []).slice(0, 4);
  const ev2 = (m.byTheme.get(secondary.seed.id) ?? []).slice(0, 2);
  const citations: Feedback[] = [...ev1, ...ev2];
  const recent = primary.days.slice(N_DAYS - 30).reduce((s, d) => s + d.total, 0);
  const prior = primary.days.slice(N_DAYS - 60, N_DAYS - 30).reduce((s, d) => s + d.total, 0);
  const delta = Math.round(((recent - prior) / Math.max(1, prior)) * 100);
  const alert = buildAlerts(ws).find((a) => a.theme_id === primary.seed.id);
  const negPct = Math.round((primary.negCount / primary.count) * 100);

  yield { type: "status", text: "Planning: decomposing the question into retrieval and metric lookups" };
  await sleep(450, signal);
  yield {
    type: "tool", name: "search_feedback", args: { query: question, k: 40, mode: "hybrid" },
    summary: `Retrieved 40 items; top cluster "${primary.seed.name}" (${ev1.length} highly relevant)`,
  };
  await sleep(600, signal);
  yield {
    type: "tool", name: "get_theme_stats", args: { theme_id: primary.seed.id, window: "30d" },
    summary: `${recent.toLocaleString("en-US")} items in last 30d (${delta >= 0 ? "+" : ""}${delta}% vs prior), ${negPct}% negative`,
  };
  await sleep(500, signal);
  yield {
    type: "tool", name: "detect_anomalies", args: { theme_id: primary.seed.id },
    summary: alert ? `Anomaly: peak ${alert.observed}/day on ${alert.peak_date} (score ${alert.score}, ${alert.severity})` : "No anomaly above threshold in the window",
  };
  await sleep(450, signal);
  yield {
    type: "tool", name: "get_related_themes", args: { theme_id: primary.seed.id, top_k: 3 },
    summary: `Co-occurs most with "${secondary.seed.name}"`,
  };
  await sleep(350, signal);
  yield { type: "status", text: "Drafting answer with citations" };

  const c = (f?: Feedback) => (f ? ` [#${f.id}]` : "");
  const answer = [
    `**Short answer:** the main driver is **${primary.seed.name}**, which accounts for ${primary.count.toLocaleString("en-US")} pieces of feedback (${negPct}% negative) and is ${delta >= 0 ? "up" : "down"} ${Math.abs(delta)}% over the last 30 days.`,
    "",
    "### What users are saying",
    `- ${primary.seed.description}${c(ev1[0])}`,
    `- Complaints are concrete and repeatable, which points to a product issue rather than general dissatisfaction${c(ev1[1])}${c(ev1[2])}`,
    alert
      ? `- Volume spiked to **${alert.observed}/day** on ${alert.peak_date} against an expected ${alert.baseline}/day${c(ev1[3])}`
      : `- There is no sharp spike; this is a persistent, structural issue${c(ev1[3])}`,
    "",
    "### Related",
    `It frequently co-occurs with **${secondary.seed.name}**${c(ev2[0])}, so fixing one is likely to move sentiment on both.`,
    "",
    "### Suggested next step",
    `Prioritise the root cause behind *${primary.seed.keywords.slice(0, 2).join("* / *")}* reports and track negative volume on this theme daily; the anomaly detector will confirm recovery once it falls back inside the expected band.`,
  ].join("\n");

  // stream tokens
  const tokens = answer.match(/\S+\s*|\s+/g) ?? [answer];
  for (let i = 0; i < tokens.length; i += 2) {
    yield { type: "token", text: tokens.slice(i, i + 2).join("") };
    await sleep(18 + Math.random() * 30, signal);
  }

  const claims = [
    { text: `${primary.seed.name} is the main driver of the issue`, supported: true, citation_ids: [ev1[0]?.id, ev1[1]?.id].filter(Boolean) as string[] },
    { text: `Volume is ${delta >= 0 ? "up" : "down"} ${Math.abs(delta)}% over 30 days`, supported: true, citation_ids: [] },
    { text: "Complaints point to a reproducible product issue", supported: true, citation_ids: [ev1[1]?.id, ev1[2]?.id].filter(Boolean) as string[] },
    { text: alert ? `Spike to ${alert.observed}/day on ${alert.peak_date}` : "No sharp spike in the window", supported: true, citation_ids: ev1[3] ? [ev1[3].id] : [] },
    { text: `Co-occurs with ${secondary.seed.name}`, supported: true, citation_ids: ev2[0] ? [ev2[0].id] : [] },
    { text: "Fixing one theme will move sentiment on both", supported: false, citation_ids: [] },
  ];
  yield {
    type: "final",
    answer,
    citations,
    claims,
    groundedness: Math.round((claims.filter((x) => x.supported).length / claims.length) * 100) / 100,
  };
}
