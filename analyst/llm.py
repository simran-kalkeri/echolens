"""Thin Groq client (OpenAI-compatible) with retries and an on-disk response cache.

The cache makes every offline pipeline step reproducible and lets the demo run without an API key.
"""
from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path
from dataclasses import dataclass

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
URL = "https://api.groq.com/openai/v1/chat/completions"
CACHE = ROOT / "data" / "llm_cache"
MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
FAST_MODEL = os.getenv("GROQ_FAST_MODEL", "openai/gpt-oss-20b")
FALLBACK = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]
EXHAUSTED: set[str] = set()      # models that hit their daily token cap in this process
USAGE = {"prompt_tokens": 0, "completion_tokens": 0, "calls": 0, "cache_hits": 0}


@dataclass
class CallBudget:
    deadline: float
    remaining_calls: int = 6

    def remaining_time(self):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("Analyst deadline reached")
        return remaining

    def take(self):
        timeout = min(20.0, self.remaining_time())
        if self.remaining_calls <= 0:
            raise RuntimeError("Analyst upstream request budget reached")
        self.remaining_calls -= 1
        return timeout


def _key(body: dict) -> str:
    return hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()[:32]


def chat(messages: list[dict], model: str | None = None, max_tokens: int = 1500, temperature: float = 0.0,
         json_mode: bool = False, tools: list | None = None, cache: bool = True, fallbacks: list | None = None,
         budget: CallBudget | None = None) -> dict:
    """Returns the raw assistant message dict (content and/or tool_calls).
    If a model hits its daily token cap, the call falls back to the next model in FALLBACK."""
    if budget:
        budget.remaining_time()
        max_tokens = min(max_tokens, 600)
    model = model or MODEL
    chain = fallbacks if fallbacks is not None else FALLBACK
    if model in EXHAUSTED:
        alive = [m for m in chain if m not in EXHAUSTED]
        if not alive:
            raise RuntimeError("all Groq models hit their daily token cap")
        model = alive[0]
    body = {"model": model, "messages": messages, "max_tokens": max_tokens, "temperature": temperature}
    if body["model"].startswith("openai/gpt-oss"):
        body["reasoning_effort"] = "low"
    elif body["model"].startswith("qwen/"):
        body["reasoning_effort"] = "none"   # no thinking tokens under the 8k TPM limit
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    if tools:
        body["tools"] = tools
        body["tool_choice"] = "auto"
    k = _key(body)
    path = CACHE / f"{k}.json"
    if cache and path.exists():
        USAGE["cache_hits"] += 1
        return json.loads(path.read_text(encoding="utf-8"))
    key = os.getenv("GROQ_API_KEY")
    if not key:
        raise RuntimeError("GROQ_API_KEY is not set and the response is not cached")
    for attempt in range(2 if budget else 40):
        r = httpx.post(URL, json=body, headers={"Authorization": f"Bearer {key}"}, timeout=budget.take() if budget else 120)
        if r.status_code == 429 and "per day" in r.text:
            EXHAUSTED.add(body["model"])
            print(f"[llm] daily cap reached for {body['model']}; falling back", flush=True)
            return chat(messages, body["model"], max_tokens, temperature, json_mode, tools, cache, fallbacks, budget=budget)
        if r.status_code == 429 and "Request too large" in r.text:
            # e.g. qwen's 1000 output-tokens-per-minute cap: a bigger max_tokens can never succeed, so clamp it
            import re as _re
            lim = _re.search(r"Limit (\d+)", r.text)
            body["max_tokens"] = max(256, int(lim.group(1)) - 50) if lim else body["max_tokens"] // 2
            continue
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(min(float(r.headers.get("retry-after", 2 ** min(attempt, 5))) + 1, 2 if budget else 60, budget.remaining_time() if budget else 60))
            continue
        if r.status_code == 400 and tools and "tool_use_failed" in r.text and attempt < 3:
            body["temperature"] = 0.3     # occasional malformed tool call from the model: resample
            continue
        if r.status_code == 400 and "json_validate_failed" in r.text:
            if attempt < 2:      # usually output truncated by max_tokens: retry with more room
                body["max_tokens"] = int(body["max_tokens"] * 1.8)
                continue
            return {"role": "assistant", "content": "{}"}   # degrade gracefully; callers handle empty JSON
        if r.status_code >= 400:
            raise RuntimeError(f"Groq {r.status_code}: {r.text[:500]}")
        data = r.json()
        u = data.get("usage", {})
        USAGE["prompt_tokens"] += u.get("prompt_tokens", 0)
        USAGE["completion_tokens"] += u.get("completion_tokens", 0)
        USAGE["calls"] += 1
        msg = data["choices"][0]["message"]
        msg = {k2: v for k2, v in msg.items() if k2 in ("role", "content", "tool_calls")}
        msg["_model"] = body["model"]            # which model actually answered (fallbacks are reported honestly)
        if cache:
            CACHE.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(msg, ensure_ascii=False), encoding="utf-8")
        return msg
    raise RuntimeError("Groq: too many retries")


def chat_json(system: str, user: str, model: str | None = None, max_tokens: int = 1500, fallbacks: list | None = None, budget: CallBudget | None = None) -> dict:
    msg = chat([{"role": "system", "content": system}, {"role": "user", "content": user}], model=model, max_tokens=max_tokens,
               json_mode=True, fallbacks=fallbacks, budget=budget)
    try:
        out = json.loads(msg.get("content") or "{}")
        if isinstance(out, dict):
            out.setdefault("_model", msg.get("_model", model or MODEL))
        return out
    except json.JSONDecodeError:
        return {}
