"""Generate a SYNTHETIC NPS-survey channel for the Spotify workspace (clearly labelled synthetic).

Public datasets have no survey verbatims for the same product, so we simulate them with an LLM, conditioned on
an NPS score and month. Output: data/raw/surveys/spotify_nps_synthetic.csv (ingested by the Spark bronze job).
"""
from __future__ import annotations

import csv
import json
import random
from datetime import datetime, timedelta

from analyst.llm import chat_json
from pipeline.common.runlog import ROOT

OUT = ROOT / "data" / "raw" / "surveys" / "spotify_nps_synthetic.csv"
MODEL = "qwen/qwen3.8-27b"
PROMPT = """Write realistic answers to the Spotify NPS survey question "What is the main reason for your score?".
Each item has an NPS score 0-10. Vary length (5-60 words), tone, writing quality and topics (music catalog, playlists,
recommendations, shuffle, ads, price, family plan, podcasts, offline downloads, app bugs, car/bluetooth, audio quality,
UI changes, lyrics, student discount, customer support). Detractors (0-6) complain, passives (7-8) are mixed, promoters praise.
Do not mention you are an AI. Return JSON {"items":[{"i":<index>,"text":"..."}]}"""


def main(n=225, batch=25):  # 225 kept: qwen generation stalled under the 8k TPM limit
    rng = random.Random(11)
    scores = rng.choices(range(11), weights=[6, 3, 4, 4, 5, 7, 8, 12, 14, 16, 21], k=n)
    start = datetime(2022, 1, 1)
    rows = []
    for s in range(0, n, batch):
        b = scores[s : s + batch]
        res = chat_json(PROMPT, json.dumps([{"i": k, "score": sc} for k, sc in enumerate(b)]), model=MODEL, max_tokens=4000)
        for it in res.get("items", []):
            try:
                k = int(it["i"])
                ts = start + timedelta(seconds=rng.randint(0, 189 * 86400))
                rows.append({"response_id": f"sv_{s + k}", "submitted_at": ts.strftime("%Y-%m-%d %H:%M:%S"),
                             "nps_score": b[k], "answer": it["text"].strip()})
            except (KeyError, ValueError, IndexError, AttributeError):
                pass
        print(f"{len(rows)}/{n}", flush=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["response_id", "submitted_at", "nps_score", "answer"])
        w.writeheader()
        w.writerows(rows)
    print("wrote", len(rows))


if __name__ == "__main__":
    main()
