"""Pipeline run metadata: each stage records rows in/out, duration, metrics and data-quality checks.

The API serves the merged run file to the dashboard's pipeline DAG view.
"""
from __future__ import annotations

import json
import os
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUN_DIR = ROOT / "data" / "runs"
STAGE_FILE = RUN_DIR / "stages.json"


def _load() -> dict:
    if STAGE_FILE.exists():
        return json.loads(STAGE_FILE.read_text(encoding="utf-8"))
    return {}


def save_stage(stage_id: str, record: dict) -> None:
    RUN_DIR.mkdir(parents=True, exist_ok=True)
    data = _load()
    data[stage_id] = record
    STAGE_FILE.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")


class Stage:
    def __init__(self, stage_id: str, name: str, engine: str, description: str):
        self.rec = {
            "id": stage_id, "name": name, "engine": engine, "description": description,
            "status": "running", "rows_in": None, "rows_out": None, "duration_s": 0.0,
            "metrics": {}, "checks": [], "started_at": datetime.now(timezone.utc).isoformat(),
        }

    def metric(self, key: str, value) -> None:
        self.rec["metrics"][key] = value

    def check(self, name: str, passed: bool, value) -> None:
        self.rec["checks"].append({"name": name, "passed": bool(passed), "value": str(value)})

    def rows(self, rows_in=None, rows_out=None) -> None:
        if rows_in is not None:
            self.rec["rows_in"] = int(rows_in)
        if rows_out is not None:
            self.rec["rows_out"] = int(rows_out)


@contextmanager
def stage(stage_id: str, name: str, engine: str, description: str):
    s = Stage(stage_id, name, engine, description)
    t0 = time.time()
    try:
        yield s
        s.rec["status"] = "success"
    except Exception:
        s.rec["status"] = "failed"
        raise
    finally:
        s.rec["duration_s"] = round(time.time() - t0, 2)
        s.rec["finished_at"] = datetime.now(timezone.utc).isoformat()
        save_stage(stage_id, s.rec)
        print(f"[{stage_id}] {s.rec['status']} in {s.rec['duration_s']}s rows {s.rec['rows_in']}->{s.rec['rows_out']}", flush=True)
