"""Quality regression gate: every metric with a threshold in eval/thresholds.json must pass.
Run after `python -m pipeline.cli eval`."""
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / "data" / "serving" / "eval.json"


def _all_metrics(r):
    yield from r["summary"]
    for c in r["classification"]:
        yield from c["metrics"]
    yield from r["clustering"]
    yield from r["retrieval"]["metrics"]
    yield from r["trends"]["metrics"]
    yield from r["grounding"]


@pytest.mark.skipif(not REPORT.exists(), reason="evaluation not run")
def test_thresholds():
    r = json.loads(REPORT.read_text())
    failed = [f"{m['name']}: {m['value']} vs {m['threshold']}" for m in _all_metrics(r) if m.get("passed") is False]
    assert not failed, "metric regressions:\n" + "\n".join(failed)


@pytest.mark.skipif(not REPORT.exists(), reason="evaluation not run")
def test_student_beats_baseline():
    r = json.loads(REPORT.read_text())
    for c in r["classification"]:
        for m in c["metrics"]:
            if m.get("baseline_name") == "TF-IDF + LogReg" and m["name"].startswith("Macro-F1"):
                assert m["value"] >= m["baseline"], f"{c['task']}: student {m['value']} < baseline {m['baseline']}"
