"""LLM teacher labelling (Groq).

Labels a stratified sample of silver feedback with sentiment, intent, urgency and aspect-level sentiment.
These labels train the small student model on Kaggle GPU (distillation), so bulk inference over the
full corpus costs ~nothing while matching the teacher closely.

Usage:  python -m ml.labeling.label_with_groq [--model MODEL] [--limit N]
Resumable: already-labelled ids in the output file are skipped.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import time
from pathlib import Path

import httpx
import pandas as pd
from dotenv import load_dotenv

from pipeline.common.runlog import ROOT

load_dotenv(ROOT / ".env")
LABEL_DIR = ROOT / "data" / "labels"
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

ASPECTS = {
    "performance_reliability": "speed, lag, outages, app not loading, downtime",
    "bugs_errors": "crashes, error messages, broken behaviour, glitches",
    "ui_ux": "design, layout, navigation, usability, annoying pop-ups",
    "pricing_billing": "price, subscription, charges, refunds, payments",
    "account_access": "login, password, account locked/hacked, verification",
    "customer_service": "support agents, response time, help quality",
    "delivery_logistics": "shipping, delivery, packages, flights/rides delays, baggage",
    "ads": "advertisements, ad frequency",
    "content_catalog": "songs/podcasts/products/catalog availability, recommendations, shuffle, playlists",
    "connectivity_devices": "bluetooth, car, speakers, devices, offline, network, sync",
    "features": "existing feature behaviour or missing features",
    "privacy_security": "privacy, data, security, scams",
    "updates": "app/OS updates, new versions changing things",
    "other": "anything else",
}
INTENTS = ["complaint", "bug_report", "feature_request", "question", "praise", "churn_risk"]
URGENCY = ["low", "medium", "high", "critical"]

SYSTEM = f"""You are an expert customer-feedback analyst. Label each feedback item.
Return JSON: {{"items":[{{"i":<index>,"sentiment":"positive|neutral|negative","intent":"<intent>","urgency":"<urgency>","aspects":[{{"a":"<aspect_id>","s":"positive|neutral|negative"}}]}}]}}

intent (pick the dominant one): {", ".join(INTENTS)}
- churn_risk: explicitly threatens to cancel, switch to a competitor or stop using.
- bug_report: describes something broken/malfunctioning. complaint: dissatisfaction without a concrete defect.
urgency:
- critical: service unusable/outage, money lost or charged wrongly, security/account compromise, safety.
- high: core function blocked, repeated failure, strong churn threat.
- medium: degraded experience, bug with workaround, unanswered support.
- low: praise, mild suggestions, general questions.
aspects (1-3 most relevant, each with its own sentiment): {json.dumps(ASPECTS)}
Use only the ids above. Output JSON only."""


def call_groq(client: httpx.Client, model: str, batch: list[dict]) -> list[dict]:
    user = "\n".join(f"[{k}] {b['text'][:600]}" for k, b in enumerate(batch))
    body = {
        "model": model,
        "temperature": 0,
        "reasoning_effort": "low",
        "max_tokens": 4000,
        "response_format": {"type": "json_object"},
        "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}],
    }
    for attempt in range(8):
        r = client.post(GROQ_URL, json=body)
        if r.status_code == 429 or r.status_code >= 500:
            wait = float(r.headers.get("retry-after", 2 ** attempt))
            print(f"  rate limited/server error {r.status_code}; sleeping {wait:.0f}s", flush=True)
            time.sleep(min(wait, 120))
            continue
        r.raise_for_status()
        content = r.json()["choices"][0]["message"]["content"]
        items = json.loads(content)["items"]
        out = []
        for it in items:
            k = int(it["i"])
            if not 0 <= k < len(batch):
                continue
            aspects = [a for a in it.get("aspects", []) if a.get("a") in ASPECTS and a.get("s") in ("positive", "neutral", "negative")]
            if it.get("sentiment") not in ("positive", "neutral", "negative") or it.get("intent") not in INTENTS or it.get("urgency") not in URGENCY:
                continue
            out.append({**batch[k], "sentiment": it["sentiment"], "intent": it["intent"], "urgency": it["urgency"],
                        "aspects": aspects or [{"a": "other", "s": it["sentiment"]}], "teacher": model})
        return out
    raise RuntimeError("Groq: too many retries")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=os.getenv("GROQ_TEACHER_MODEL", "openai/gpt-oss-120b"))
    ap.add_argument("--start", type=int, default=0, help="slice of the shuffled sample to label")
    ap.add_argument("--end", type=int, default=3600)
    ap.add_argument("--split", default="train", choices=["train", "test"])
    ap.add_argument("--batch", type=int, default=25)
    args = ap.parse_args()

    key = os.getenv("GROQ_API_KEY")
    if not key:
        raise SystemExit("GROQ_API_KEY missing in .env")
    df = pd.read_parquet(ROOT / "data" / "lake" / "silver" / "label_sample")
    rows = df[["feedback_id", "workspace", "source", "text", "rating"]].to_dict("records")
    random.Random(0).shuffle(rows)
    rows = rows[args.start : args.end]
    OUT = LABEL_DIR / f"teacher_{args.model.split('/')[-1]}_{args.split}.jsonl"
    OUT.parent.mkdir(parents=True, exist_ok=True)
    done = set()
    if OUT.exists():
        done = {json.loads(l)["feedback_id"] for l in OUT.read_text(encoding="utf-8").splitlines() if l.strip()}
    todo = [r for r in rows if r["feedback_id"] not in done]
    print(f"{len(done)} already labelled, {len(todo)} to go with {args.model}", flush=True)

    t0, n_ok = time.time(), 0
    with httpx.Client(headers={"Authorization": f"Bearer {key}"}, timeout=120) as client, OUT.open("a", encoding="utf-8") as f:
        for s in range(0, len(todo), args.batch):
            batch = [{**r, "rating": None if pd.isna(r["rating"]) else int(r["rating"])} for r in todo[s : s + args.batch]]
            try:
                labelled = call_groq(client, args.model, batch)
            except (json.JSONDecodeError, KeyError, httpx.HTTPStatusError) as e:
                print(f"  batch {s} failed: {e}", flush=True)
                continue
            for item in labelled:
                item["split"] = args.split
                f.write(json.dumps(item, ensure_ascii=False) + "\n")
            f.flush()
            n_ok += len(labelled)
            if (s // args.batch) % 10 == 0:
                print(f"  {s + len(batch)}/{len(todo)} labelled={n_ok} {time.time() - t0:.0f}s", flush=True)
    print(f"done: {n_ok} new labels in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
