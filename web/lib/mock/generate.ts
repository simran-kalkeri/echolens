import type {
  Alert,
  AspectId,
  Feedback,
  GalaxyResponse,
  GraphResponse,
  Insight,
  Intent,
  OverviewResponse,
  Sentiment,
  Source,
  Theme,
  ThemeDetailResponse,
  ThemesResponse,
  Urgency,
  Workspace,
} from "../types";
import { ASPECT_LABELS, SPOTIFY_RELATED, WORKSPACES, type ThemeSeed, type WorkspaceSeed } from "./catalog";

/* ---------- deterministic randomness ---------- */
function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r: () => number) {
  const u = Math.max(1e-9, r());
  const v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function pick<T>(r: () => number, arr: T[]): T {
  return arr[Math.floor(r() * arr.length)];
}
function weighted<T extends string>(r: () => number, w: Record<T, number>): T {
  const entries = Object.entries(w) as [T, number][];
  const total = entries.reduce((s, [, v]) => s + v, 0);
  let x = r() * total;
  for (const [k, v] of entries) {
    x -= v;
    if (x <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

/* ---------- calendar ---------- */
export const START = "2022-01-01";
export const N_DAYS = 181; // through 2022-06-30
export const DATES: string[] = Array.from({ length: N_DAYS }, (_, i) => {
  const d = new Date(Date.UTC(2022, 0, 1 + i));
  return d.toISOString().slice(0, 10);
});

/* ---------- per-workspace model ---------- */
interface DayCount { total: number; neg: number; neu: number; pos: number }
interface ThemeModel { seed: ThemeSeed; days: DayCount[]; count: number; negCount: number; posCount: number; neuCount: number }
export interface WsModel {
  ws: WorkspaceSeed;
  themes: ThemeModel[];
  feedback: Feedback[];
  byTheme: Map<string, Feedback[]>;
  byId: Map<string, Feedback>;
}

const PREFIXES = ["", "", "", "Honestly, ", "Update: ", "Not sure who reads these but ", "Long time user here. ", "FYI: "];
const SUFFIXES = ["", "", "", " Please fix this.", " This has been going on for weeks.", " Very disappointed.", " Anyone else seeing this?", " Version 8.7.2.", " Would rate higher otherwise.", " Thanks for listening."];
const POS_SUFFIX = ["", " Keep it up.", " Five stars.", " Thank you!", " Best thing about the app."];

function spikeFactor(t: ThemeSeed, d: number) {
  const s = t.spike;
  if (!s) return 1;
  if (s.kind === "emerging_theme") {
    if (d < s.start) return 0.35;
    if (d <= s.peak) return 0.35 + (s.mult - 0.35) * ((d - s.start) / Math.max(1, s.peak - s.start));
    return Math.max(s.mult * 0.7, s.mult - (d - s.peak) * 0.02);
  }
  if (d < s.start || d > s.end) return 1;
  if (d <= s.peak) return 1 + (s.mult - 1) * ((d - s.start + 1) / (s.peak - s.start + 1));
  return 1 + (s.mult - 1) * Math.exp(-(d - s.peak) / ((s.end - s.peak) / 3));
}

const cache = new Map<string, WsModel>();

export function getModel(wsId: string): WsModel {
  const hit = cache.get(wsId);
  if (hit) return hit;
  const ws = WORKSPACES.find((w) => w.id === wsId) ?? WORKSPACES[0];
  const r = mulberry32(hashStr(ws.id));

  const themes: ThemeModel[] = ws.themes.map((t) => {
    const days: DayCount[] = DATES.map((date, d) => {
      const dow = new Date(date + "T00:00:00Z").getUTCDay();
      const weekly = dow === 0 || dow === 6 ? 1.18 : 0.94;
      const growth = 1 + (t.slope ?? 0) * (d / N_DAYS);
      const lam = t.rate * weekly * growth * spikeFactor(t, d);
      const total = Math.max(0, Math.round(lam + gauss(r) * Math.sqrt(lam) * 0.9));
      const inSpike = spikeFactor(t, d) > 1.5;
      const negShare = Math.min(0.97, t.neg * (t.neg > 0.5 ? 0.84 : 1) + (inSpike ? 0.06 : 0) + gauss(r) * 0.03);
      const neg = Math.round(total * Math.max(0, negShare));
      const rest = total - neg;
      const posFrac = t.intent === "praise" ? 0.85 : t.intent === "feature_request" ? 0.45 : 0.35;
      const pos = Math.round(rest * posFrac);
      return { total, neg, pos, neu: rest - pos };
    });
    const sum = (k: keyof DayCount) => days.reduce((s, x) => s + x[k], 0);
    return { seed: t, days, count: sum("total"), negCount: sum("neg"), posCount: sum("pos"), neuCount: sum("neu") };
  });

  /* feedback sample */
  const feedback: Feedback[] = [];
  const byTheme = new Map<string, Feedback[]>();
  const prefix = ws.id.slice(0, 2);
  let n = 10000 + Math.floor(r() * 400);
  for (const tm of themes) {
    const t = tm.seed;
    const items: Feedback[] = [];
    const k = Math.max(30, Math.round(t.rate * 3.2));
    // date sampling weighted by daily volume
    const cum: number[] = [];
    let acc = 0;
    for (const d of tm.days) cum.push((acc += d.total));
    for (let i = 0; i < k; i++) {
      const x = r() * acc;
      let lo = 0;
      while (cum[lo] < x) lo++;
      const date = DATES[lo];
      const day = tm.days[lo];
      const sentiment: Sentiment =
        r() < day.neg / Math.max(1, day.total) ? "negative" : r() < day.pos / Math.max(1, day.pos + day.neu) ? "positive" : "neutral";
      const source = pick(r, ws.sources) as Source;
      const base = pick(r, t.texts);
      const pre = pick(r, PREFIXES);
      const text =
        sentiment === "positive" || t.intent === "praise"
          ? base + pick(r, POS_SUFFIX)
          : pre + (pre === "" || pre.endsWith(". ") || pre.endsWith(": ") || /^(I\b|[A-Z]{2}|Spotify|Android|CarPlay|Facebook|Discover|Release|Blend|Premium|Smart|HiFi)/.test(base) ? base : base.charAt(0).toLowerCase() + base.slice(1)) + pick(r, SUFFIXES);
      const intent: Intent =
        sentiment === "positive" && t.intent !== "feature_request"
          ? "praise"
          : weighted<Intent>(r, {
              complaint: t.intent === "complaint" ? 6 : 1.5,
              bug_report: t.intent === "bug_report" ? 6 : 0.6,
              feature_request: t.intent === "feature_request" ? 6 : 0.6,
              question: 0.8,
              praise: t.intent === "praise" ? 6 : 0.1,
              churn_risk: t.intent === "churn_risk" ? 5 : sentiment === "negative" ? 0.7 : 0.05,
            });
      const urgency: Urgency =
        sentiment !== "negative"
          ? r() < 0.8 ? "low" : "medium"
          : weighted<Urgency>(r, {
              low: 1,
              medium: 2.4,
              high: intent === "bug_report" || intent === "churn_risk" ? 2.4 : 1,
              critical: intent === "bug_report" || intent === "churn_risk" ? 0.9 : 0.2,
            });
      const rating =
        source === "ticket" ? null : sentiment === "negative" ? (r() < 0.65 ? 1 : 2) : sentiment === "neutral" ? 3 : r() < 0.6 ? 5 : 4;
      const score =
        sentiment === "negative" ? -0.45 - r() * 0.5 : sentiment === "positive" ? 0.45 + r() * 0.5 : -0.15 + r() * 0.3;
      const aspects: Feedback["aspects"] = [{ aspect: t.aspect, sentiment }];
      if (r() < 0.25) {
        const other = pick(r, ws.themes).aspect;
        if (other !== t.aspect) aspects.push({ aspect: other, sentiment: r() < 0.6 ? sentiment : "neutral" });
      }
      const hh = String(Math.floor(r() * 24)).padStart(2, "0");
      const mm = String(Math.floor(r() * 60)).padStart(2, "0");
      n += 1 + Math.floor(r() * 7);
      items.push({
        id: `fb_${prefix}${n}`,
        ws: ws.id,
        source,
        text,
        created_at: `${date}T${hh}:${mm}:00Z`,
        rating,
        sentiment,
        sentiment_score: Math.round(score * 100) / 100,
        intent,
        urgency,
        aspects,
        theme_id: t.id,
        theme_name: t.name,
      });
    }
    // evidence order: most negative + recent first for negative themes
    items.sort((a, b) =>
      t.neg > 0.5 ? a.sentiment_score - b.sentiment_score || b.created_at.localeCompare(a.created_at) : b.sentiment_score - a.sentiment_score,
    );
    byTheme.set(t.id, items);
    feedback.push(...items);
  }
  feedback.sort((a, b) => b.created_at.localeCompare(a.created_at));
  const byId = new Map(feedback.map((f) => [f.id, f]));
  const model = { ws, themes, feedback, byTheme, byId };
  cache.set(wsId, model);
  return model;
}

/* ---------- endpoint builders ---------- */
export function buildWorkspaces(): Workspace[] {
  return WORKSPACES.map((w) => {
    const m = getModel(w.id);
    return {
      id: w.id,
      name: w.name,
      sources: w.sources,
      n_feedback: m.themes.reduce((s, t) => s + t.count, 0),
      date_min: DATES[0],
      date_max: DATES[N_DAYS - 1],
    };
  });
}

const SOURCE_W: Record<Source, number> = { review: 0.56, ticket: 0.29, survey: 0.15 };
const INTENTS: Intent[] = ["complaint", "bug_report", "feature_request", "question", "praise", "churn_risk"];
const URGENCIES: Urgency[] = ["low", "medium", "high", "critical"];

function mixFromSample<K extends string>(items: Feedback[], keys: K[], get: (f: Feedback) => K, scale: number) {
  const c = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  for (const f of items) c[get(f)]++;
  return keys.map((k) => ({ key: k, count: Math.round((c[k] / Math.max(1, items.length)) * scale) }));
}

function themeTotalsWindow(tm: ThemeModel, from: number, to: number) {
  let s = 0;
  for (let i = Math.max(0, from); i < Math.min(N_DAYS, to); i++) s += tm.days[i].total;
  return s;
}

export function buildOverview(wsId: string): OverviewResponse {
  const m = getModel(wsId);
  const total = m.themes.reduce((s, t) => s + t.count, 0);
  const neg = m.themes.reduce((s, t) => s + t.negCount, 0);
  const pos = m.themes.reduce((s, t) => s + t.posCount, 0);
  const neu = total - neg - pos;
  const sentiment_trend = DATES.map((date, d) => ({
    date,
    positive: m.themes.reduce((s, t) => s + t.days[d].pos, 0),
    neutral: m.themes.reduce((s, t) => s + t.days[d].neu, 0),
    negative: m.themes.reduce((s, t) => s + t.days[d].neg, 0),
  }));
  const top8 = [...m.themes].sort((a, b) => b.count - a.count).slice(0, 8);
  const theme_stream = DATES.map((date, d) => {
    const row: { date: string; [k: string]: number | string } = { date };
    for (const t of top8) row[t.seed.name] = t.days[d].total;
    return row;
  });
  const sources = m.ws.sources;
  const wsum = sources.reduce((s, k) => s + SOURCE_W[k], 0);
  const channel_mix = sources.map((source) => ({ source, count: Math.round((total * SOURCE_W[source]) / wsum) }));
  const intent_mix = mixFromSample(m.feedback, INTENTS, (f) => f.intent, total).map(({ key, count }) => ({ intent: key, count }));
  const urgency_mix = mixFromSample(m.feedback, URGENCIES, (f) => f.urgency, total).map(({ key, count }) => ({ urgency: key, count }));
  const aspectMap = new Map<AspectId, { positive: number; neutral: number; negative: number }>();
  for (const t of m.themes) {
    const a = aspectMap.get(t.seed.aspect) ?? { positive: 0, neutral: 0, negative: 0 };
    a.positive += t.posCount;
    a.neutral += t.neuCount;
    a.negative += t.negCount;
    aspectMap.set(t.seed.aspect, a);
  }
  const aspect_sentiment = [...aspectMap.entries()]
    .map(([aspect, v]) => ({ aspect, label: ASPECT_LABELS[aspect], ...v }))
    .sort((a, b) => b.negative + b.positive + b.neutral - (a.negative + a.positive + a.neutral));
  const top_movers = m.themes
    .map((t) => {
      const cur = themeTotalsWindow(t, N_DAYS - 30, N_DAYS);
      const prev = themeTotalsWindow(t, N_DAYS - 60, N_DAYS - 30);
      return {
        theme_id: t.seed.id,
        name: t.seed.name,
        delta_pct: Math.round(((cur - prev) / Math.max(1, prev)) * 1000) / 10,
        neg_share: Math.round((t.negCount / Math.max(1, t.count)) * 100) / 100,
        count: cur,
      };
    })
    .sort((a, b) => Math.abs(b.delta_pct) - Math.abs(a.delta_pct))
    .slice(0, 8);
  const calendar = sentiment_trend.map((d) => ({ date: d.date, negative: d.negative, total: d.negative + d.neutral + d.positive }));
  const alerts = buildAlerts(wsId);
  const critShare = m.feedback.filter((f) => f.urgency === "critical").length / m.feedback.length;
  return {
    kpis: {
      total,
      negative_pct: Math.round((neg / total) * 1000) / 10,
      sentiment_index: Math.round(((pos - neg) / total) * 1000) / 10,
      avg_rating: Math.round(((neg * 1.4 + neu * 3 + pos * 4.6) / total) * 100) / 100,
      open_alerts: alerts.length,
      themes: m.themes.length,
      critical_count: Math.round(total * critShare),
    },
    sentiment_trend,
    theme_stream,
    channel_mix,
    intent_mix,
    urgency_mix,
    aspect_sentiment,
    top_movers,
    calendar,
  };
}

function toTheme(tm: ThemeModel): Theme {
  return {
    id: tm.seed.id,
    name: tm.seed.name,
    description: tm.seed.description,
    aspect: tm.seed.aspect,
    count: tm.count,
    neg_share: Math.round((tm.negCount / Math.max(1, tm.count)) * 1000) / 1000,
    sentiment_score: Math.round(((tm.posCount - tm.negCount) / Math.max(1, tm.count)) * 0.8 * 100) / 100,
    keywords: tm.seed.keywords,
    trend: DATES.map((date, d) => ({ date, count: tm.days[d].total })),
  };
}

export function buildThemes(wsId: string): ThemesResponse {
  const m = getModel(wsId);
  const groups = new Map<AspectId, ThemeModel[]>();
  for (const t of m.themes) groups.set(t.seed.aspect, [...(groups.get(t.seed.aspect) ?? []), t]);
  return {
    aspects: [...groups.entries()]
      .map(([id, ts]) => ({
        id,
        label: ASPECT_LABELS[id],
        count: ts.reduce((s, t) => s + t.count, 0),
        positive: ts.reduce((s, t) => s + t.posCount, 0),
        neutral: ts.reduce((s, t) => s + t.neuCount, 0),
        negative: ts.reduce((s, t) => s + t.negCount, 0),
        themes: ts.map(toTheme).sort((a, b) => b.count - a.count),
      }))
      .sort((a, b) => b.count - a.count),
  };
}

function relatedFor(m: WsModel, id: string) {
  const out: { id: string; name: string; weight: number }[] = [];
  const name = (x: string) => m.themes.find((t) => t.seed.id === x)?.seed.name ?? x;
  if (m.ws.id === "spotify") {
    for (const [a, b, w] of SPOTIFY_RELATED) {
      if (a === id) out.push({ id: b, name: name(b), weight: w });
      if (b === id) out.push({ id: a, name: name(a), weight: w });
    }
  }
  if (out.length < 2) {
    const self = m.themes.find((t) => t.seed.id === id);
    for (const t of m.themes) {
      if (t.seed.id !== id && t.seed.aspect === self?.seed.aspect && !out.find((o) => o.id === t.seed.id)) out.push({ id: t.seed.id, name: t.seed.name, weight: 0.3 });
    }
    for (const t of m.themes) {
      if (out.length >= 3) break;
      if (t.seed.id !== id && !out.find((o) => o.id === t.seed.id)) out.push({ id: t.seed.id, name: t.seed.name, weight: 0.15 });
    }
  }
  return out.sort((a, b) => b.weight - a.weight);
}

function cite(items: Feedback[], i: number) {
  return items[i] ? `[#${items[i].id}]` : "";
}

export function buildThemeDetail(wsId: string, themeId: string): ThemeDetailResponse | null {
  const m = getModel(wsId);
  const tm = m.themes.find((t) => t.seed.id === themeId);
  if (!tm) return null;
  const items = m.byTheme.get(themeId) ?? [];
  const theme = toTheme(tm);
  const cur = themeTotalsWindow(tm, N_DAYS - 30, N_DAYS);
  const prev = themeTotalsWindow(tm, N_DAYS - 60, N_DAYS - 30);
  const delta = Math.round(((cur - prev) / Math.max(1, prev)) * 100);
  const summary =
    `**${tm.seed.name}** accounts for ${tm.count.toLocaleString("en-US")} pieces of feedback, ` +
    `${Math.round(theme.neg_share * 100)}% of them negative. ${tm.seed.description} ${cite(items, 0)} ${cite(items, 1)}\n\n` +
    `Volume is ${delta >= 0 ? "up" : "down"} ${Math.abs(delta)}% over the last 30 days versus the prior 30. ` +
    `The most common phrasing centres on *${tm.seed.keywords.slice(0, 2).join("* and *")}* ${cite(items, 2)}, ` +
    `and several users tie it to churn or downgrades ${cite(items, 3)}.`;
  return {
    ...theme,
    intent_mix: mixFromSample(items, INTENTS, (f) => f.intent, tm.count).map(({ key, count }) => ({ intent: key, count })),
    urgency_mix: mixFromSample(items, URGENCIES, (f) => f.urgency, tm.count).map(({ key, count }) => ({ urgency: key, count })),
    related: relatedFor(m, themeId),
    evidence: items.slice(0, 8),
    summary,
  };
}

export function buildGraph(wsId: string): GraphResponse {
  const m = getModel(wsId);
  const nodes: GraphResponse["nodes"] = [];
  const edges: GraphResponse["edges"] = [];
  const aspects = [...new Set(m.themes.map((t) => t.seed.aspect))];
  const total = m.themes.reduce((s, t) => s + t.count, 0);
  const sentimentOf = (pos: number, neg: number, c: number) => Math.round(((pos - neg) / Math.max(1, c)) * 100) / 100;
  aspects.forEach((a, i) => {
    const ts = m.themes.filter((t) => t.seed.aspect === a);
    const c = ts.reduce((s, t) => s + t.count, 0);
    nodes.push({
      id: `aspect:${a}`, label: ASPECT_LABELS[a], type: "aspect", size: c,
      sentiment: sentimentOf(ts.reduce((s, t) => s + t.posCount, 0), ts.reduce((s, t) => s + t.negCount, 0), c),
      community: i % 5, pagerank: c / total,
    });
  });
  for (const t of m.themes) {
    const ai = aspects.indexOf(t.seed.aspect);
    nodes.push({
      id: t.seed.id, label: t.seed.name, type: "theme", size: t.count,
      sentiment: sentimentOf(t.posCount, t.negCount, t.count), community: ai % 5, pagerank: (t.count / total) * 0.6,
    });
    edges.push({ source: t.seed.id, target: `aspect:${t.seed.aspect}`, weight: 1, kind: "belongs_to" });
  }
  for (const intent of INTENTS) {
    const items = m.feedback.filter((f) => f.intent === intent);
    const c = Math.round((items.length / m.feedback.length) * total);
    const pos = items.filter((f) => f.sentiment === "positive").length;
    const neg = items.filter((f) => f.sentiment === "negative").length;
    nodes.push({
      id: `intent:${intent}`, label: intent.replace("_", " "), type: "intent", size: c,
      sentiment: sentimentOf(pos, neg, items.length), community: 5, pagerank: (c / total) * 0.4,
    });
    for (const t of m.themes) {
      const share = (m.byTheme.get(t.seed.id) ?? []).filter((f) => f.intent === intent).length / Math.max(1, (m.byTheme.get(t.seed.id) ?? []).length);
      if (share > 0.18) edges.push({ source: t.seed.id, target: `intent:${intent}`, weight: Math.round(share * 100) / 100, kind: "has_intent" });
    }
  }
  for (const s of m.ws.sources) {
    const c = Math.round(total * SOURCE_W[s]);
    nodes.push({ id: `source:${s}`, label: s, type: "source", size: c, sentiment: -0.3, community: 6, pagerank: 0.02 });
    for (const t of m.themes) {
      const share = (m.byTheme.get(t.seed.id) ?? []).filter((f) => f.source === s).length / Math.max(1, (m.byTheme.get(t.seed.id) ?? []).length);
      if (share > 0.36) edges.push({ source: `source:${s}`, target: t.seed.id, weight: Math.round(share * 100) / 100, kind: "from_source" });
    }
  }
  if (m.ws.id === "spotify") {
    for (const [a, b, w] of SPOTIFY_RELATED) edges.push({ source: a, target: b, weight: w, kind: "co_occurs" });
  } else {
    for (let i = 0; i + 1 < m.themes.length; i += 2) edges.push({ source: m.themes[i].seed.id, target: m.themes[i + 1].seed.id, weight: 0.3, kind: "co_occurs" });
  }
  return { nodes, edges };
}

export function buildGalaxy(wsId: string): GalaxyResponse {
  const m = getModel(wsId);
  const r = mulberry32(hashStr(wsId + "galaxy"));
  const total = m.themes.reduce((s, t) => s + t.count, 0);
  const target = 3000;
  const points: GalaxyResponse["points"] = [];
  const clusters: GalaxyResponse["clusters"] = [];
  // place clusters on a fibonacci sphere, related aspects pulled closer
  const nT = m.themes.length;
  m.themes.forEach((t, ci) => {
    const yv = 1 - (ci / Math.max(1, nT - 1)) * 2;
    const rad = Math.sqrt(1 - yv * yv);
    const th = Math.PI * (3 - Math.sqrt(5)) * ci;
    const R = 10.5 + r() * 3;
    const c: [number, number, number] = [Math.cos(th) * rad * R, yv * R * 0.7, Math.sin(th) * rad * R];
    const k = Math.max(60, Math.round((t.count / total) * target));
    const items = m.byTheme.get(t.seed.id) ?? [];
    const spread = 0.75 + r() * 0.45;
    let sx = 0, sy = 0, sz = 0;
    for (let i = 0; i < k; i++) {
      const f = items[i % items.length];
      const x = c[0] + gauss(r) * spread;
      const y = c[1] + gauss(r) * spread * 0.8;
      const z = c[2] + gauss(r) * spread;
      sx += x; sy += y; sz += z;
      const sent = f.sentiment_score + gauss(r) * 0.08;
      points.push({ id: i < items.length ? f.id : `${f.id}_${i}`, x, y, z, cluster: ci, sentiment: Math.max(-1, Math.min(1, Math.round(sent * 100) / 100)), text: f.text });
    }
    clusters.push({ id: ci, theme_id: t.seed.id, name: t.seed.name, centroid: [sx / k, sy / k, sz / k], count: t.count });
  });
  // a little ambient noise between clusters (unclustered points, cluster -1)
  for (let i = 0; i < 120; i++) {
    const f = m.feedback[Math.floor(r() * m.feedback.length)];
    points.push({ id: `${f.id}_n${i}`, x: gauss(r) * 7, y: gauss(r) * 5, z: gauss(r) * 7, cluster: -1, sentiment: f.sentiment_score, text: f.text });
  }
  return { points, clusters };
}

const SEV = (score: number): Alert["severity"] => (score >= 8 ? "critical" : score >= 5.5 ? "high" : score >= 3.5 ? "medium" : "low");

export function buildAlerts(wsId: string): Alert[] {
  const m = getModel(wsId);
  const out: Alert[] = [];
  for (const t of m.themes) {
    const s = t.seed.spike;
    if (!s) continue;
    const winStart = Math.max(0, s.start - 35);
    const winEnd = Math.min(N_DAYS, Math.max(s.end + 10, s.peak + 25));
    const negSeries = t.days.map((d) => d.neg);
    const baseline = negSeries.slice(Math.max(0, s.start - 28), s.start).reduce((a, b) => a + b, 0) / Math.min(28, Math.max(1, s.start));
    const series = [] as Alert["series"];
    for (let d = winStart; d < winEnd; d++) {
      // expected: trailing 14-day median-ish of pre-spike baseline (stays flat inside the anomaly)
      const lookback = negSeries.slice(Math.max(0, Math.min(d, s.start) - 14), Math.max(1, Math.min(d, s.start)));
      const sorted = [...lookback].sort((a, b) => a - b);
      const expected = sorted.length ? sorted[Math.floor(sorted.length / 2)] : baseline;
      const upper = expected + 3 * Math.sqrt(Math.max(1, expected));
      series.push({ date: DATES[d], count: negSeries[d], expected: Math.round(expected * 10) / 10, upper: Math.round(upper * 10) / 10 });
    }
    const observed = negSeries[s.peak];
    const score = Math.round(((observed - baseline) / Math.sqrt(Math.max(1, baseline))) * 10) / 10;
    const items = (m.byTheme.get(t.seed.id) ?? []).filter((f) => f.created_at >= DATES[s.start] && f.sentiment === "negative");
    const evidence = (items.length >= 3 ? items : m.byTheme.get(t.seed.id) ?? []).slice(0, 5);
    const summary =
      `Negative feedback on **${t.seed.name}** reached ${observed}/day on ${DATES[s.peak]}, against an expected ${Math.round(baseline)}/day ` +
      `(score ${score}). ${t.seed.description} ${cite(evidence, 0)} ${cite(evidence, 1)}\n\n` +
      `Reports cluster around *${t.seed.keywords.slice(0, 3).join("*, *")}*, ` +
      `${s.kind === "emerging_theme" ? "and the theme had almost no volume before " + DATES[s.start] + " — it is new, not seasonal" : "consistent with a regression shipped just before " + DATES[s.start]} ${cite(evidence, 2)}.`;
    out.push({
      id: `al_${t.seed.id}`,
      kind: s.kind,
      theme_id: t.seed.id,
      theme_name: t.seed.name,
      start_date: DATES[s.start],
      peak_date: DATES[s.peak],
      severity: SEV(score),
      score,
      baseline: Math.round(baseline * 10) / 10,
      observed,
      series,
      evidence,
      summary,
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

export function buildInsights(wsId: string): Insight[] {
  const m = getModel(wsId);
  const alerts = buildAlerts(wsId);
  const byNeg = [...m.themes].filter((t) => t.seed.neg > 0.5).sort((a, b) => b.negCount - a.negCount);
  const praise = [...m.themes].filter((t) => t.seed.intent === "praise").sort((a, b) => b.count - a.count)[0];
  const fr = [...m.themes].filter((t) => t.seed.intent === "feature_request").sort((a, b) => b.count - a.count)[0];
  const ev = (id: string, n = 3) => (m.byTheme.get(id) ?? []).slice(0, n);
  const out: Insight[] = [];
  const top = byNeg[0];
  if (top) {
    const e = ev(top.seed.id);
    out.push({
      id: "in_pain", kind: "pain_point", theme_id: top.seed.id, groundedness: 0.94, citations: e,
      title: `${top.seed.name} is the largest source of negative feedback`,
      body: `${top.negCount.toLocaleString("en-US")} negative mentions (${Math.round((top.negCount / top.count) * 100)}% of the theme). ${top.seed.description} [#${e[0]?.id}] [#${e[1]?.id}]`,
    });
  }
  if (alerts[0]) {
    const a = alerts.find((x) => x.kind === "emerging_theme") ?? alerts[0];
    out.push({
      id: "in_emerging", kind: "emerging", theme_id: a.theme_id, groundedness: 0.88, citations: a.evidence.slice(0, 3),
      title: `${a.theme_name} is ${a.kind === "emerging_theme" ? "an emerging issue" : "spiking"}`,
      body: `Peaked at ${a.observed}/day on ${a.peak_date} vs. ${a.baseline}/day expected. Users describe it consistently across sources. [#${a.evidence[0]?.id}] [#${a.evidence[1]?.id}]`,
    });
  }
  if (fr) {
    const e = ev(fr.seed.id);
    out.push({
      id: "in_fr", kind: "feature_request", theme_id: fr.seed.id, groundedness: 0.91, citations: e,
      title: `Most requested: ${fr.seed.name.toLowerCase()}`,
      body: `${fr.count.toLocaleString("en-US")} mentions; requests often appear alongside pricing complaints, framing the feature as justification for the price. [#${e[0]?.id}] [#${e[1]?.id}]`,
    });
  }
  if (praise) {
    const e = ev(praise.seed.id);
    out.push({
      id: "in_praise", kind: "praise", theme_id: praise.seed.id, groundedness: 0.97, citations: e,
      title: `${praise.seed.name} drives retention`,
      body: `The strongest positive theme (${Math.round((praise.posCount / praise.count) * 100)}% positive). Several users cite it as the reason they stay. [#${e[0]?.id}] [#${e[1]?.id}]`,
    });
  }
  return out;
}
