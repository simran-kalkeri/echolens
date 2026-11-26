import type { FeedbackPage } from "../types";
import type { FeedbackQuery } from "../api";
import { getModel } from "./generate";

export { buildWorkspaces, buildOverview, buildThemes, buildThemeDetail, buildGraph, buildGalaxy, buildAlerts, buildInsights } from "./generate";
export { PIPELINE, EVAL } from "./static";
export { mockAnalyst } from "./analyst";

/** Naive lexical stand-in for the backend's hybrid semantic search. */
export function queryFeedback(q: FeedbackQuery & { page: number; page_size: number }): FeedbackPage {
  const m = getModel(q.ws);
  let items = m.feedback.filter(
    (f) =>
      (!q.sentiment || f.sentiment === q.sentiment) &&
      (!q.intent || f.intent === q.intent) &&
      (!q.urgency || f.urgency === q.urgency) &&
      (!q.source || f.source === q.source) &&
      (!q.theme || f.theme_id === q.theme) &&
      (!q.aspect || f.aspects.some((a) => a.aspect === q.aspect)),
  );
  if (q.q?.trim()) {
    const terms = q.q.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
    const scored = items
      .map((f) => {
        const hay = `${f.text} ${f.theme_name ?? ""}`.toLowerCase();
        const s = terms.reduce((acc, t) => acc + (hay.includes(t) ? 1 : hay.includes(t.slice(0, 4)) ? 0.4 : 0), 0);
        return { f, s };
      })
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s);
    items = scored.map((x) => x.f);
  }
  const start = (q.page - 1) * q.page_size;
  return { items: items.slice(start, start + q.page_size), total: items.length, page: q.page, page_size: q.page_size };
}
