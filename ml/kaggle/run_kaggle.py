"""Orchestrate the Kaggle GPU job: upload inputs as a private dataset, push the kernel, wait, download outputs,
and record pipeline-stage metadata from the job's metrics.

Usage: python -m ml.kaggle.run_kaggle [prepare|push|wait|download|all]
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time

import pandas as pd

from pipeline.common.runlog import ROOT, save_stage

USER = "amaanalidoddamani"
DATASET = f"{USER}/echolens-inputs"
KERNEL = f"{USER}/echolens-enrich"
UP = ROOT / "data" / "kaggle_upload"
KDIR = ROOT / "data" / "kaggle_kernel"
OUT = ROOT / "data" / "kaggle_out"
KAGGLE = str(ROOT / ".venv" / "Scripts" / "kaggle")


def k(*args, check=True) -> str:
    r = subprocess.run([KAGGLE, *args], capture_output=True, text=True, encoding="utf-8", errors="replace")
    print(r.stdout[-1500:], r.stderr[-1500:], flush=True)
    if check and r.returncode != 0:
        raise SystemExit(f"kaggle {' '.join(args)} failed")
    return r.stdout


def prepare():
    UP.mkdir(parents=True, exist_ok=True)
    silver = pd.read_parquet(ROOT / "data" / "lake" / "silver" / "feedback")
    silver = silver.sort_values("feedback_id").reset_index(drop=True)
    silver.to_parquet(UP / "silver.parquet", index=False)
    with (UP / "teacher_labels.jsonl").open("w", encoding="utf-8") as out:
        for f in sorted((ROOT / "data" / "labels").glob("teacher_*.jsonl")):
            out.write(f.read_text(encoding="utf-8"))
    shutil.copy(ROOT / "data" / "raw" / "semeval" / "Restaurants_Train_v2.xml", UP / "Restaurants_Train_v2.xml")
    (UP / "dataset-metadata.json").write_text(json.dumps({"title": "echolens-inputs", "id": DATASET, "licenses": [{"name": "CC-BY-NC-SA-4.0"}]}))
    print(f"prepared {len(silver)} silver rows")
    exists = subprocess.run([KAGGLE, "datasets", "status", DATASET], capture_output=True, text=True).returncode == 0
    if exists:
        k("datasets", "version", "-p", str(UP), "-m", "update inputs", "-q")
    else:
        k("datasets", "create", "-p", str(UP), "-q")      # private by default
    for _ in range(60):
        st = subprocess.run([KAGGLE, "datasets", "status", DATASET], capture_output=True, text=True).stdout.strip()
        print("dataset status:", st, flush=True)
        if "ready" in st.lower():
            return
        time.sleep(10)


def push():
    KDIR.mkdir(parents=True, exist_ok=True)
    shutil.copy(ROOT / "ml" / "kaggle" / "enrich.py", KDIR / "enrich.py")
    (KDIR / "kernel-metadata.json").write_text(json.dumps({
        "id": KERNEL, "title": "echolens-enrich", "code_file": "enrich.py", "language": "python", "kernel_type": "script",
        "is_private": True, "enable_gpu": True, "enable_tpu": False, "enable_internet": True,
        "machine_shape": "NvidiaTeslaT4", "dataset_sources": [DATASET], "competition_sources": [], "kernel_sources": []}, indent=2))
    k("kernels", "push", "-p", str(KDIR))


def wait():
    t0 = time.time()
    while True:
        st = subprocess.run([KAGGLE, "kernels", "status", KERNEL], capture_output=True, text=True).stdout.strip()
        print(f"[{time.time() - t0:5.0f}s] {st}", flush=True)
        low = st.lower()
        if "complete" in low:
            return True
        if "error" in low or "cancel" in low:
            return False
        time.sleep(30)


def download():
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    k("kernels", "output", KERNEL, "-p", str(OUT), "-o")
    nested = OUT / "out"
    if nested.exists():
        for f in nested.iterdir():
            shutil.move(str(f), OUT / f.name)
        nested.rmdir()
    normalise_timestamps()
    record_stages()


def normalise_timestamps():
    """pandas writes ns timestamps; Spark's Parquet reader needs us precision."""
    for f in ("enriched.parquet",):
        df = pd.read_parquet(OUT / f)
        df.to_parquet(OUT / f, index=False, coerce_timestamps="us", allow_truncated_timestamps=True)


def record_stages():
    m = json.loads((OUT / "metrics.json").read_text())
    n = len(pd.read_parquet(OUT / "embedding_ids.parquet"))
    tasks = {t["task"]: t for t in m["student"]["tasks"]}
    base = {"status": "success", "rows_in": n, "rows_out": n}
    save_stage("nlp", {**base, "id": "nlp", "name": "NLP Intelligence Pipeline", "engine": "kaggle-gpu",
                       "description": f"Teacher (Groq LLM) labels distilled into a multi-task {m['student']['base_model'].split('/')[-1]} student; bulk inference on {m['gpu']}.",
                       "duration_s": m["timings"]["train_student_s"] + m["timings"]["student_inference_s"],
                       "metrics": {"train_examples": m["student"]["n_train"], "throughput_items_per_s": m["student"]["throughput_items_per_s"], "gpu": m["gpu"]},
                       "checks": [{"name": f"{t}_macro_f1_beats_baseline", "passed": v["macro_f1"] >= v.get("baseline_macro_f1", 0), "value": f"{v['macro_f1']:.3f} vs {v.get('baseline_macro_f1', 0):.3f}"} for t, v in tasks.items()]})
    save_stage("absa", {**base, "id": "absa", "name": "Aspect Sentiment & Urgency", "engine": "kaggle-gpu",
                        "description": "14 aspect categories x {none,neg,neu,pos} head + urgency head; validated on SemEval-2014 ACSA.",
                        "duration_s": m["timings"]["semeval_s"],
                        "metrics": {"aspect_detection_f1": round(m["student"]["aspects"]["detection_f1"], 4), "aspect_joint_f1": round(m["student"]["aspects"]["joint_f1"], 4),
                                    "urgency_macro_f1": round(tasks["urgency"]["macro_f1"], 4), "semeval_detection_f1": round(m["semeval_acsa"]["detection_f1"], 4)},
                        "checks": [{"name": "semeval_category_f1>=0.8", "passed": m["semeval_acsa"]["detection_f1"] >= 0.8, "value": f"{m['semeval_acsa']['detection_f1']:.3f}"}]})
    cm = m["clustering"]
    save_stage("embed_cluster", {**base, "id": "embed_cluster", "name": "Embeddings & Topic Clustering", "engine": "kaggle-gpu",
                                 "description": "bge-small-en-v1.5 embeddings -> UMAP(5d) -> HDBSCAN per workspace; UMAP(3d) for the galaxy view.",
                                 "duration_s": m["timings"]["embedding_s"] + m["timings"]["clustering_s"],
                                 "metrics": {"clusters": sum(v["clusters"] for v in cm.values()),
                                             "mean_silhouette": round(sum(v["silhouette_umap"] for v in cm.values()) / len(cm), 4),
                                             "mean_noise": round(sum(v["noise_after_reassign"] for v in cm.values()) / len(cm), 4)},
                                 "checks": [{"name": f"{ws}_noise_share_below_10pct", "passed": v["noise_after_reassign"] < 0.10,
                                             "value": f"{v['noise_after_reassign']:.1%} unassigned, {v['clusters']} themes, silhouette {v['silhouette_umap']:.3f} (KMeans same k {v['silhouette_kmeans_same_k']:.3f})"} for ws, v in cm.items()]})
    print("stages recorded")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    if cmd in ("prepare", "all"):
        prepare()
    if cmd in ("push", "all"):
        push()
    if cmd in ("wait", "all"):
        if not wait():
            raise SystemExit("kernel failed — check logs with: kaggle kernels output " + KERNEL)
    if cmd in ("download", "all"):
        download()
    if cmd == "normalise":
        normalise_timestamps()
    if cmd == "record":
        record_stages()
