"""Build serving artifacts consumed by the API:
- graph_<ws>.json   knowledge graph with Louvain communities + PageRank (NetworkX)
- galaxy_<ws>.json  3D embedding projection with cluster labels
- theme_summaries / alert_summaries / insights   LLM-written, evidence-cited ([#id]) and claim-verified
- pipeline.json     merged run metadata for the DAG view
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import networkx as nx
import numpy as np
import pandas as pd

from analyst.agent import CITE_RE, normalize_citations, verify_claims
from concurrent.futures import ThreadPoolExecutor

from analyst.llm import FAST_MODEL, USAGE, chat_json
from api.store import ASPECT_LABELS, SERVING, q
from pipeline.common.runlog import ROOT, STAGE_FILE, stage

INTENT_LABELS = {"complaint": "Complaint", "bug_report": "Bug report", "feature_request": "Feature request", "question": "Question", "praise": "Praise", "churn_risk": "Churn risk"}


def write(name, obj):
    SERVING.mkdir(parents=True, exist_ok=True)
    (SERVING / f"{name}.json").write_text(json.dumps(obj, ensure_ascii=False, default=str), encoding="utf-8")


def build_graph(ws: str) -> dict:
    e = q("SELECT src, dst, weight, kind FROM graph_edges WHERE workspace=?", ws)
    th = q("SELECT t.theme_id, t.theme_name, ts.count, ts.sentiment_score FROM themes t JOIN theme_stats ts USING(workspace, theme_id) WHERE t.workspace=?", ws)
    # keep each theme's strongest links so the graph stays readable
    e = e[(e.kind == "co_occurs") | (e.weight >= 3)]
    e = e.sort_values("weight", ascending=False).groupby(["src", "kind"]).head(3)
    G = nx.Graph()
    for r in th.itertuples():
        G.add_node(r.theme_id, label=r.theme_name, type="theme", size=int(r.count), sentiment=float(r.sentiment_score))
    def ensure(n):
        if n not in G:
            kind, key = n.split(":", 1)
            lab = ASPECT_LABELS.get(key) if kind == "aspect" else INTENT_LABELS.get(key) if kind == "intent" else key.title() + "s"
            G.add_node(n, label=lab or key, type=kind, size=0, sentiment=0.0)
    for r in e.itertuples():
        if r.src in G or ":" in r.src:
            ensure(r.dst)
            if ":" in r.src:
                ensure(r.src)
            G.add_edge(r.src, r.dst, weight=float(r.weight), kind=r.kind)
    # size/sentiment of category nodes from attached themes
    fb = q("""SELECT 'aspect:'||a.aspect AS n, count(*) c, avg(CASE a.sentiment WHEN 'positive' THEN 1 WHEN 'negative' THEN -1 ELSE 0 END) s
              FROM (SELECT unnest(aspects) a FROM feedback WHERE workspace=?) GROUP BY 1
              UNION ALL SELECT 'intent:'||intent, count(*), avg(sentiment_score) FROM feedback WHERE workspace=? GROUP BY 1
              UNION ALL SELECT 'source:'||source, count(*), avg(sentiment_score) FROM feedback WHERE workspace=? GROUP BY 1""", ws, ws, ws)
    for r in fb.itertuples():
        if r.n in G:
            G.nodes[r.n]["size"] = int(r.c)
            G.nodes[r.n]["sentiment"] = float(r.s)
    G.remove_nodes_from([n for n in list(G) if G.degree(n) == 0 and G.nodes[n]["type"] != "theme"])
    comms = nx.community.louvain_communities(G, weight="weight", seed=42)
    cid = {n: i for i, c in enumerate(comms) for n in c}
    pr = nx.pagerank(G, weight="weight")
    return {
        "nodes": [{"id": n, "label": d["label"], "type": d["type"], "size": d["size"], "sentiment": round(d["sentiment"], 3),
                   "community": cid.get(n, 0), "pagerank": round(pr.get(n, 0), 5)} for n, d in G.nodes(data=True)],
        "edges": [{"source": u, "target": v, "weight": d["weight"], "kind": d["kind"]} for u, v, d in G.edges(data=True)],
        "stats": {"nodes": G.number_of_nodes(), "edges": G.number_of_edges(), "communities": len(comms),
                  "modularity": round(nx.community.modularity(G, comms, weight="weight"), 4)},
    }


def build_galaxy(ws: str, gal: pd.DataFrame) -> dict:
    g = gal[gal.workspace == ws]
    meta = q("SELECT feedback_id, cluster, theme_id, theme_name, sentiment_score, substr(text,1,160) text FROM feedback WHERE workspace=? AND feedback_id IN (SELECT unnest(?))", ws, g.feedback_id.tolist())
    m = g.merge(meta, on="feedback_id")
    pts = [{"id": r.feedback_id, "x": round(r.x, 3), "y": round(r.y, 3), "z": round(r.z, 3), "cluster": int(r.cluster),
            "sentiment": round(float(r.sentiment_score), 3), "text": r.text} for r in m.itertuples()]
    cl = []
    for c, gg in m[m.cluster >= 0].groupby("cluster"):
        cl.append({"id": int(c), "theme_id": gg.theme_id.iloc[0], "name": gg.theme_name.iloc[0],
                   "centroid": [round(float(gg.x.median()), 3), round(float(gg.y.median()), 3), round(float(gg.z.median()), 3)], "count": int(len(gg))})
    return {"points": pts, "clusters": cl}


SUMMARY_PROMPT = """You are a customer-insights analyst. Write a {words}-word summary of the customer feedback below for a product manager.
Every sentence must end with citations of the feedback items that support it, written exactly like [#rv_123] [#tk_456] (square brackets, hash, the given id). Use only the given ids. Be specific and concrete.
Return JSON {{"summary":"<markdown text>"}}"""

INSIGHT_PROMPT = """You are a senior customer-insights analyst. From the theme statistics and evidence below, write the {n} most actionable insights for the product team.
Kinds: pain_point, feature_request, emerging, praise. Each body: 2-3 sentences, quantified using the stats, every sentence ending with citations written exactly like [#rv_123] [#tk_456] using evidence ids only. Statistics may be quoted from theme_stats.
Return JSON {{"insights":[{{"title":"<= 8 words","kind":"...","theme_id":"<theme id or null>","body":"..."}}]}}"""


def cited_summary(texts: list[dict], words: int, extra: str = "") -> tuple[str, float]:
    ev = {t["id"]: t["text"] for t in texts}
    res = chat_json(SUMMARY_PROMPT.format(words=words), extra + json.dumps(texts, ensure_ascii=False), model=FAST_MODEL, max_tokens=700)
    s = res.get("summary", "")
    s = normalize_citations(s, ev)
    claims = verify_claims(s, ev, extra)
    g = sum(c["supported"] for c in claims) / len(claims) if claims else 0.0
    return s, g


def evidence_for_theme(ws, theme_id, k=10, where="") -> list[dict]:
    df = q(f"""SELECT feedback_id id, substr(text,1,300) text FROM feedback WHERE workspace=? AND theme_id=? {where}
               ORDER BY cluster_prob DESC, length(text) DESC LIMIT ?""", ws, theme_id, k)
    return df.to_dict("records")


def llm_for_workspace(ws: str):
    theme_sum, alert_sum, gscores = {}, {}, []
    top = q("""SELECT t.theme_id, t.theme_name, t.aspect, ts.count, round(ts.neg_share,3) neg_share, ts.delta_pct
               FROM themes t JOIN theme_stats ts USING(workspace, theme_id) WHERE t.workspace=? ORDER BY ts.count DESC LIMIT 8""", ws)
    for r in top.itertuples():
        summ, g = cited_summary(evidence_for_theme(ws, r.theme_id), 70, f"Theme: {r.theme_name} ({r.count} items, {r.neg_share:.0%} negative)\n")
        theme_sum[r.theme_id] = summ
        gscores.append(g)
    al = q("""SELECT a.alert_id, a.theme_id, t.theme_name, a.start_date, a.end_date, a.peak_date, a.observed, a.baseline
              FROM alerts a JOIN themes t USING(workspace, theme_id) WHERE a.workspace=? ORDER BY a.score DESC LIMIT 4""", ws)
    for r in al.itertuples():
        ev = evidence_for_theme(ws, r.theme_id, 10, f"AND sentiment='negative' AND created_at::DATE BETWEEN DATE '{str(r.start_date)[:10]}' AND DATE '{str(r.end_date)[:10]}'")
        if ev:
            summ, g = cited_summary(ev, 60, f"Anomalous spike in negative feedback for '{r.theme_name}' peaking {str(r.peak_date)[:10]}: {r.observed:.0f} vs expected {r.baseline:.1f}/day. Explain what customers report.\n")
            alert_sum[r.alert_id] = summ
            gscores.append(g)
    stats = q("""SELECT t.theme_id, t.theme_name, t.aspect, ts.count, round(ts.neg_share,3) neg_share, ts.delta_pct growth_pct
                 FROM themes t JOIN theme_stats ts USING(workspace, theme_id) WHERE t.workspace=? ORDER BY ts.count*(0.5+ts.neg_share) DESC LIMIT 10""", ws)
    ev = []
    for tid in stats.theme_id.head(8):
        ev += evidence_for_theme(ws, tid, 4)
    fr = q("SELECT feedback_id id, substr(text,1,300) text FROM feedback WHERE workspace=? AND intent='feature_request' ORDER BY thumbs_up DESC NULLS LAST, length(text) DESC LIMIT 8", ws)
    ev += fr.to_dict("records")
    evd = {e["id"]: e["text"] for e in ev}
    res = chat_json(INSIGHT_PROMPT.format(n=4), json.dumps({"theme_stats": stats.to_dict("records"), "evidence": ev}, ensure_ascii=False, default=str), max_tokens=1600)
    cards = []
    raw = res.get("insights", [])
    raw = list(raw.values()) if isinstance(raw, dict) else raw
    for i, c in enumerate([c for c in raw if isinstance(c, dict)][:4]):
        body = normalize_citations(c.get("body", ""), evd)
        claims = verify_claims(body, evd, stats.to_json())
        g = sum(x["supported"] for x in claims) / len(claims) if claims else 0.0
        gscores.append(g)
        cards.append({"id": f"{ws}-ins{i}", "title": c.get("title", ""), "body": body, "kind": c.get("kind", "pain_point"),
                      "citation_ids": list(dict.fromkeys(CITE_RE.findall(body))), "groundedness": round(g, 3), "theme_id": c.get("theme_id")})
    print(f"{ws}: LLM serving done", flush=True)
    return theme_sum, alert_sum, cards, gscores


def main():
    import sys
    no_llm = "--no-llm" in sys.argv      # dry run: graph/galaxy/pipeline only
    workspaces = q("SELECT DISTINCT workspace FROM feedback").workspace.tolist()
    gal = pd.read_parquet(ROOT / "data" / "kaggle_out" / "galaxy.parquet")
    with stage("insights", "LLM Insight Generation", "groq",
               "Theme/alert summaries (gpt-oss-20b) and insight cards (gpt-oss-120b) with [#id] citations; every claim verified by a gpt-oss-120b judge.") as s:
        theme_sum, alert_sum, insights, gscores = {}, {}, {}, []
        for ws in workspaces:
            write(f"graph_{ws}", build_graph(ws))
            write(f"galaxy_{ws}", build_galaxy(ws, gal))
        if not no_llm:
            with ThreadPoolExecutor(max_workers=2) as ex:
                for ts, als, cards, gs in ex.map(llm_for_workspace, workspaces):
                    theme_sum.update(ts); alert_sum.update(als); gscores += gs
                    if cards:
                        insights[cards[0]["id"].split("-ins")[0]] = cards
        write("theme_summaries", theme_sum)
        write("alert_summaries", alert_sum)
        write("insights", insights)
        s.rows(None, len(theme_sum) + len(alert_sum) + sum(len(v) for v in insights.values()))
        s.metric("mean_groundedness", round(float(np.mean(gscores)), 4) if gscores else 0)
        s.metric("llm_calls", USAGE["calls"])
        s.metric("llm_tokens", USAGE["prompt_tokens"] + USAGE["completion_tokens"])
        s.check("summaries_grounded", (np.mean(gscores) if gscores else 0) >= 0.8, f"{np.mean(gscores) if gscores else 0:.1%} claims supported")
    build_pipeline_json()


DAG = [
    ("ingest", "Ingestion & Validation", "spark", "Unify reviews, tickets and surveys into one schema; validate."),
    ("clean_dedup", "Cleaning & Deduplication", "spark", "Clean text, redact PII, exact + MinHash-LSH dedup."),
    ("nlp", "NLP Intelligence Pipeline", "kaggle-gpu", "Groq teacher labels distilled into a multi-task ModernBERT student."),
    ("absa", "Aspect Sentiment & Urgency", "kaggle-gpu", "Aspect-category sentiment + urgency heads; SemEval-2014 check."),
    ("embed_cluster", "Embeddings & Topic Clustering", "kaggle-gpu", "bge-small embeddings -> UMAP -> HDBSCAN themes."),
    ("taxonomy", "Theme Naming (Taxonomy)", "groq", "c-TF-IDF keywords + representative items -> LLM-named themes."),
    ("analytics", "Analytics & Trend Detection", "spark", "Daily aggregates, anomaly scores, graph edges."),
    ("emerging", "Emerging Issue Detection", "spark", "Poisson z-score spikes per theme + newly emerging themes."),
    ("retrieval", "Semantic Retrieval", "python", "Hybrid BM25 + dense (bge-small) with RRF fusion and cross-encoder reranking."),
    ("insights", "LLM Insight Generation", "groq", "Cited summaries and insight cards, each claim verified."),
    ("dashboard", "Interactive Dashboard", "duckdb", "FastAPI over DuckDB gold tables -> Next.js dashboard."),
]
EDGES = [("ingest", "clean_dedup"), ("clean_dedup", "nlp"), ("nlp", "absa"), ("nlp", "embed_cluster"),
         ("embed_cluster", "taxonomy"), ("absa", "analytics"), ("taxonomy", "analytics"), ("analytics", "emerging"), ("analytics", "retrieval"),
         ("retrieval", "insights"), ("emerging", "dashboard"), ("insights", "dashboard")]


def build_pipeline_json():
    st = json.loads(STAGE_FILE.read_text(encoding="utf-8")) if STAGE_FILE.exists() else {}
    stages = []
    for sid, name, eng, desc in DAG:
        default = {"id": sid, "name": name, "engine": eng, "description": desc, "status": "skipped",
                   "rows_in": None, "rows_out": None, "duration_s": 0, "metrics": {}, "checks": []}
        if sid in ("emerging", "retrieval", "dashboard") and "analytics" in st:
            default["status"] = st["analytics"]["status"]
        rec = {**default, **{k: v for k, v in st.get(sid, {}).items() if v is not None}}
        if sid == "emerging" and "analytics" in st:
            rec["metrics"] = {"alerts": st["analytics"]["metrics"].get("alerts", 0), "method": "Poisson z >= 4, 14-day baseline"}
            rec["rows_in"] = st["analytics"]["metrics"].get("theme_days_scored")
            rec["rows_out"] = st["analytics"]["metrics"].get("alerts", 0)
        rec["metrics"] = {k: (json.dumps(v) if isinstance(v, (dict, list)) else v) for k, v in rec.get("metrics", {}).items()}
        stages.append({k: rec.get(k) for k in ["id", "name", "engine", "status", "rows_in", "rows_out", "duration_s", "description", "metrics", "checks"]})
    times = [v.get("started_at") for v in st.values() if v.get("started_at")] or [datetime.now(timezone.utc).isoformat()]
    ends = [v.get("finished_at") for v in st.values() if v.get("finished_at")] or times
    write("pipeline", {"run_id": "run-" + min(times)[:19].replace(":", "").replace("-", ""), "started_at": min(times), "finished_at": max(ends),
                       "stages": stages, "edges": [{"source": a, "target": b} for a, b in EDGES]})


if __name__ == "__main__":
    main()
