"""Unit tests that need no data: citation parsing / stripping in the analyst."""
from analyst.agent import CITE_RE


def test_citation_regex():
    s = "Users hate ads [#rv_123] and price [#rv_9][#tk_55]."
    assert CITE_RE.findall(s) == ["rv_123", "rv_9", "tk_55"]


def test_unknown_citations_are_stripped():
    evidence = {"rv_1": "x"}
    s = "Claim one [#rv_1]. Claim two [#rv_404]."
    out = CITE_RE.sub(lambda m: m.group(0) if m.group(1) in evidence else "", s)
    assert "[#rv_1]" in out and "rv_404" not in out
