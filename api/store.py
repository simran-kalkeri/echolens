"""Read-side data access: DuckDB over the gold Parquet tables + precomputed serving JSON."""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

import duckdb
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
GOLD = ROOT / "data" / "lake" / "gold"
SERVING = ROOT / "data" / "serving"

ASPECT_LABELS = {
    "performance_reliability": "Performance & Reliability", "bugs_errors": "Bugs & Errors", "ui_ux": "UI / UX",
    "pricing_billing": "Pricing & Billing", "account_access": "Account & Access", "customer_service": "Customer Service",
    "delivery_logistics": "Delivery & Logistics", "ads": "Ads", "content_catalog": "Content & Catalog",
    "connectivity_devices": "Connectivity & Devices", "features": "Features", "privacy_security": "Privacy & Security",
    "updates": "Updates", "other": "Other",
}
WS_NAMES = {"spotify": "Spotify", "apple": "Apple", "amazon": "Amazon", "uber": "Uber", "delta": "Delta Air Lines", "xbox": "Xbox"}


@lru_cache(maxsize=1)
def con() -> duckdb.DuckDBPyConnection:
    settings = {}
    if os.getenv("DUCKDB_MEMORY_LIMIT"):
        settings["memory_limit"] = os.environ["DUCKDB_MEMORY_LIMIT"]
    if os.getenv("DUCKDB_THREADS"):
        settings["threads"] = int(os.environ["DUCKDB_THREADS"])
    c = duckdb.connect(config=settings)
    low_memory = os.getenv("ECHOLENS_LOW_MEMORY") == "true"
    kind = "VIEW" if low_memory else "TABLE"
    p = lambda t: str(GOLD / t).replace("\\", "/")
    c.execute(f"CREATE {kind} feedback AS SELECT * FROM read_parquet('{p('feedback')}/*/*.parquet', hive_partitioning=1)")
    if not low_memory:
        c.execute("CREATE INDEX idx_fb ON feedback(feedback_id)")
    for t in ["daily_sentiment", "daily_theme", "aspect_sentiment", "theme_stats", "theme_series", "alerts", "graph_edges"]:
        c.execute(f"CREATE {kind} {t} AS SELECT * FROM read_parquet('{p(t)}/*.parquet')")
    themes = str(ROOT / "data" / "lake" / "themes" / "themes.parquet").replace("\\", "/")
    c.execute(f"CREATE {kind} themes AS SELECT * FROM read_parquet('{themes}')")
    return c


def q(sql: str, *params) -> pd.DataFrame:
    # one cursor per call: FastAPI runs sync handlers in a thread pool and a DuckDB connection is not re-entrant
    cur = con().cursor()
    try:
        return cur.execute(sql, list(params)).df()
    finally:
        cur.close()


def serving(name: str, default=None):
    f = SERVING / f"{name}.json"
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else default


FB_COLS = "feedback_id, workspace, source, text, created_at, rating, sentiment, sentiment_score, intent, urgency, aspects, theme_id, theme_name"


def to_feedback(r) -> dict:
    asp = r["aspects"]
    if asp is None or (hasattr(asp, "__len__") and len(asp) == 0):
        asp = []
    return {
        "id": r["feedback_id"], "ws": r["workspace"], "source": r["source"], "text": r["text"],
        "created_at": pd.Timestamp(r["created_at"]).isoformat(),
        "rating": None if pd.isna(r["rating"]) else int(r["rating"]),
        "sentiment": r["sentiment"], "sentiment_score": float(r["sentiment_score"]),
        "intent": r["intent"], "urgency": r["urgency"],
        "aspects": [{"aspect": a["aspect"], "sentiment": a["sentiment"]} for a in asp],
        "theme_id": r["theme_id"], "theme_name": r["theme_name"],
    }


def feedback_by_ids(ids: list[str]) -> list[dict]:
    if not ids:
        return []
    df = q(f"SELECT {FB_COLS} FROM feedback WHERE feedback_id IN (SELECT unnest(?))", ids)
    by = {r["feedback_id"]: to_feedback(r) for _, r in df.iterrows()}
    return [by[i] for i in ids if i in by]
