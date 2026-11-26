"""One entry point for the whole pipeline.

  python -m pipeline.cli ingest      # Spark (Docker): bronze + silver
  python -m pipeline.cli label       # Groq teacher labels
  python -m pipeline.cli kaggle      # GPU job on Kaggle: student model, embeddings, clustering
  python -m pipeline.cli themes      # LLM theme naming + NPMI
  python -m pipeline.cli gold        # Spark (Docker): analytics, trends, graph edges
  python -m pipeline.cli serving     # graph/galaxy/insights/pipeline JSON
  python -m pipeline.cli eval        # trend injection (Spark) + full evaluation report
  python -m pipeline.cli all
"""
from __future__ import annotations

import subprocess
import os
import sys

from pipeline.common.runlog import ROOT

PY = sys.executable          # the interpreter running the CLI (its venv)
SPARK_TMP = os.getenv("SPARK_TMP", str(ROOT / ".cache" / "spark-tmp"))


def spark(script: str, *args: str) -> None:
    cmd = ["docker", "run", "--rm", "-v", f"{ROOT}:/workspace", "-v", f"{SPARK_TMP}:/sparktmp", "echolens-spark",
           "/opt/spark/bin/spark-submit", "--driver-memory", "10g", "--conf", "spark.local.dir=/sparktmp",
           "--conf", "spark.driver.extraJavaOptions=-Djava.io.tmpdir=/sparktmp", f"/workspace/{script}", *args]
    subprocess.run(cmd, check=True)


def py(module: str, *args: str) -> None:
    subprocess.run([PY, "-m", module, *args], check=True, cwd=ROOT)


STEPS = {
    "ingest": lambda: spark("pipeline/spark_jobs/ingest.py"),
    "label": lambda: (py("ml.labeling.label_with_groq", "--model", "openai/gpt-oss-120b", "--split", "test", "--start", "0", "--end", "600"),
                      py("ml.labeling.label_with_groq", "--model", "openai/gpt-oss-120b", "--split", "train", "--start", "600", "--end", "1500"),
                      py("ml.labeling.label_with_groq", "--model", "openai/gpt-oss-20b", "--split", "train", "--start", "1500", "--end", "3600")),
    "kaggle": lambda: py("ml.kaggle.run_kaggle", "all"),
    "themes": lambda: py("ml.themes.name_themes"),
    "gold": lambda: spark("pipeline/spark_jobs/gold.py"),
    "serving": lambda: (py("retrieval.build_index"), py("pipeline.build_serving")),
    "eval": lambda: (spark("eval/trend_injection.py"), py("eval.run_eval")),
}

if __name__ == "__main__":
    targets = sys.argv[1:] or ["all"]
    for t in (list(STEPS) if targets == ["all"] else targets):
        print(f"==> {t}", flush=True)
        STEPS[t]()
