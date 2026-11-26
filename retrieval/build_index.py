"""Splits the Kaggle embedding matrix into one compact shard per workspace: data/index/<ws>.npz.

Each shard holds only the items that made it into gold (float16, ~35 MB max), so the serving stack
(API + hybrid search) runs from a git checkout without the 160 MB embeddings.npy or the Kaggle outputs.

    python -m retrieval.build_index
"""
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
KOUT = ROOT / "data" / "kaggle_out"
GOLD_FB = ROOT / "data" / "lake" / "gold" / "feedback"
INDEX = ROOT / "data" / "index"


def main() -> None:
    ids = pd.read_parquet(KOUT / "embedding_ids.parquet").feedback_id.values
    emb = np.load(KOUT / "embeddings.npy", mmap_mode="r")
    gold = pd.read_parquet(GOLD_FB, columns=["feedback_id", "workspace"])
    pos = pd.Series(np.arange(len(ids)), index=ids)
    INDEX.mkdir(parents=True, exist_ok=True)
    for ws, g in gold.groupby("workspace"):
        keep = g.feedback_id[g.feedback_id.isin(pos.index)].values
        rows = pos.loc[keep].values
        np.savez(INDEX / f"{ws}.npz", ids=np.array([str(i) for i in keep], dtype="U"), emb=np.asarray(emb[rows], dtype=np.float16))
        print(f"{ws}: {len(keep):,} vectors -> {(INDEX / f'{ws}.npz').stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
