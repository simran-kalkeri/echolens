"""Hybrid semantic retrieval over feedback.

dense  : bge-small-en-v1.5 embeddings (computed on Kaggle GPU), brute-force cosine in numpy (<= ~60k/workspace)
sparse : BM25 (bm25s)
fusion : reciprocal-rank fusion (RRF, k=60)
rerank : cross-encoder ms-marco-MiniLM-L-6-v2 over the fused top-N
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault("FASTEMBED_CACHE_PATH", str(ROOT / ".cache" / "fastembed"))
KOUT = ROOT / "data" / "kaggle_out"
INDEX = ROOT / "data" / "index"
GOLD_FB = ROOT / "data" / "lake" / "gold" / "feedback"
METHODS = ("bm25", "dense", "hybrid", "hybrid_rerank")


@lru_cache(maxsize=1)
def _corpus():
    ids = pd.read_parquet(KOUT / "embedding_ids.parquet").feedback_id.values
    emb = np.load(KOUT / "embeddings.npy").astype(np.float32)
    meta = pd.read_parquet(KOUT / "enriched.parquet", columns=["feedback_id", "workspace", "text"])
    assert (meta.feedback_id.values == ids).all()
    return ids, emb, meta


def _shard(ws: str):
    """Per-workspace shard from retrieval/build_index.py (what a git checkout ships with)."""
    z = np.load(INDEX / f"{ws}.npz")
    ids, emb = np.array(z["ids"].tolist(), dtype=object), z["emb"].astype(np.float32)
    txt = pd.read_parquet(GOLD_FB, columns=["feedback_id", "text"], filters=[("workspace", "==", ws)])
    text_of = dict(zip(txt.feedback_id, txt.text))
    keep = np.array([i in text_of for i in ids])
    ids, emb = ids[keep], emb[keep]
    return ids, emb, [text_of[i] for i in ids]


@lru_cache(maxsize=16)
def _ws_index(ws: str):
    import bm25s

    if (INDEX / f"{ws}.npz").exists():
        ids, emb, texts = _shard(ws)
    else:                                   # full pipeline run: read the Kaggle outputs directly
        all_ids, all_emb, meta = _corpus()
        mask = (meta.workspace == ws).values
        ids, emb, texts = all_ids[mask], all_emb[mask], meta.text.values[mask].tolist()
    retr = bm25s.BM25()
    retr.index(bm25s.tokenize(texts, stopwords="en", show_progress=False), show_progress=False)
    return ids, emb, texts, retr


@lru_cache(maxsize=1)
def _embedder():
    from fastembed import TextEmbedding
    return TextEmbedding("BAAI/bge-small-en-v1.5")


@lru_cache(maxsize=1)
def _reranker():
    from fastembed.rerank.cross_encoder import TextCrossEncoder
    return TextCrossEncoder("Xenova/ms-marco-MiniLM-L-6-v2")


def embed_query(q: str) -> np.ndarray:
    # bge recommends this instruction prefix for short queries -> passages
    v = next(iter(_embedder().embed(["Represent this sentence for searching relevant passages: " + q])))
    return v / np.linalg.norm(v)


def _dense(ws, q, k):
    ids, emb, _, _ = _ws_index(ws)
    sims = emb @ embed_query(q)
    top = np.argpartition(-sims, min(k, len(sims) - 1))[:k]
    return list(top[np.argsort(-sims[top])])


def _bm25(ws, q, k):
    import bm25s
    _, _, texts, retr = _ws_index(ws)
    res, _ = retr.retrieve(bm25s.tokenize([q], stopwords="en", show_progress=False), k=min(k, len(texts)), show_progress=False)
    return list(res[0])


def search(ws: str, q: str, k: int = 20, method: str = "hybrid_rerank", pool: int = 60) -> list[tuple[str, float]]:
    """Returns [(feedback_id, score)] best first."""
    ids, _, texts, _ = _ws_index(ws)
    if method == "dense":
        return [(ids[i], 1.0 / (r + 1)) for r, i in enumerate(_dense(ws, q, k))]
    if method == "bm25":
        return [(ids[i], 1.0 / (r + 1)) for r, i in enumerate(_bm25(ws, q, k))]
    fused: dict[int, float] = {}
    for lst in (_dense(ws, q, pool), _bm25(ws, q, pool)):
        for r, i in enumerate(lst):
            fused[i] = fused.get(i, 0.0) + 1.0 / (60 + r + 1)
    order = sorted(fused, key=fused.get, reverse=True)
    if method == "hybrid":
        return [(ids[i], fused[i]) for i in order[:k]]
    cand = order[:pool]
    scores = list(_reranker().rerank(q, [texts[i] for i in cand]))
    best = np.argsort(-np.array(scores))[:k]
    return [(ids[cand[j]], float(scores[j])) for j in best]
