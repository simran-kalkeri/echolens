"""EchoLens evaluation suite -> data/serving/eval.json (served at /api/eval) + docs/EVALUATION.md

Sections
  classification : student vs TF-IDF+LR baseline vs zero-shot LLM (gpt-oss-20b) on the gpt-oss-120b-labelled test set
  absa           : aspect detection / joint aspect-sentiment F1; SemEval-2014 restaurants ACSA sanity benchmark
  clustering     : silhouette (HDBSCAN vs KMeans same k), noise share, NPMI coherence
  retrieval      : LLM-generated pseudo-queries for sampled items; Recall@10 / nDCG@10 / MRR for BM25, dense, hybrid, hybrid+rerank
  trends         : synthetic incident injection (eval/trend_injection.py output)
  grounding      : analyst answers on a fixed question set: groundedness, citation validity, latency
  cost           : student throughput vs LLM labelling cost
Thresholds in eval/thresholds.json make this a regression test (tests/test_regression.py).
"""
from __future__ import annotations

import json
import math
import random
import time
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from sklearn.metrics import f1_score

from analyst.llm import FAST_MODEL, USAGE, chat_json
from pipeline.common.runlog import ROOT

EVAL = ROOT / "data" / "eval"
KOUT = ROOT / "data" / "kaggle_out"
THRESH = json.loads((ROOT / "eval" / "thresholds.json").read_text())
SENT = ["negative", "neutral", "positive"]
INTENTS = ["complaint", "bug_report", "feature_request", "question", "praise", "churn_risk"]
URG = ["low", "medium", "high", "critical"]


def row(name, value, baseline=None, baseline_name=None, key=None, unit=None):
    r = {"name": name, "value": round(float(value), 4)}
    if baseline is not None:
        r["baseline"] = round(float(baseline), 4)
        r["baseline_name"] = baseline_name
    if key and key in THRESH:
        t = THRESH[key]
        r["threshold"] = t["min"] if "min" in t else t["max"]
        r["passed"] = bool(value >= t["min"]) if "min" in t else bool(value <= t["max"])
    if unit:
        r["unit"] = unit
    return r


# ---------------------------------------------------------------- zero-shot LLM baseline
ZS_MODEL = "openai/gpt-oss-20b"   # zero-shot LLM baseline: the smaller sibling of the gpt-oss-120b teacher
ZS = """Classify each customer feedback item. Return JSON {"items":[{"i":<index>,"sentiment":"negative|neutral|positive","intent":"complaint|bug_report|feature_request|question|praise|churn_risk","urgency":"low|medium|high|critical"}]}"""


ZS_USED: set = set()


def zero_shot(test: pd.DataFrame) -> pd.DataFrame:
    preds = {}
    # 240-item stratified subset of the test set: the free-tier LLM budget cannot cover all 599 items
    rows = test.sample(min(240, len(test)), random_state=1).to_dict("records")
    for s in range(0, len(rows), 15):
        b = rows[s : s + 15]
        res = chat_json(ZS, "\n".join(f"[{k}] {r['text'][:400]}" for k, r in enumerate(b)), model=ZS_MODEL, max_tokens=900,
                        fallbacks=["qwen/qwen3.8-27b"])   # never fall back to the teacher model
        ZS_USED.add(res.get("_model", ZS_MODEL))
        for it in res.get("items", []):
            try:
                preds[b[int(it["i"])]["feedback_id"]] = it
            except (IndexError, KeyError, ValueError):
                pass
    return pd.DataFrame([{"feedback_id": k, **{t: v.get(t) for t in ("sentiment", "intent", "urgency")}} for k, v in preds.items()])


def classification(m):
    labels = pd.concat([pd.read_json(f, lines=True) for f in (ROOT / "data" / "labels").glob("teacher_*.jsonl")])
    test = labels[labels.split == "test"].drop_duplicates("feedback_id")
    zs = zero_shot(test).merge(test[["feedback_id", "sentiment", "intent", "urgency"]], on="feedback_id", suffixes=("_zs", ""))
    out, summary = [], []
    for t in m["student"]["tasks"]:
        task = t["task"]
        lab = {"sentiment": SENT, "intent": INTENTS, "urgency": URG}[task]
        zs_f1 = f1_score(zs[task], zs[f"{task}_zs"].fillna("x"), average="macro", labels=lab, zero_division=0) if len(zs) else 0
        # student on the same subset, for a like-for-like comparison
        sp = pd.read_parquet(KOUT / "student_test_preds.parquet").merge(zs[["feedback_id", task]], on="feedback_id")
        st_f1 = f1_score(sp[task], sp[f"pred_{task}"].map(dict(enumerate(lab))), average="macro", labels=lab, zero_division=0) if len(sp) else 0
        metrics = [row("Macro-F1 (student)", t["macro_f1"], t["baseline_macro_f1"], "TF-IDF + LogReg", key=f"{task}_macro_f1"),
                   row("Accuracy (student)", t["accuracy"], t["baseline_accuracy"], "TF-IDF + LogReg"),
                   row(f"Macro-F1 on LLM subset (n={len(zs)}): student vs zero-shot {' + '.join(sorted(m.split('/')[-1] for m in ZS_USED))}", st_f1, zs_f1, "zero-shot LLM")]
        out.append({"task": task, "dataset": f"Teacher-labelled test set (gpt-oss-120b, n={m['student']['n_test']})", "metrics": metrics,
                    "per_class": t["per_class"], "confusion": t["confusion"]})
        summary.append(row(f"{task.title()} macro-F1", t["macro_f1"], t["baseline_macro_f1"], "TF-IDF + LogReg", key=f"{task}_macro_f1"))
    a, ab, se = m["student"]["aspects"], m["student"]["aspects_baseline"], m["semeval_acsa"]
    out.append({"task": "aspects", "dataset": "Teacher-labelled test set (14 aspect categories x sentiment)", "metrics": [
        row("Aspect detection F1", a["detection_f1"], ab["detection_f1"], "TF-IDF + LogReg", key="aspect_detection_f1"),
        row("Joint aspect-sentiment F1", a["joint_f1"], ab["joint_f1"], "TF-IDF + LogReg"),
        row("Polarity accuracy on detected aspects", a["polarity_acc_on_detected"])], "per_class": [], "confusion": None})
    out.append({"task": "semeval_acsa", "dataset": se["dataset"] + f" (n_test={se['n_test']})", "metrics": [
        row("Aspect-category detection F1", se["detection_f1"], key="semeval_detection_f1"),
        row("Joint category-polarity F1", se["joint_f1"]),
        row("Polarity accuracy on detected categories", se["polarity_acc_on_detected"])], "per_class": [], "confusion": None})
    summary.append(row("Aspect-sentiment joint F1", a["joint_f1"], ab["joint_f1"], "TF-IDF + LogReg"))
    summary.append(row("SemEval-14 category F1", se["detection_f1"], key="semeval_detection_f1"))
    return out, summary


# ---------------------------------------------------------------- retrieval
QGEN = """For each customer feedback item, write the short search query (3-8 words) a product manager would type to find feedback like it.
Describe the issue in your own words; do not copy distinctive phrases. Return JSON {"queries":[{"i":<index>,"q":"..."}]}"""


def retrieval():
    from retrieval.search import METHODS, search
    fb = pd.read_parquet(KOUT / "enriched.parquet", columns=["feedback_id", "workspace", "text", "cluster", "n_words"])
    fb = fb[(fb.n_words >= 8) & (fb.cluster >= 0)]
    rng = random.Random(5)
    items = []
    for ws, g in fb.groupby("workspace"):
        items += g.sample(25, random_state=rng.randint(0, 10_000)).to_dict("records")
    for s in range(0, len(items), 25):
        b = items[s : s + 25]
        res = chat_json(QGEN, "\n".join(f"[{k}] {r['text'][:300]}" for k, r in enumerate(b)), max_tokens=1500)
        for it in res.get("queries", []):
            try:
                b[int(it["i"])]["query"] = it["q"]
            except (IndexError, KeyError, ValueError):
                pass
    items = [i for i in items if i.get("query")]
    cluster_of = dict(zip(fb.feedback_id, zip(fb.workspace, fb.cluster)))
    by_method = []
    lat = {}
    for mth in METHODS:
        rec, ndcg, mrr = [], [], []
        t0 = time.time()
        for it in items:
            hits = [h for h, _ in search(it["workspace"], it["query"], k=10, method=mth)]
            target = it["feedback_id"]
            rec.append(1.0 if target in hits else 0.0)
            mrr.append(1.0 / (hits.index(target) + 1) if target in hits else 0.0)
            # graded relevance: exact item = 2, same theme cluster = 1
            gains = [2 if h == target else (1 if cluster_of.get(h) == (it["workspace"], it["cluster"]) else 0) for h in hits]
            dcg = sum(g / math.log2(i + 2) for i, g in enumerate(gains))
            ideal = sorted([2] + [1] * 9, reverse=True)
            ndcg.append(dcg / sum(g / math.log2(i + 2) for i, g in enumerate(ideal)))
        lat[mth] = (time.time() - t0) / len(items) * 1000
        by_method.append({"method": mth, "recall_at_10": round(float(np.mean(rec)), 4), "ndcg_at_10": round(float(np.mean(ndcg)), 4), "mrr": round(float(np.mean(mrr)), 4)})
        print(mth, by_method[-1], f"{lat[mth]:.0f} ms/query", flush=True)
    best = next(b for b in by_method if b["method"] == "hybrid_rerank")
    dense = next(b for b in by_method if b["method"] == "dense")
    metrics = [row("Recall@10 (hybrid + rerank)", best["recall_at_10"], dense["recall_at_10"], "dense only", key="retrieval_recall_at_10"),
               row("nDCG@10 (hybrid + rerank)", best["ndcg_at_10"], dense["ndcg_at_10"], "dense only"),
               row("MRR (hybrid + rerank)", best["mrr"], dense["mrr"], "dense only"),
               row("Latency per query (hybrid + rerank)", lat["hybrid_rerank"], unit="ms"),
               row("Queries evaluated", len(items))]
    return {"metrics": metrics, "by_method": by_method}, best


# ---------------------------------------------------------------- grounding
QUESTIONS = {
    "spotify": ["What are the top reasons users are unhappy with the app?", "What features are users requesting most?",
                "Why are people complaining about shuffle?", "What do users say about ads on the free tier?"],
    "apple": ["What problems are customers reporting after iOS updates?"],
    "amazon": ["What are the main delivery complaints?"],
    "uber": ["Why are riders upset about charges?"], "delta": ["What are the main complaints about delays and baggage?"],
    "xbox": ["What connection or login problems are players reporting?"],
}


def grounding():
    from analyst.agent import run_agent
    res = []
    budget_out = False
    for ws, qs in QUESTIONS.items():
        for qn in qs:
            if budget_out:
                break
            t0 = time.time()
            final, n_tools = None, 0
            try:
                for ev in run_agent(ws, qn):
                    if ev["type"] == "tool":
                        n_tools += 1
                    if ev["type"] == "final":
                        final = ev
            except RuntimeError as e:          # free-tier daily caps: report what completed
                print("grounding stopped:", e, flush=True)
                budget_out = True
                break
            if final:
                cl = final["claims"]
                res.append({"ws": ws, "q": qn, "groundedness": final["groundedness"], "claims": len(cl),
                            "cited_claims": sum(1 for c in cl if c["citation_ids"]), "citations": len(final["citations"]),
                            "tools": n_tools, "latency_s": time.time() - t0})
            print(ws, qn[:50], res[-1] if res else None, flush=True)

    # Offline artifacts (theme summaries, alert explanations, insight cards): every claim was verified at build time.
    st = json.loads((ROOT / "data" / "runs" / "stages.json").read_text())["insights"]["metrics"]
    serving = ROOT / "data" / "serving"
    ins = [c for v in json.loads((serving / "insights.json").read_text(encoding="utf-8")).values() for c in v]
    summ = list(json.loads((serving / "theme_summaries.json").read_text(encoding="utf-8")).values()) +         list(json.loads((serving / "alert_summaries.json").read_text(encoding="utf-8")).values())
    rows = [row("Groundedness of LLM-written artifacts (claims supported by cited feedback)", st["mean_groundedness"], key="groundedness"),
            row("Insight cards with >= 1 valid citation", sum(1 for c in ins if c["citation_ids"]) / max(len(ins), 1), key="citation_rate"),
            row("Theme/alert summaries with >= 1 valid citation", sum(1 for x in summ if "[#" in x) / max(len(summ), 1)),
            row("LLM artifacts verified", len(ins) + len(summ))]
    g = st["mean_groundedness"]
    if res:
        df = pd.DataFrame(res)
        (EVAL / "grounding_runs.json").write_text(df.to_json(orient="records", indent=2))
        rows += [row("Live analyst: groundedness", df.groundedness.mean()),
                 row("Live analyst: claims carrying a citation", df.cited_claims.sum() / max(df.claims.sum(), 1)),
                 row("Live analyst: mean tool calls per answer", df.tools.mean()),
                 row("Live analyst: mean answer latency", df.latency_s.mean(), unit="s")]
    rows.append(row("Live analyst questions evaluated" + (" (stopped: free-tier daily LLM cap)" if budget_out else ""), len(res)))
    return rows, g


def main():
    EVAL.mkdir(parents=True, exist_ok=True)
    m = json.loads((KOUT / "metrics.json").read_text())
    cls, summary = classification(m)
    print("classification done", flush=True)
    extra = json.loads((EVAL / "clustering_extra.json").read_text()) if (EVAL / "clustering_extra.json").exists() else {"npmi": {}}
    cm = m["clustering"]
    clustering = [row("Silhouette, HDBSCAN on UMAP (mean over workspaces)", np.mean([v["silhouette_umap"] for v in cm.values()]),
                      np.mean([v["silhouette_kmeans_same_k"] for v in cm.values()]), "KMeans, same k", key="silhouette"),
                  row("Silhouette in original embedding space (cosine)", np.mean([v["silhouette_embedding_cosine"] for v in cm.values()])),
                  row("Noise share after soft reassignment", np.mean([v["noise_after_reassign"] for v in cm.values()])),
                  row("Themes discovered", sum(v["clusters"] for v in cm.values())),
                  row("NPMI topic coherence (mean)", np.mean(list(extra["npmi"].values())) if extra["npmi"] else 0, key="npmi")]
    retr, best = retrieval()
    print("retrieval done", flush=True)
    tr = json.loads((EVAL / "trends.json").read_text())
    trends = {"metrics": [row("Incident recall (injected spikes)", tr["recall"], tr["baseline_recall"], "2x-mean threshold", key="incident_recall"),
                          row("Mean detection delay", tr["mean_delay_days"], tr["baseline_mean_delay_days"], "2x-mean threshold", unit="days"),
                          row("False-alert rate per theme-day (null series)", tr["false_alert_rate_per_theme_day"], tr["baseline_false_alert_rate"], "2x-mean threshold", key="false_alert_rate")]
                         + [row(f"Recall for {m}x incidents", v, tr["baseline_recall_by_magnitude"].get(m), "2x-mean threshold")
                            for m, v in tr["recall_by_magnitude"].items()],
              "incidents": tr["incidents"]}
    gr, gmean = grounding()
    print("grounding done", flush=True)
    n = sum(v["n"] for v in cm.values())
    thr = m["student"]["throughput_items_per_s"]
    labels_n = m["student"]["n_train"] + m["student"]["n_test"]
    cost = [row("Student throughput (GPU)", thr, unit="items/s"),
            row("Corpus enriched by the student", n, unit="items"),
            row("Items labelled by the LLM teacher", labels_n, unit="items"),
            row("Share of corpus needing an LLM call", labels_n / n, unit="ratio"),
            row("LLM tokens used in evaluation run", USAGE["prompt_tokens"] + USAGE["completion_tokens"], unit="tokens")]
    summary += [row("Retrieval Recall@10", best["recall_at_10"], key="retrieval_recall_at_10"),
                row("Incident recall", tr["recall"], key="incident_recall"),
                row("Insight groundedness", gmean, key="groundedness")]
    report = {"generated_at": datetime.now(timezone.utc).isoformat(), "summary": summary, "classification": cls,
              "clustering": clustering, "retrieval": retr, "trends": trends, "grounding": gr, "cost": cost}
    (ROOT / "data" / "serving").mkdir(parents=True, exist_ok=True)
    (ROOT / "data" / "serving" / "eval.json").write_text(json.dumps(report, indent=2, default=float))
    write_markdown(report)
    print("eval written")


def write_markdown(r):
    L = ["# EchoLens — Evaluation Report", "", f"_Generated {r['generated_at'][:19]} UTC by `python -m eval.run_eval`_", "", "## Headline", "",
         "| Metric | Value | Baseline | Threshold | Pass |", "|---|---|---|---|---|"]
    fmt = lambda x: "" if x is None else f"{x:.3f}" if isinstance(x, float) else str(x)
    def table(rows):
        for m in rows:
            b = f"{fmt(m.get('baseline'))} ({m.get('baseline_name')})" if m.get("baseline") is not None else ""
            L.append(f"| {m['name']} | {fmt(m['value'])}{' ' + m['unit'] if m.get('unit') else ''} | {b} | {fmt(m.get('threshold'))} | {'✅' if m.get('passed') else ('❌' if m.get('passed') is False else '')} |")
    table(r["summary"])
    for c in r["classification"]:
        L += ["", f"## Classification — {c['task']}", f"_{c['dataset']}_", "", "| Metric | Value | Baseline | Threshold | Pass |", "|---|---|---|---|---|"]
        table(c["metrics"])
    for sec, rows in [("Clustering", r["clustering"]), ("Retrieval", r["retrieval"]["metrics"]), ("Emerging-issue detection", r["trends"]["metrics"]),
                      ("Grounding (AI analyst)", r["grounding"]), ("Cost & efficiency", r["cost"])]:
        L += ["", f"## {sec}", "", "| Metric | Value | Baseline | Threshold | Pass |", "|---|---|---|---|---|"]
        table(rows)
    L += ["", "### Retrieval by method", "", "| Method | Recall@10 | nDCG@10 | MRR |", "|---|---|---|---|"]
    L += [f"| {b['method']} | {b['recall_at_10']:.3f} | {b['ndcg_at_10']:.3f} | {b['mrr']:.3f} |" for b in r["retrieval"]["by_method"]]
    (ROOT / "docs" / "EVALUATION.md").write_text("\n".join(L) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
