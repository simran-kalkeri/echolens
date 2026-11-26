"""Evidence-grounded AI analyst.

1. Tool-use loop (Groq, OpenAI-compatible tools): semantic search, theme stats, trends, alerts, read-only SQL.
2. Answer must cite feedback as [#id], using only ids the tools returned.
3. Grounding verifier: split the answer into claims; an LLM judge checks each claim against the cited
   feedback texts -> per-claim supported flag + groundedness score. Citations to unseen ids are stripped.
"""
from __future__ import annotations

import json
import re
from typing import Iterator

from analyst.llm import FAST_MODEL, MODEL, chat, chat_json
from api.store import ASPECT_LABELS, feedback_by_ids, q

# Accepts [#rv_123] and the [rv_123] variant models often emit; ids always start with rv_/tk_/sv_.
CITE_RE = re.compile(r"\[#?((?:rv|tk|sv)_-?[A-Za-z0-9_]+)\]")


BARE_ID_RE = re.compile(r"(?<![\[#\w-])((?:rv|tk|sv)_-?[0-9]+)(?![\w\]])")


def normalize_citations(text: str, valid) -> str:
    """Rewrite every citation to the canonical [#id] form and drop ids not in `valid` (hallucinated)."""
    text = BARE_ID_RE.sub(lambda m: f"[#{m.group(1)}]" if m.group(1) in valid else m.group(0), text)
    return CITE_RE.sub(lambda m: f"[#{m.group(1)}]" if m.group(1) in valid else "", text)

TOOLS = [
    {"type": "function", "function": {
        "name": "search_feedback",
        "description": "Hybrid semantic search over this workspace's customer feedback. Returns the most relevant items with ids to cite.",
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string", "description": "natural-language search query"},
            "sentiment": {"type": ["string", "null"], "enum": ["positive", "neutral", "negative", None], "description": "optional filter"},
            "k": {"type": ["integer", "null"], "description": "number of results (default 10, max 20)"}}, "required": ["query"]}}},
    {"type": "function", "function": {
        "name": "theme_stats",
        "description": "List discovered themes with volume, negative share, recent growth and aspect category.",
        "parameters": {"type": "object", "properties": {
            "sort_by": {"type": "string", "enum": ["count", "neg_share", "growth", "urgency"]},
            "aspect": {"type": ["string", "null"], "description": "optional aspect filter, one of: " + ", ".join(ASPECT_LABELS)},
            "limit": {"type": ["integer", "null"]}}, "required": ["sort_by"]}}},
    {"type": "function", "function": {
        "name": "theme_trend",
        "description": "Weekly total and negative counts for one theme (by theme_id) or for the whole workspace (theme_id='all').",
        "parameters": {"type": "object", "properties": {"theme_id": {"type": "string"}}, "required": ["theme_id"]}}},
    {"type": "function", "function": {
        "name": "list_alerts",
        "description": "Detected emerging issues / anomalous spikes in negative feedback, with dates and severity.",
        "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {
        "name": "theme_evidence",
        "description": "Representative negative feedback items for a theme, to cite as evidence.",
        "parameters": {"type": "object", "properties": {"theme_id": {"type": "string"}, "k": {"type": ["integer", "null"]}}, "required": ["theme_id"]}}},
]

SYSTEM = """You are EchoLens, a senior customer-insights analyst for the "{ws}" workspace ({date_min} to {date_max}, {n} feedback items from {sources}).
Answer product questions using ONLY evidence returned by your tools. Always use tools before answering; use search_feedback and/or theme_evidence to gather quotes.
Write the final answer in concise markdown (short headed sections or bullets, <= 220 words).
CITATION FORMAT (mandatory): after each claim about what customers say, put the exact `id` values from tool results in square brackets with a hash, e.g.
"- Shuffle keeps repeating the same few songs [#rv_-81234] [#rv_55120]."
Never use 【】, numbered footnotes or any other citation style. Statistics (counts, shares, growth) come from theme_stats/theme_trend and need no feedback citation.
Never invent ids, numbers or quotes. If evidence is insufficient, say so."""


def _tool_search(ws, query, sentiment=None, k=10):
    from retrieval.search import search
    k = max(1, min(int(k or 10), 20))
    hits = [i for i, _ in search(ws, query, k=60)]
    items = feedback_by_ids(hits)
    if sentiment:
        items = [x for x in items if x["sentiment"] == sentiment]
    return [{"id": x["id"], "text": x["text"][:280], "sentiment": x["sentiment"], "intent": x["intent"], "urgency": x["urgency"],
             "theme": x["theme_name"], "date": x["created_at"][:10]} for x in items[:k]]


def _tool_theme_stats(ws, sort_by="count", aspect=None, limit=10):
    order = {"count": "ts.count", "neg_share": "ts.neg_share * ln(ts.count)", "growth": "ts.delta_pct", "urgency": "ts.urgency_score"}.get(sort_by, "ts.count")
    sql = f"""SELECT t.theme_id, t.theme_name, t.aspect, ts.count, round(ts.neg_share,3) neg_share, ts.delta_pct growth_pct_recent,
              round(ts.urgency_score,3) urgency FROM themes t JOIN theme_stats ts USING(workspace, theme_id)
              WHERE t.workspace=? {"AND t.aspect=?" if aspect else ""} ORDER BY {order} DESC LIMIT {max(1, min(int(limit or 10), 25))}"""
    return q(sql, ws, *([aspect] if aspect else [])).to_dict("records")


def _tool_trend(ws, theme_id="all"):
    if theme_id == "all":
        df = q("SELECT date_trunc('week', date) wk, sum(total) total, sum(negative) negative FROM daily_sentiment WHERE workspace=? GROUP BY 1 ORDER BY 1", ws)
    else:
        df = q("SELECT date_trunc('week', date) wk, sum(count) total, sum(neg_count) negative FROM daily_theme WHERE workspace=? AND theme_id=? GROUP BY 1 ORDER BY 1", ws, theme_id)
    return [{"week": str(r.wk)[:10], "total": int(r.total), "negative": int(r.negative)} for r in df.itertuples()]


def _tool_alerts(ws):
    df = q("""SELECT a.alert_id, a.kind, a.theme_id, t.theme_name, a.start_date, a.peak_date, a.severity, round(a.score,1) score,
              round(a.baseline,1) baseline, a.observed FROM alerts a JOIN themes t USING(workspace, theme_id) WHERE a.workspace=? ORDER BY score DESC LIMIT 12""", ws)
    return json.loads(df.to_json(orient="records", date_format="iso"))


def _tool_evidence(ws, theme_id, k=8):
    df = q("""SELECT feedback_id id, substr(text,1,280) text, sentiment, urgency, created_at::DATE::VARCHAR date FROM feedback
              WHERE workspace=? AND theme_id=? ORDER BY (sentiment='negative') DESC, cluster_prob DESC LIMIT ?""", ws, theme_id, max(1, min(int(k or 8), 15)))
    return df.to_dict("records")


def _dispatch(ws, name, args):
    fns = {"search_feedback": _tool_search, "theme_stats": _tool_theme_stats, "theme_trend": _tool_trend,
           "list_alerts": _tool_alerts, "theme_evidence": _tool_evidence}
    if name not in fns:
        return {"error": f"unknown tool {name}"}
    args = {k: v for k, v in (args or {}).items() if v is not None}
    return fns[name](ws, **args)


def _summary(name, result):
    if isinstance(result, list):
        return f"{len(result)} rows"
    return "ok"


VERIFY = """You verify an analyst's claims. Evidence = the cited customer-feedback texts for that claim plus the statistics block.
A claim is supported only if the cited texts (or, for numeric/statistical statements, the statistics) actually back it up.
Claims with no citations can only be supported by the statistics. Be strict.
Return JSON {"claims":[{"i":<index>,"supported":true|false}]}"""


def claim_units(answer: str) -> list[str]:
    """A claim unit = a top-level bullet together with its nested lines, or a plain paragraph sentence.
    Headings and bold-only titles are not claims."""
    units: list[str] = []
    for line in answer.splitlines():
        if not line.strip() or line.strip().startswith("#"):
            continue
        indented = line.startswith((" ", "	")) and units
        if indented:
            units[-1] += " " + line.strip()
        elif line.lstrip().startswith(("-", "*", "•")) or re.match(r"\s*\d+\.", line):
            units.append(line.strip())
        else:
            units.extend(x.strip() for x in re.split(r"(?<=[.!?])\s+", line) if x.strip())
    out = []
    for u in units:
        bare = re.sub(r"[*_`>#-]", "", CITE_RE.sub("", u)).strip()
        if len(bare) > 25 and not re.fullmatch(r"[^.!?]{0,80}:?", bare):
            out.append(u)
    return out


def verify_claims(answer: str, evidence: dict[str, str], stats_blob: str) -> list[dict]:
    sentences = claim_units(answer)
    claims = []
    for s in sentences:
        ids = CITE_RE.findall(s)
        claims.append({"text": CITE_RE.sub("", s).strip(" -*"), "citation_ids": ids, "supported": False})
    payload = [{"i": i, "claim": c["text"], "cited": [evidence.get(x, "<missing>")[:300] for x in c["citation_ids"]]}
               for i, c in enumerate(claims)]
    if payload:
        res = chat_json(VERIFY, json.dumps({"stats": stats_blob[:3000], "claims": payload}, ensure_ascii=False), model=MODEL, max_tokens=500)
        ok = {int(r["i"]): bool(r.get("supported")) for r in res.get("claims", []) if "i" in r}
        for i in ok:
            if 0 <= i < len(claims):
                claims[i]["supported"] = ok[i]
    return claims


def run_agent(ws: str, question: str, max_rounds: int = 5) -> Iterator[dict]:
    meta = q("SELECT min(created_at)::DATE d0, max(created_at)::DATE d1, count(*) n, string_agg(DISTINCT source, ', ') s FROM feedback WHERE workspace=?", ws).iloc[0]
    if not meta.n:
        yield {"type": "error", "text": f"unknown workspace {ws}"}
        return
    messages = [{"role": "system", "content": SYSTEM.format(ws=ws, date_min=meta.d0, date_max=meta.d1, n=int(meta.n), sources=meta.s)},
                {"role": "user", "content": question}]
    evidence: dict[str, str] = {}
    stats: list = []
    yield {"type": "status", "text": "Planning analysis"}
    answer = None
    for rnd in range(max_rounds):
        msg = chat(messages, tools=TOOLS, max_tokens=900, temperature=0.1)
        calls = msg.get("tool_calls") or []
        if not calls:
            answer = msg.get("content") or ""
            if not evidence and rnd == 0:   # force at least one retrieval
                messages.append({"role": "assistant", "content": answer})
                messages.append({"role": "user", "content": "Use the tools to gather evidence first, then answer with citations."})
                continue
            break
        messages.append({"role": "assistant", "content": msg.get("content") or "", "tool_calls": calls})
        for c in calls:
            name = c["function"]["name"]
            try:
                args = json.loads(c["function"].get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            try:
                result = _dispatch(ws, name, args)
            except Exception as e:
                result = {"error": str(e)}
            if isinstance(result, list):
                for r in result:
                    if isinstance(r, dict) and "id" in r and "text" in r:
                        evidence[r["id"]] = r["text"]
                if name != "search_feedback" and name != "theme_evidence":
                    stats.append({name: result})
            yield {"type": "tool", "name": name, "args": args, "summary": _summary(name, result)}
            messages.append({"role": "tool", "tool_call_id": c["id"], "content": json.dumps(result, default=str)[:6000]})
    if answer is None:
        messages.append({"role": "user", "content": "Now write the final answer with [#id] citations."})
        answer = chat(messages, max_tokens=900).get("content") or ""

    answer = re.sub(r"【[^】]*】", "", answer)          # drop non-standard citation markers
    # Strip citations to ids the tools never returned (hallucinated ids).
    answer = normalize_citations(answer, evidence)
    for chunk in re.findall(r"\S+\s*", answer):
        yield {"type": "token", "text": chunk}
    yield {"type": "status", "text": "Verifying claims against cited evidence"}
    claims = verify_claims(answer, evidence, json.dumps(stats, default=str))
    cited = list(dict.fromkeys(CITE_RE.findall(answer)))
    g = sum(c["supported"] for c in claims) / len(claims) if claims else 0.0
    yield {"type": "final", "answer": answer, "citations": feedback_by_ids(cited), "claims": claims, "groundedness": round(g, 3)}
