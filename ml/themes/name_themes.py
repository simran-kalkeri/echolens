"""Turn HDBSCAN clusters into a named, two-level taxonomy (aspect -> theme).

For each (workspace, cluster): class-based TF-IDF keywords + the most representative items -> LLM gives a
specific theme name and one-sentence description. The L1 parent is the dominant predicted aspect.
Also computes NPMI topic coherence of the keyword sets (written to data/eval/clustering_extra.json).
"""
from __future__ import annotations

import json
import math
import re
from collections import Counter
from itertools import combinations

import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import CountVectorizer

from analyst.llm import chat_json
from pipeline.common.runlog import ROOT, stage

ENR = ROOT / "data" / "kaggle_out" / "enriched.parquet"
OUT = ROOT / "data" / "lake" / "themes"
STOP_EXTRA = {"app", "spotify", "amazon", "apple", "uber", "delta", "xbox", "user", "url", "just", "like", "im", "dont", "get", "would", "one", "can", "please", "thanks", "hi", "hey"}


def ctfidf(docs_by_cluster: dict[int, str], top_n=10) -> dict[int, list[str]]:
    keys = list(docs_by_cluster)
    cv = CountVectorizer(ngram_range=(1, 2), stop_words="english", min_df=2, token_pattern=r"(?u)\b[a-zA-Z][a-zA-Z]+\b")
    X = cv.fit_transform([docs_by_cluster[k] for k in keys]).astype(float)
    tf = X.multiply(1 / np.maximum(X.sum(1), 1))
    avg = X.sum() / len(keys)
    idf = np.log(1 + avg / np.maximum(np.asarray(X.sum(0)).ravel(), 1))
    score = tf.multiply(idf).tocsr()
    vocab = np.array(cv.get_feature_names_out())
    out = {}
    for i, k in enumerate(keys):
        row = score.getrow(i).toarray().ravel()
        words = [w for w in vocab[row.argsort()[::-1]] if w not in STOP_EXTRA and not any(p in STOP_EXTRA for p in w.split())]
        out[k] = words[:top_n]
    return out


def npmi(keywords: list[str], index: dict[str, set], n: int) -> float:
    """Mean pairwise NPMI of the top unigram keywords, using document co-occurrence (inverted index)."""
    def p(*ws):
        sets = [index.get(w, set()) for w in ws]
        return len(set.intersection(*sets)) / n if sets else 0.0
    vals = []
    for a, b in combinations([k for k in keywords if " " not in k][:8], 2):
        pab, pa, pb = p(a, b), p(a), p(b)
        if pab == 0 or pa == 0 or pb == 0:
            vals.append(-1.0)
            continue
        vals.append(math.log(pab / (pa * pb)) / -math.log(pab))
    return float(np.mean(vals)) if vals else 0.0


PROMPT = """You name customer-feedback themes for a product analytics tool used by product managers.
For each cluster you get keywords and representative feedback. Return JSON:
{"themes":[{"cluster":<id>,"name":"<specific 2-6 word issue/topic name, Title Case, e.g. 'Shuffle Repeats Same Songs'>","description":"<one sentence: what customers say>"}]}
Be specific (name the concrete problem/request), never generic like 'App Issues' or 'User Feedback'."""


def main() -> None:
    df = pd.read_parquet(ENR)
    rows = []
    coherence = {}
    with stage("taxonomy", "Theme Naming (Taxonomy)", "groq", "c-TF-IDF keywords + representative items -> LLM-named themes under aspect categories.") as s:
        for ws, g in df.groupby("workspace"):
            g = g[g.cluster >= 0]
            docs = {c: " ".join(gg.text.str.lower().tolist()) for c, gg in g.groupby("cluster")}
            kw = ctfidf(docs)
            index: dict[str, set] = {}
            sample = g.text.sample(min(20000, len(g)), random_state=0).tolist()
            for i, t in enumerate(sample):
                for w in set(re.findall(r"[a-z]+", t.lower())):
                    index.setdefault(w, set()).add(i)
            coherence[ws] = float(np.mean([npmi(kw[c], index, len(sample)) for c in kw]))
            payload = []
            meta = {}
            for c, gg in g.groupby("cluster"):
                reps = gg.sort_values("cluster_prob", ascending=False).head(4).text.str.slice(0, 160).tolist()
                asp = Counter(a["aspect"] for lst in gg.aspects for a in json.loads(lst)).most_common(1)
                meta[c] = {"count": len(gg), "aspect": asp[0][0] if asp else "other", "keywords": kw[c]}
                payload.append({"cluster": int(c), "keywords": kw[c][:6], "examples": reps})
            names = {}
            for i in range(0, len(payload), 12):
                res = chat_json(PROMPT, json.dumps(payload[i : i + 12], ensure_ascii=False), max_tokens=1500)
                for t in res.get("themes", []):
                    names[int(t["cluster"])] = t
            for c, m in meta.items():
                t = names.get(int(c), {})
                rows.append({"workspace": ws, "cluster": int(c), "theme_id": f"{ws}-t{int(c)}",
                             "theme_name": t.get("name") or " / ".join(m["keywords"][:3]).title(),
                             "description": t.get("description", ""), "aspect": m["aspect"],
                             "keywords": m["keywords"], "size": m["count"]})
            print(f"{ws}: {len(meta)} themes, NPMI={coherence[ws]:.3f}", flush=True)
        out = pd.DataFrame(rows)
        OUT.mkdir(parents=True, exist_ok=True)
        out.to_parquet(OUT / "themes.parquet", index=False)
        (ROOT / "data" / "eval").mkdir(parents=True, exist_ok=True)
        (ROOT / "data" / "eval" / "clustering_extra.json").write_text(json.dumps({"npmi": coherence}, indent=2))
        s.rows(len(df), len(out))
        s.metric("themes", len(out))
        s.metric("mean_npmi", round(float(np.mean(list(coherence.values()))), 4))
        s.check("all_themes_named", out.description.str.len().gt(0).mean() > 0.9, f"{out.description.str.len().gt(0).mean():.0%} named by LLM")


if __name__ == "__main__":
    main()
