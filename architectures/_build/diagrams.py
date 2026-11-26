"""Generates every EchoLens architecture / workflow diagram as a native .excalidraw file.

    python architectures/_build/diagrams.py      # writes architectures/*.excalidraw
Numbers are the ones measured in the 2026-11-25 run (see docs/EVALUATION.md).
"""
from pathlib import Path

from excal import Diagram

OUT = Path(__file__).resolve().parents[1]


# =====================================================================================================================
def high_level() -> Diagram:
    d = Diagram("01-high-level-architecture", "EchoLens — high-level architecture",
                "Unstructured feedback in → structured, evidence-backed product insight out")
    d.zone(-20, 0, 270, 560, "1 · Sources", "source")
    d.zone(270, 0, 270, 560, "2 · Apache Spark (Docker)", "spark")
    d.zone(560, 0, 310, 560, "3 · ML  (Groq + Kaggle T4)", "ml")
    d.zone(890, 0, 290, 560, "4 · Analytics & intelligence", "intel")
    d.zone(1200, 0, 280, 560, "5 · Serving & UI", "serve")

    d.box("rev", 0, 60, 230, 70, "Play Store reviews\nSpotify · 61k", "source")
    d.box("tix", 0, 160, 230, 70, "Support tweets → tickets\n5 brands · 2.8M tweets", "source")
    d.box("sv", 0, 260, 230, 70, "NPS survey verbatims\nsynthetic · 225", "source")
    d.box("bench", 0, 450, 230, 70, "SemEval-2014 ABSA\nhuman-labelled benchmark", "store", dashed=True)

    d.box("bronze", 290, 60, 230, 80, "Bronze\nunify schema · validate", "spark")
    d.box("silver", 290, 190, 230, 100, "Silver\nclean · PII redaction\nexact + MinHash-LSH dedup\n208,593 items", "spark")
    d.box("eval", 290, 450, 230, 70, "Evaluation suite\nbaselines · regression gate", "eval")

    d.box("teacher", 580, 60, 270, 70, "LLM teacher labels\nGroq gpt-oss · 3.6k sample", "llm")
    d.box("student", 580, 165, 270, 80, "Multi-task ModernBERT student\nsentiment · intent · urgency\n14 aspects × sentiment", "ml")
    d.box("embed", 580, 280, 270, 70, "bge-small embeddings\nUMAP → HDBSCAN themes", "ml")
    d.box("naming", 580, 385, 270, 70, "LLM theme naming\naspect → theme taxonomy", "llm")

    d.box("gold", 910, 60, 250, 90, "Spark Gold\ndaily aggregates · graph edges\nPoisson z-score alerts", "spark")
    d.box("build", 910, 190, 250, 90, "Serving build\nNetworkX graph (Louvain, PageRank)\n3D galaxy · cited LLM insights", "llm", fs=14)
    d.box("retr", 910, 320, 250, 70, "Hybrid retrieval\nBM25 + dense · RRF · rerank", "intel")
    d.box("analyst", 910, 430, 250, 90, "AI analyst\ntool calling · [#id] citations\nclaim verification", "llm")

    d.box("store", 1220, 60, 240, 70, "Parquet lake + serving JSON\n(medallion: bronze/silver/gold)", "store")
    d.box("api", 1220, 170, 240, 70, "FastAPI + DuckDB\nREST + SSE streaming", "serve")
    d.box("web", 1220, 280, 240, 90, "Next.js dashboard · 9 views\nknowledge graph · 3D galaxy\nlive pipeline DAG", "serve")
    d.box("pm", 1235, 420, 210, 90, "PM / analyst\nevidence-backed\ndecisions", "user", shape="ellipse")

    for s in ("rev", "tix", "sv"):
        d.arrow(s, "bronze", bend=0.6)
    d.arrow("bronze", "silver", "287,854 items")
    d.arrow("silver", "teacher", sides="rl")
    d.arrow("teacher", "student", "distil")
    d.arrow("silver", "student", sides="rl")
    d.arrow("silver", "embed", sides="rl")
    d.arrow("embed", "naming", "clusters")
    d.arrow("student", "gold", sides="rl", bend=0.6)
    d.arrow("naming", "gold", sides="rl", bend=0.6)
    d.arrow("embed", "retr", sides="rl", bend=0.3)
    d.arrow("gold", "build")
    d.arrow("retr", "analyst")
    d.arrow("bench", "eval", sides="rl", dashed=True)
    d.arrow("build", "store", sides="rl", bend=0.3)
    d.arrow("store", "api")
    d.arrow("analyst", "api", "SSE", sides="rl", bend=0.7)
    d.arrow("api", "web")
    d.arrow("web", "pm")
    d.note(-20, 590, 900, "LLMs are used where they add the most: 3.6k teacher labels, ~290 theme names, insight text and the analyst.\n"
                          "Everything else runs on the distilled student (521 items/s on a T4) — only 1.7 % of items ever touch an LLM.")
    d.note(910, 590, 570, "Every metric has a baseline and a regression floor\n(eval/thresholds.json, enforced by pytest).")
    return d


# =====================================================================================================================
def spark_pipeline() -> Diagram:
    d = Diagram("02-low-level-spark-data-pipeline", "Low-level · Spark data pipeline (bronze → silver)",
                "pipeline/spark_jobs/ingest.py — PySpark 4.0.1 in the echolens-spark Docker image, Parquet medallion lake")
    d.zone(-20, 0, 1000, 330, "BRONZE · ingestion & validation", "spark")
    d.box("twcs", 0, 60, 230, 70, "twcs.csv\n2.81M tweets", "source")
    d.box("starters", 0, 160, 230, 80, "conversation starters:\ninbound, not a reply,\nanswered by a brand", "white")
    d.box("rev", 260, 60, 200, 70, "Spotify reviews CSV\n61.6k", "source")
    d.box("sv", 490, 60, 200, 70, "survey CSV\nNPS 0–10 → rating 1–5", "source")
    d.box("union", 260, 170, 430, 60, "unionByName → unified schema\nfeedback_id · workspace · source · text · rating · created_at · author_hash", "white", fs=14)
    d.box("rules", 720, 60, 240, 110, "validation rules\ntext_not_empty\ntimestamp_parsed\nrating_in_range (1–5)", "white", fs=14)
    d.box("rejects", 720, 210, 240, 60, "bronze/rejects\n(+ reject_reason)", "store")
    d.box("bronze", 260, 255, 430, 50, "bronze/feedback  · partitioned by workspace · 287,854 rows", "store", fs=14)

    d.arrow("twcs", "starters", "self-join on reply edge")
    d.arrow("starters", "union", sides="rl")
    d.arrow("rev", "union")
    d.arrow("sv", "union")
    d.arrow("union", "rules", sides="rl", bend=0.5)
    d.arrow("rules", "rejects", "fail")
    d.arrow("union", "bronze", "pass + dedup ids")

    d.zone(-20, 370, 1000, 470, "SILVER · cleaning, PII, dedup", "spark")
    d.box("clean", 0, 430, 220, 120, "normalise text\nstrip leading @mentions\nURL → <url>\ncollapse whitespace", "white", fs=14)
    d.box("pii", 250, 430, 220, 120, "PII redaction (regex)\nemail → <email>\ncard → <card>\nphone → <phone>\n@handle → @user", "eval", fs=14)
    d.box("lang", 500, 430, 220, 120, "quality filter\nASCII-letter share ≥ 0.85\n(English heuristic)\n≥ 3 words", "white", fs=14)
    d.box("exact", 750, 430, 210, 120, "exact dedup\nwindow over\n(workspace, norm text)\nkeep earliest", "white", fs=14)

    d.box("mh", 750, 600, 210, 90, "MinHashLSH\n12 hash tables\non token sets (≥ 8 words)", "spark", fs=14)
    d.box("band", 500, 600, 220, 90, "LSH banding\n3 bands × 4 rows\ngroupBy(band key) — linear", "spark", fs=14)
    d.box("verify", 250, 600, 220, 90, "candidate pairs in buckets\n(2–60 members)\nexact Jaccard ≥ 0.8", "spark", fs=14)
    d.box("cap", 0, 600, 220, 90, "left-anti join drops near-dups\nsampleBy: ≤ 45k per workspace", "white", fs=14)
    d.box("silver", 0, 740, 460, 60, "silver/feedback · 208,593 rows · 6 workspaces", "store", fs=15)
    d.box("sample", 500, 740, 460, 60, "stratified labelling sample · 3,600 (600 test / 3,000 train)", "llm", fs=15)
    d.chain(["clean", "pii", "lang", "exact"])
    d.arrow("exact", "mh")
    d.chain(["mh", "band", "verify", "cap"])
    d.arrow("cap", "silver")
    d.arrow("silver", "sample", sides="rl")
    d.note(1010, 0, 330, "Why banding instead of\napproxSimilarityJoin?\nTemplated support tweets made\nthe LSH self-join quadratic.\nGrouping by band key keeps it\nlinear; pairs are verified exactly.")
    d.note(1010, 200, 330, "Every stage runs inside runlog.stage():\nrows in / out, duration, metrics and\ndata-quality checks → data/runs/stages.json\n→ the live pipeline DAG in the UI.")
    d.note(1010, 370, 330, "Silver checks\nno_empty_text\nevery_workspace_present\nno_raw_emails_left")
    d.note(1010, 520, 330, "Drop-off\n287,854 bronze\n→ English & ≥ 3 words\n→ exact dedup → near dedup\n→ 208,593 silver")
    return d


# =====================================================================================================================
def ml_pipeline() -> Diagram:
    d = Diagram("03-low-level-ml-distillation-and-themes", "Low-level · ML: LLM-teacher distillation & theme discovery",
                "ml/labeling (Groq) → ml/kaggle/enrich.py (Kaggle T4 GPU) → ml/themes/name_themes.py")
    d.zone(-20, 0, 560, 520, "A · Teacher labelling (Groq)", "llm")
    d.box("sample", 0, 60, 240, 70, "3,600 stratified items\n(silver sample)", "store")
    d.box("prompt", 280, 60, 240, 100, "batched JSON prompt\n25 items / call\nreasoning_effort = low\ntemperature 0", "white", fs=14)
    d.box("t120", 0, 200, 240, 80, "gpt-oss-120b\ntest 600 + train 900", "llm")
    d.box("t20", 280, 200, 240, 80, "gpt-oss-20b\ntrain 2,100", "llm")
    d.box("labels", 0, 330, 520, 70, "3,586 labels: sentiment · intent (6) · urgency (4)\naspects: 14 × {none, neg, neu, pos}", "store", fs=14)
    d.box("cache", 0, 430, 520, 60, "client: on-disk response cache · model fallback on daily cap · 429 back-off", "white", fs=13)
    d.arrow("sample", "prompt", sides="rl")
    d.arrow("prompt", "t120", sides="bt")
    d.arrow("prompt", "t20")
    d.arrow("t120", "labels")
    d.arrow("t20", "labels")

    d.zone(570, 0, 620, 520, "B · Student training & inference (Kaggle T4)", "ml")
    d.box("push", 590, 60, 270, 70, "run_kaggle.py\npush dataset + kernel (private)", "white", fs=14)
    d.box("bert", 590, 170, 270, 110, "ModernBERT-base encoder\nmax_len 128 · mean pooling\nfp16 · OneCycleLR · 4 epochs", "ml", fs=14)
    d.box("heads", 900, 150, 270, 150, "multi-task heads\nsentiment (3)\nintent (6)\nurgency (4)\naspect 14 × 4 (weighted CE)", "ml", fs=14)
    d.box("infer", 590, 330, 270, 80, "predict all 208k items\n521 items / s", "ml")
    d.box("tfidf", 900, 330, 270, 80, "baseline\nTF-IDF + LogReg", "eval", dashed=True)
    d.box("semeval", 900, 430, 270, 70, "same architecture on\nSemEval-2014 → F1 0.849", "eval", dashed=True)
    d.box("enriched", 590, 430, 270, 70, "enriched.parquet\n(labels + confidences)", "store")
    d.arrow("labels", "push", "labels", sides="rl")
    d.arrow("push", "bert")
    d.arrow("bert", "heads", sides="rl")
    d.arrow("bert", "infer")
    d.arrow("infer", "enriched")
    d.arrow("heads", "tfidf", "compare", dashed=True)

    d.zone(-20, 560, 1210, 330, "C · Embeddings & theme discovery (per workspace)", "intel")
    d.box("bge", 0, 620, 220, 80, "bge-small-en-v1.5\n384-d embeddings", "intel")
    d.box("umap5", 250, 620, 220, 80, "UMAP → 5-d\ncosine · n_neighbors 15", "intel")
    d.box("hdb", 500, 620, 220, 80, "HDBSCAN (eom)\nmin_samples 10", "intel")
    d.box("noise", 750, 620, 200, 80, "noise reassignment\ncosine ≥ 0.8", "intel")
    d.box("ctfidf", 980, 620, 190, 80, "c-TF-IDF\nkeywords", "intel")
    d.box("umap3", 0, 760, 220, 80, "UMAP → 3-d\ngalaxy view sample", "serve")
    d.box("name", 500, 760, 220, 90, "LLM names each theme\n4 examples + 6 keywords\n→ L1 aspect → L2 theme", "llm", fs=14)
    d.box("npmi", 750, 760, 200, 90, "NPMI coherence\n(inverted index)\n= 0.11", "eval", fs=14)
    d.box("themes", 980, 760, 190, 90, "themes.parquet\n291 themes", "store")
    d.chain(["bge", "umap5", "hdb", "noise", "ctfidf"])
    d.arrow("bge", "umap3")
    d.arrow("ctfidf", "name", sides="bt", bend=0.5)
    d.arrow("name", "npmi", sides="rl")
    d.arrow("npmi", "themes", sides="rl")
    d.note(1210, 0, 330, "Why distil?\nAn LLM per item is slow and costly.\nThe LLM labels 3.6k items once;\nthe student labels the remaining 205k.\n\nMeasured trade-off: zero-shot LLM\nwins on intent/urgency, the student\nwins on cost and throughput.")
    d.note(1210, 240, 330, "Student vs TF-IDF (macro-F1)\nsentiment 0.817 vs 0.696\nintent       0.624 vs 0.582\nurgency      0.497 vs 0.439\naspect joint 0.558 vs 0.471")
    d.note(1210, 560, 330, "Two-level taxonomy\nL1: 14 fixed aspects (supervised,\ncomparable across workspaces)\nL2: discovered themes (unsupervised,\nspecific to each product)")
    return d


# =====================================================================================================================
def trends() -> Diagram:
    d = Diagram("04-low-level-trend-and-emerging-issue-detection", "Low-level · analytics, trend & emerging-issue detection",
                "pipeline/spark_jobs/gold.py + trends.py — Spark window functions over the enriched feedback")
    d.box("enr", 0, 40, 240, 70, "enriched feedback\n+ theme assignments", "store")
    d.box("trim", 0, 150, 240, 80, "trim sparse leading tail\n(dates < 0.5th percentile\nper workspace)", "spark", fs=14)
    d.box("daily", 0, 270, 240, 80, "daily negative count\nper (workspace, theme)", "spark")
    d.box("dens", 0, 390, 240, 70, "densify: fill missing\ndays with 0", "spark")
    d.chain(["enr", "trim", "daily", "dens"])

    d.zone(280, 20, 560, 470, "Spike detector (Poisson z-score)", "eval")
    d.box("base", 300, 80, 240, 90, "expected = mean of the\ntrailing 14 days\n(window excludes today)", "white", fs=14)
    d.box("z", 580, 80, 240, 90, "z = (obs − exp) / sqrt(exp + 1)", "white", fs=15)
    d.box("rule", 300, 220, 520, 70, "flag a day when  z ≥ 4  AND  count ≥ 5  AND  ≥ 7 days of history", "eval", fs=15)
    d.box("inc", 300, 330, 240, 120, "merge consecutive\nflagged days → incident\nstart · peak · observed\n· baseline · score", "white", fs=14)
    d.box("sev", 580, 330, 240, 120, "severity by peak z\ncritical ≥ 12\nhigh ≥ 8\nmedium ≥ 6 · else low", "white", fs=14)
    d.arrow("dens", "base", sides="rl")
    d.arrow("base", "z")
    d.arrow("z", "rule")
    d.arrow("rule", "inc", sides="bt", bend=0.5)
    d.arrow("inc", "sev")

    d.zone(870, 20, 330, 470, "Emerging-theme detector", "intel")
    d.box("emg", 890, 80, 290, 120, "≥ 50 % of a theme's volume\nfalls in the last 20 %\nof the timeline\nAND count ≥ 40", "intel", fs=14)
    d.box("alerts", 890, 330, 290, 120, "gold/alerts\n164 alerts\n(spike + emerging_theme)", "store")
    d.arrow("sev", "alerts", sides="rl")
    d.arrow("emg", "alerts")

    d.box("other", 0, 530, 840, 70, "other gold tables: daily_sentiment · daily_theme · aspect_sentiment · theme_stats (delta %, newness) · theme_series · graph_edges", "store", fs=14)
    d.box("explain", 890, 530, 290, 70, "LLM explains top alerts\nwith [#id] citations", "llm", fs=14)
    d.arrow("alerts", "explain")

    d.zone(-20, 640, 1220, 260, "Evaluation: synthetic incident injection (eval/trend_injection.py, Spark)", "eval")
    d.box("sim", 0, 700, 260, 100, "60 Poisson series at real\ntheme rates\n± 20 % weekly seasonality", "white", fs=14)
    d.box("inj", 290, 700, 260, 100, "inject incidents into half\nsize 1.5× · 2× · 3× · 5×\nlength 2 · 3 · 5 days", "white", fs=14)
    d.box("cmp", 580, 700, 260, 100, "run detector vs naive\n2×-mean rule", "white", fs=14)
    d.box("res", 870, 700, 310, 160, "recall 0.667 (naive 0.633)\nfalse alerts 0.1 % of theme-days\n\nrecall by size\n1.5× 0.10 · 2× 0.83 · 3×+ 1.00", "eval", fs=14)
    d.chain(["sim", "inj", "cmp", "res"])
    d.note(1220, 20, 300, "Why not an ML anomaly model?\nDaily theme counts are small\nand sparse. A count model with\na trailing baseline is\nexplainable to a PM and is\ntested against incidents with\nknown start dates.")
    d.note(1220, 260, 300, "Real incidents found unsupervised\nSpotify outage · 8 Mar 2022\nJoe Rogan controversy · 27 Jan 2022\niOS 11.1 autocorrect · 2–3 Nov 2017\niPhone X pre-orders · 27 Oct 2017\niOS 11.1.2 restarts · 2 Dec 2017")
    return d


# =====================================================================================================================
def analyst() -> Diagram:
    d = Diagram("05-low-level-retrieval-and-ai-analyst", "Low-level · hybrid retrieval & grounded AI analyst",
                "retrieval/search.py · analyst/agent.py · analyst/llm.py — POST /api/analyst/ask (Server-Sent Events)")
    d.zone(-20, 0, 620, 560, "Hybrid retrieval", "intel")
    d.box("q", 0, 60, 260, 60, "query + workspace", "user")
    d.box("bm25", 0, 170, 260, 80, "BM25 (bm25s)\nlexical top-k", "intel")
    d.box("dense", 300, 170, 270, 80, "dense: bge-small query vector\ncosine over numpy matrix", "intel")
    d.box("rrf", 0, 300, 570, 60, "reciprocal-rank fusion  ·  score = Σ 1 / (60 + rank)", "intel", fs=15)
    d.box("rr", 0, 400, 570, 60, "cross-encoder rerank · ms-marco-MiniLM-L-6-v2 (fastembed)", "intel", fs=15)
    d.box("hits", 0, 490, 570, 50, "top-k feedback with ids  rv_* · tk_* · sv_*", "store", fs=14)
    d.arrow("q", "bm25")
    d.arrow("q", "dense", sides="rt")
    d.arrow("bm25", "rrf")
    d.arrow("dense", "rrf", sides="bt")
    d.arrow("rrf", "rr")
    d.arrow("rr", "hits")

    d.zone(620, 0, 860, 560, "Tool-using agent loop (Groq)", "llm")
    d.box("ask", 640, 60, 240, 60, "user question", "user")
    d.box("llm", 640, 170, 240, 90, "gpt-oss-120b\nsystem prompt: cite as [#id]\nmax 900 tokens", "llm", fs=14)
    d.box("tools", 940, 140, 520, 150,
          "5 tools (JSON schema, nullable optional args)\nsearch_feedback → hybrid retrieval\ntheme_stats · theme_trend → DuckDB gold tables\nlist_alerts · theme_evidence", "white", fs=14)
    d.box("draft", 640, 330, 240, 80, "draft answer\nwith [#id] citations", "llm")
    d.box("norm", 940, 330, 240, 80, "normalize_citations\n→ [#id]; drop ids no\ntool returned", "eval", fs=14)
    d.box("claims", 1220, 330, 240, 80, "claim units\n(bullet + nested lines)", "white", fs=14)
    d.box("judge", 1220, 450, 240, 90, "LLM judge per claim\nsupported? vs cited text\n+ tool stats", "eval", fs=14)
    d.box("ground", 640, 460, 520, 70, "final event: answer + citations + groundedness score", "store", fs=15)
    d.arrow("ask", "llm")
    d.arrow("llm", "tools", sides="rl")
    d.arrow("tools", "draft", "results", sides="bt", bend=0.5)
    d.arrow("draft", "norm")
    d.arrow("norm", "claims")
    d.arrow("claims", "judge")
    d.arrow("judge", "ground", sides="lr")
    d.arrow("tools", "q", "search_feedback → hybrid retrieval", sides="tt", dashed=True, loop=60)
    d.note(-20, 590, 620, "Retrieval eval (150 LLM-generated queries, 1 known answer each)\nhybrid + rerank  Recall@10 0.493 · MRR 0.335\ndense only        Recall@10 0.467 · MRR 0.326")
    d.note(620, 590, 860, "SSE events streamed to the UI: status → tool (name + args) → token → final (or error)\n"
                          "LLM client: response cache · fallback chain gpt-oss-120b → qwen3.8-27b → gpt-oss-20b on daily caps\n"
                          "Groundedness over 96 generated artifacts: 0.686 (pre-registered target 0.80 — reported as missed)")
    return d


# =====================================================================================================================
def serving() -> Diagram:
    d = Diagram("06-low-level-serving-api-and-frontend", "Low-level · serving, API & frontend",
                "No database server: DuckDB queries Parquet in memory; the frontend shares one typed contract (docs/api-contract.ts)")
    d.zone(-20, 0, 330, 540, "Data on disk (D:)", "store")
    d.box("gold", 0, 60, 290, 90, "data/lake/gold/*.parquet\nfeedback · daily_* · theme_*\nalerts · graph_edges", "store", fs=14)
    d.box("sj", 0, 190, 290, 90, "data/serving/*.json\ngraph_<ws> · galaxy_<ws>\ninsights · pipeline · eval", "store", fs=14)
    d.box("idx", 0, 320, 290, 90, "retrieval index\nBM25 + embeddings.npy", "store", fs=14)
    d.box("cache", 0, 450, 290, 70, "data/llm_cache\n(reproducible LLM output)", "store", fs=14)

    d.zone(330, 0, 620, 540, "FastAPI (api/main.py) · uvicorn :8000", "serve")
    d.box("duck", 350, 60, 220, 90, "DuckDB in-memory\nviews over Parquet\ncursor per request", "serve", fs=14)
    d.box("srv", 350, 190, 220, 90, "serving() loader\nJSON artifacts", "serve", fs=14)
    d.box("agent", 350, 320, 220, 90, "analyst agent\n+ hybrid retrieval\n(see diagram 05)", "llm", fs=14)
    d.box("routes", 600, 60, 330, 450,
          "GET  /api/workspaces\nGET  /api/overview\nGET  /api/themes\nGET  /api/themes/{id}\nGET  /api/graph\nGET  /api/galaxy\n"
          "GET  /api/alerts\nGET  /api/insights\nGET  /api/feedback  (hybrid search)\nGET  /api/pipeline\nGET  /api/eval\nGET  /api/health\n\n"
          "POST /api/analyst/ask\n→ text/event-stream (SSE)", "white", fs=15)
    d.arrow("gold", "duck")
    d.arrow("sj", "srv")
    d.arrow("idx", "agent")
    d.arrow("cache", "agent", sides="rb", dashed=True)
    d.arrow("duck", "routes", sides="rl")
    d.arrow("srv", "routes", sides="rl")
    d.arrow("agent", "routes", sides="rl")

    d.zone(970, 0, 600, 540, "Next.js 15 dashboard · :3000", "serve")
    d.box("q", 990, 60, 260, 90, "TanStack Query\ntyped client (lib/api.ts)\nmock fallback w/o API", "serve", fs=14)
    d.box("z", 1280, 60, 270, 90, "Zustand store\nworkspace · date range", "serve", fs=14)
    d.box("pages", 990, 190, 560, 150,
          "Overview — KPIs · sentiment trend · theme river · calendar\nPipeline — React Flow live DAG\nKnowledge graph — Sigma.js WebGL · Louvain · PageRank\n"
          "Galaxy — React Three Fiber 3D UMAP\nThemes · Alerts · Analyst (SSE) · Explorer · Evaluation", "white", fs=14)
    d.box("ui", 990, 370, 560, 60, "Tailwind v4 · Radix/shadcn primitives · ECharts · GSAP motion", "serve", fs=14)
    d.box("pm", 1150, 455, 240, 65, "PM / analyst", "user", shape="ellipse")
    d.arrow("routes", "q", "JSON / SSE", sides="rl", bend=0.5)
    d.arrow("q", "pages")
    d.arrow("z", "pages")
    d.arrow("pages", "ui")
    d.arrow("ui", "pm")

    d.zone(-20, 580, 1590, 230, "Deployment (docker-compose.yml)", "note")
    d.box("capi", 0, 640, 320, 80, "api service\ninfra/api.Dockerfile · :8000\nenv_file .env (GROQ_API_KEY)", "serve", fs=14)
    d.box("cweb", 360, 640, 320, 80, "web service\ninfra/web.Dockerfile · :3000\ndepends_on api", "serve", fs=14)
    d.box("cspark", 720, 640, 320, 80, "spark image (profile: batch)\napache/spark:4.0.1-python3\n+ pyarrow · pandas", "spark", fs=14)
    d.box("kag", 1080, 640, 470, 80, "Kaggle kernel (T4 GPU)\nprivate dataset echolens-inputs → enrich.py", "ml", fs=14)
    d.arrow("cweb", "capi", sides="lr")
    d.note(0, 740, 1550, "Prebuilt data → `docker compose up --build` → http://localhost:3000 (API docs at :8000/docs). Tests: pytest = unit + API contract + metric regression gate.")
    return d


# =====================================================================================================================
def workflow() -> Diagram:
    d = Diagram("07-workflow-orchestration", "Workflow · end-to-end orchestration (python -m pipeline.cli all)",
                "Each step is idempotent and writes its stage record (rows in/out, duration, checks) to data/runs/stages.json")
    steps = [
        ("ingest", "1 · ingest\nbronze + silver\n[Docker · Spark]", "spark", "lake", "data/lake\nbronze · silver"),
        ("label", "2 · label\nteacher labels\n[Groq API]", "llm", "labels", "data/labels\n*.jsonl"),
        ("kaggle", "3 · kaggle\nstudent · embeddings\n[Kaggle T4 GPU]", "ml", "kout", "data/kaggle_out\nenriched.parquet"),
        ("themes", "4 · themes\nc-TF-IDF + naming\n[local + Groq]", "llm", "th", "data/lake/themes\nthemes.parquet"),
        ("gold", "5 · gold\nalerts · aggregates\n[Docker · Spark]", "spark", "gl", "data/lake/gold\n*.parquet"),
        ("serving", "6 · serving\ngraph · insights\n[local + Groq]", "intel", "serv", "data/serving\n*.json"),
        ("eval", "7 · eval\ninjection + report\n[Spark + local]", "eval", "evj", "docs/EVALUATION.md\neval.json"),
    ]
    d.box("raw", -250, 40, 200, 100, "data/raw\nKaggle CSVs\n(reviews, tweets,\nSemEval)", "store", fs=14)
    x = 0
    for k, t, kind, sk, st in steps:
        d.box(k, x, 40, 200, 100, t, kind, fs=14)
        d.box(sk, x, 200, 200, 70, st, "store", fs=14)
        d.arrow(k, sk)
        x += 230
    d.arrow("raw", "ingest")
    d.chain([s[0] for s in steps])

    d.zone(-20, 320, 1630, 260, "Kaggle round trip (ml/kaggle/run_kaggle.py)", "ml")
    ks = [("prep", "prepare\nsilver + labels → upload dir"), ("push", "push\nprivate dataset + kernel"),
          ("wait", "wait\npoll kernel status"), ("dl", "download\noutputs"),
          ("normts", "normalise\nns → µs timestamps\n(Spark-readable)"), ("rec", "record\nnlp · absa · embed_cluster\nstages")]
    x = 0
    for k, t in ks:
        d.box(k, x, 380, 245, 90, t, "white", fs=14)
        x += 270
    d.chain([k for k, *_ in ks])
    d.note(0, 500, 1590, "Keys stay out of git (.env, Kaggle token under D:/.config). All caches, Docker data and Spark temp live on D: — nothing large on C:.")

    d.zone(-20, 620, 1630, 180, "Quality gates", "eval")
    d.box("checks", 0, 680, 380, 90, "per-stage data-quality checks\n(shown as pass/fail in the DAG)", "eval", fs=14)
    d.box("thr", 405, 680, 380, 90, "eval/thresholds.json\nregression floors per metric", "eval", fs=14)
    d.box("pytest", 810, 680, 380, 90, "pytest\nunit · API contract · regression", "eval", fs=14)
    d.box("ui", 1215, 680, 375, 90, "dashboard Pipeline + Evaluation\nviews read the same records", "serve", fs=14)
    d.chain(["checks", "thr", "pytest", "ui"])
    return d


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    for fn in (high_level, spark_pipeline, ml_pipeline, trends, analyst, serving, workflow):
        p = fn().save(OUT)
        print("wrote", p.name)
