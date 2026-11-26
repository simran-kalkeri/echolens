"""EchoLens API (FastAPI). Contract: docs/api-contract.ts"""
from __future__ import annotations

import json
import math

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from api.store import ASPECT_LABELS, FB_COLS, WS_NAMES, feedback_by_ids, q, serving, to_feedback

app = FastAPI(title="EchoLens API", version="1.0", description="Customer-feedback intelligence: themes, trends, alerts, grounded AI analyst.")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def _d(x) -> str:
    return pd.Timestamp(x).strftime("%Y-%m-%d")


def _f(x, nd=4):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), nd)


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/workspaces")
def workspaces():
    df = q("SELECT workspace, list(DISTINCT source) AS sources, count(*) n, min(created_at) d0, max(created_at) d1 FROM feedback GROUP BY 1 ORDER BY n DESC")
    order = ["spotify", "apple", "amazon", "uber", "delta", "xbox"]
    rows = [{"id": r.workspace, "name": WS_NAMES.get(r.workspace, r.workspace), "sources": sorted(r.sources), "n_feedback": int(r.n),
             "date_min": _d(r.d0), "date_max": _d(r.d1)} for r in df.itertuples()]
    return sorted(rows, key=lambda r: order.index(r["id"]) if r["id"] in order else 99)


@app.get("/api/overview")
def overview(ws: str):
    k = q("""SELECT count(*) total, avg((sentiment='negative')::int)*100 neg, avg((sentiment='positive')::int)*100 pos,
             avg(rating) avg_rating, sum((urgency='critical')::int) crit FROM feedback WHERE workspace=?""", ws).iloc[0]
    if k.total == 0:
        raise HTTPException(404, "unknown workspace")
    n_alerts = int(q("SELECT count(*) c FROM alerts WHERE workspace=?", ws).c[0])
    n_themes = int(q("SELECT count(*) c FROM themes WHERE workspace=?", ws).c[0])
    trend = q("SELECT date, positive, neutral, negative, total FROM daily_sentiment WHERE workspace=? ORDER BY date", ws)
    top = q("SELECT ts.theme_id, t.theme_name FROM theme_stats ts JOIN themes t USING(workspace, theme_id) WHERE ts.workspace=? ORDER BY ts.count DESC LIMIT 8", ws)
    stream = q("""SELECT d.date, t.theme_name, d.count FROM daily_theme d JOIN themes t USING(workspace, theme_id)
                  WHERE d.workspace=? AND d.theme_id IN (SELECT unnest(?)) ORDER BY d.date""", ws, top.theme_id.tolist())
    piv = stream.pivot_table(index="date", columns="theme_name", values="count", fill_value=0).reset_index()
    theme_stream = [{"date": _d(r["date"]), **{c: int(r[c]) for c in piv.columns if c != "date"}} for _, r in piv.iterrows()]
    mix = lambda col: [{col: r[col], "count": int(r["n"])} for _, r in q(f"SELECT {col}, count(*) n FROM feedback WHERE workspace=? GROUP BY 1 ORDER BY 2 DESC", ws).iterrows()]
    asp = q("SELECT * FROM aspect_sentiment WHERE workspace=? AND aspect<>'other' ORDER BY positive+neutral+negative DESC", ws)
    movers = q("""SELECT ts.theme_id, t.theme_name name, ts.delta_pct, ts.neg_share, ts.count FROM theme_stats ts JOIN themes t USING(workspace, theme_id)
                  WHERE ts.workspace=? AND ts.recent >= 10 ORDER BY ts.delta_pct DESC LIMIT 6""", ws)
    return {
        "kpis": {"total": int(k.total), "negative_pct": _f(k.neg, 1), "sentiment_index": _f(k.pos - k.neg, 1),
                 "avg_rating": _f(k.avg_rating, 2), "open_alerts": n_alerts, "themes": n_themes, "critical_count": int(k.crit or 0)},
        "sentiment_trend": [{"date": _d(r.date), "positive": int(r.positive), "neutral": int(r.neutral), "negative": int(r.negative)} for r in trend.itertuples()],
        "theme_stream": theme_stream,
        "channel_mix": mix("source"), "intent_mix": mix("intent"), "urgency_mix": mix("urgency"),
        "aspect_sentiment": [{"aspect": r.aspect, "label": ASPECT_LABELS.get(r.aspect, r.aspect), "positive": int(r.positive), "neutral": int(r.neutral), "negative": int(r.negative)} for r in asp.itertuples()],
        "top_movers": [{"theme_id": r.theme_id, "name": r.name, "delta_pct": _f(r.delta_pct, 1), "neg_share": _f(r.neg_share, 3), "count": int(r.count)} for r in movers.itertuples()],
        "calendar": [{"date": _d(r.date), "negative": int(r.negative), "total": int(r.total)} for r in trend.itertuples()],
    }


def _themes_df(ws: str) -> pd.DataFrame:
    return q("""SELECT t.theme_id, t.theme_name, t.description, t.aspect, t.keywords, ts.count, ts.neg_share, ts.sentiment_score
                FROM themes t JOIN theme_stats ts USING(workspace, theme_id) WHERE t.workspace=? ORDER BY ts.count DESC""", ws)


def _trends(ws: str) -> dict:
    df = q("SELECT theme_id, date, count FROM daily_theme WHERE workspace=? ORDER BY date", ws)
    return {tid: [{"date": _d(d), "count": int(c)} for d, c in zip(g.date, g["count"])] for tid, g in df.groupby("theme_id")}


def _theme(r, trends) -> dict:
    return {"id": r.theme_id, "name": r.theme_name, "description": r.description or "", "aspect": r.aspect, "count": int(r.count),
            "neg_share": _f(r.neg_share, 3), "sentiment_score": _f(r.sentiment_score, 3), "keywords": list(r.keywords)[:8],
            "trend": trends.get(r.theme_id, [])}


@app.get("/api/themes")
def themes(ws: str):
    t = _themes_df(ws)
    trends = _trends(ws)
    asp = q("SELECT * FROM aspect_sentiment WHERE workspace=?", ws).set_index("aspect")
    out = []
    for a, g in t.groupby("aspect"):
        s = asp.loc[a] if a in asp.index else None
        out.append({"id": a, "label": ASPECT_LABELS.get(a, a), "count": int(g["count"].sum()),
                    "positive": int(s.positive) if s is not None else 0, "neutral": int(s.neutral) if s is not None else 0,
                    "negative": int(s.negative) if s is not None else 0, "themes": [_theme(r, trends) for r in g.itertuples()]})
    return {"aspects": sorted(out, key=lambda x: -x["count"])}


@app.get("/api/themes/{theme_id}")
def theme_detail(theme_id: str, ws: str):
    t = _themes_df(ws)
    t = t[t.theme_id == theme_id]
    if t.empty:
        raise HTTPException(404, "theme not found")
    base = _theme(next(t.itertuples()), _trends(ws))
    mix = lambda col: [{col: r[col], "count": int(r["n"])} for _, r in q(f"SELECT {col}, count(*) n FROM feedback WHERE workspace=? AND theme_id=? GROUP BY 1 ORDER BY 2 DESC", ws, theme_id).iterrows()]
    rel = q("""SELECT e2.src AS id, t.theme_name AS name, sum(least(e1.weight, e2.weight)) w
               FROM graph_edges e1 JOIN graph_edges e2 ON e1.workspace=e2.workspace AND e1.dst=e2.dst AND e1.kind='belongs_to' AND e2.kind='belongs_to'
               JOIN themes t ON t.workspace=e2.workspace AND t.theme_id=e2.src
               WHERE e1.workspace=? AND e1.src=? AND e2.src<>? GROUP BY 1,2 ORDER BY w DESC LIMIT 6""", ws, theme_id, theme_id)
    ev = q(f"SELECT {FB_COLS} FROM feedback WHERE workspace=? AND theme_id=? ORDER BY cluster_prob DESC, length(text) DESC LIMIT 12", ws, theme_id)
    summaries = serving("theme_summaries", {})
    mx = float(rel.w.max()) if len(rel) else 1.0
    return {**base, "intent_mix": mix("intent"), "urgency_mix": mix("urgency"),
            "related": [{"id": r.id, "name": r.name, "weight": round(float(r.w) / mx, 3)} for r in rel.itertuples()],
            "evidence": [to_feedback(r) for _, r in ev.iterrows()], "summary": summaries.get(theme_id)}


@app.get("/api/graph")
def graph(ws: str):
    g = serving(f"graph_{ws}")
    if g is None:
        raise HTTPException(404, "graph not built")
    return g


@app.get("/api/galaxy")
def galaxy(ws: str):
    g = serving(f"galaxy_{ws}")
    if g is None:
        raise HTTPException(404, "galaxy not built")
    return g


@app.get("/api/alerts")
def alerts(ws: str):
    a = q("""SELECT a.*, t.theme_name FROM alerts a JOIN themes t USING(workspace, theme_id) WHERE a.workspace=?
             ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, score DESC LIMIT 40""", ws)
    summaries = serving("alert_summaries", {})
    out = []
    for r in a.itertuples():
        ser = q("""SELECT date, count, expected, upper FROM theme_series WHERE workspace=? AND theme_id=?
                   AND date BETWEEN ?::DATE - INTERVAL 30 DAY AND ?::DATE + INTERVAL 14 DAY ORDER BY date""", ws, r.theme_id, r.peak_date, r.peak_date)
        ev = q(f"""SELECT {FB_COLS} FROM feedback WHERE workspace=? AND theme_id=? AND sentiment='negative'
                   AND created_at::DATE BETWEEN ?::DATE AND ?::DATE ORDER BY urgency_score DESC LIMIT 6""", ws, r.theme_id, r.start_date, r.end_date)
        out.append({"id": r.alert_id, "kind": r.kind, "theme_id": r.theme_id, "theme_name": r.theme_name, "start_date": _d(r.start_date),
                    "peak_date": _d(r.peak_date), "severity": r.severity, "score": _f(r.score, 2), "baseline": _f(r.baseline, 2),
                    "observed": _f(r.observed, 1),
                    "series": [{"date": _d(s.date), "count": int(s.count), "expected": _f(s.expected, 2), "upper": _f(s.upper, 2)} for s in ser.itertuples()],
                    "evidence": [to_feedback(e) for _, e in ev.iterrows()], "summary": summaries.get(r.alert_id)})
    return out


@app.get("/api/feedback")
def feedback(ws: str, q_: str | None = Query(None, alias="q"), aspect: str | None = None, sentiment: str | None = None,
             intent: str | None = None, urgency: str | None = None, source: str | None = None, theme: str | None = None,
             page: int = 1, page_size: int = 25):
    where, params = ["workspace=?"], [ws]
    for col, val in [("sentiment", sentiment), ("intent", intent), ("urgency", urgency), ("source", source), ("theme_id", theme)]:
        if val:
            where.append(f"{col}=?")
            params.append(val)
    if aspect:
        where.append("list_contains(list_transform(aspects, x -> x.aspect), ?)")
        params.append(aspect)
    page_size = max(1, min(page_size, 100))
    if q_:
        from retrieval.search import search
        hits = [i for i, _ in search(ws, q_, k=200)]
        df = q(f"SELECT {FB_COLS} FROM feedback WHERE {' AND '.join(where)} AND feedback_id IN (SELECT unnest(?))", *params, hits)
        rank = {i: n for n, i in enumerate(hits)}
        df = df.assign(_r=df.feedback_id.map(rank)).sort_values("_r")
        total = len(df)
        df = df.iloc[(page - 1) * page_size : page * page_size]
    else:
        total = int(q(f"SELECT count(*) c FROM feedback WHERE {' AND '.join(where)}", *params).c[0])
        df = q(f"SELECT {FB_COLS} FROM feedback WHERE {' AND '.join(where)} ORDER BY created_at DESC LIMIT {page_size} OFFSET {(page - 1) * page_size}", *params)
    return {"items": [to_feedback(r) for _, r in df.iterrows()], "total": total, "page": page, "page_size": page_size}


@app.get("/api/pipeline")
def pipeline():
    p = serving("pipeline")
    if p is None:
        raise HTTPException(404, "no pipeline run recorded")
    return p


@app.get("/api/eval")
def evaluation():
    e = serving("eval")
    if e is None:
        raise HTTPException(404, "evaluation not run")
    return e


@app.get("/api/insights")
def insights(ws: str):
    ins = serving("insights", {}).get(ws, [])
    for i in ins:
        i["citations"] = feedback_by_ids(i.get("citation_ids", []))
    return ins


class AskBody(BaseModel):
    ws: str
    question: str


@app.post("/api/analyst/ask")
def ask(body: AskBody):
    from analyst.agent import run_agent

    def gen():
        try:
            for ev in run_agent(body.ws, body.question):
                yield f"data: {json.dumps(ev, default=str)}\n\n"
        except Exception as e:  # surface errors to the UI instead of dropping the stream
            yield f"data: {json.dumps({'type': 'error', 'text': str(e)})}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
