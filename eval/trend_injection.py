"""Emerging-issue detector evaluation with synthetic incidents (Spark).

Takes the REAL daily negative-count series of the 40 largest themes, injects synthetic incidents of known
start date / magnitude / duration into a random subset, runs the production detector, and measures:
  recall (incident detected within its window), precision on clean themes (false alerts / theme-day),
  and detection delay (days from injection start to first alert).
Compared against a naive baseline: fixed threshold at 2x the theme's global mean.
"""
from __future__ import annotations

import json
import random

from pyspark.sql import SparkSession
from pyspark.sql import functions as F

from pipeline.common.runlog import ROOT
from pipeline.spark_jobs.trends import densify, detect_anomalies

GOLD = ROOT / "data" / "lake" / "gold"


def main():
    spark = SparkSession.builder.appName("echolens-trend-eval").master("local[*]").config("spark.driver.memory", "6g").getOrCreate()
    spark.sparkContext.setLogLevel("WARN")
    dt = spark.read.parquet(str(GOLD / "daily_theme")).select("workspace", "theme_id", "date", F.col("neg_count").alias("count"))
    # Ground truth must be exact, so series are simulated at REAL per-theme rates: for the 60 largest themes,
    # lambda = the theme's mean daily negative count; 120 days of Poisson counts with +-20% weekly seasonality.
    # Half get an injected incident (magnitude 1.5x-5x the normal rate, 2-5 days); the rest are pure null series,
    # so every alert on them is a false alert.
    import datetime as _dt
    import numpy as np
    top = (dt.groupBy("workspace", "theme_id").agg(F.avg("count").alias("lam")).orderBy(F.desc("lam")).limit(60).collect())
    rng = random.Random(3)
    nrng = np.random.default_rng(3)
    d0 = _dt.date(2022, 1, 1)
    rows_sim, inj = [], []
    for k, r in enumerate(top):
        lam = max(float(r.lam), 0.5)
        days = np.arange(120)
        rate = lam * (1 + 0.2 * np.sin(2 * np.pi * days / 7))
        counts = nrng.poisson(rate)
        tid = f"sim{k}_{r.theme_id}"
        if k % 2 == 0:
            start = rng.randint(40, 110)
            dur = rng.choice([2, 3, 5])
            mag = rng.choice([1.5, 2, 3, 5])
            extra = max(lam * (mag - 1), 2.0)
            counts[start : start + dur] += nrng.poisson(extra, size=len(counts[start : start + dur]))
            inj.append({"workspace": r.workspace, "theme_id": tid, "start": d0 + _dt.timedelta(days=start), "days": dur, "mult": mag, "lam": round(lam, 2)})
        rows_sim += [(r.workspace, tid, d0 + _dt.timedelta(days=int(d)), int(c)) for d, c in zip(days, counts)]
    sim = spark.createDataFrame(rows_sim, "workspace string, theme_id string, date date, count int")
    scored = detect_anomalies(sim, ["workspace", "theme_id"])
    # naive baseline: alert when count > 2x mean of the theme's whole series
    mean = scored.groupBy("workspace", "theme_id").agg(F.avg("count").alias("mu"))
    scored = scored.join(mean, ["workspace", "theme_id"]).withColumn("naive", (F.col("count") > 2 * F.col("mu")) & (F.col("count") >= 5))
    rows = scored.collect()

    def evaluate(flag):
        results, fp_days, clean_days = [], 0, 0
        by_key = {}
        for r in rows:
            by_key.setdefault((r.workspace, r.theme_id), []).append(r)
        for i in inj:
            rs = sorted(by_key[(i["workspace"], i["theme_id"])], key=lambda r: r.date)
            hits = [r.date for r in rs if getattr(r, flag) and r.date >= i["start"] and (r.date - i["start"]).days < i["days"] + 2]
            results.append({"name": f"x{i['mult']} for {i['days']}d (base {i['lam']}/day)", "mult": i["mult"], "injected_at": str(i["start"]),
                            "detected_at": str(hits[0]) if hits else None, "delay_days": (hits[0] - i["start"]).days if hits else None})
        inj_keys = {(i["workspace"], i["theme_id"]) for i in inj}
        for key, rs in by_key.items():
            if key in inj_keys:
                continue
            clean_days += len(rs)
            fp_days += sum(1 for r in rs if getattr(r, flag))
        det = [r for r in results if r["detected_at"]]
        recall = len(det) / max(len(results), 1)
        delay = sum(r["delay_days"] for r in det) / max(len(det), 1)
        return recall, delay, fp_days / max(clean_days, 1), results

    rec, delay, fpr, results = evaluate("is_anomaly")
    nrec, ndelay, nfpr, _ = evaluate("naive")
    by_mag = {str(m): sum(1 for r in results if r["mult"] == m and r["detected_at"]) / max(1, sum(1 for r in results if r["mult"] == m)) for m in sorted({r["mult"] for r in results})}
    _, _, _, nres = evaluate("naive")
    by_mag_naive = {str(m): sum(1 for r in nres if r["mult"] == m and r["detected_at"]) / max(1, sum(1 for r in nres if r["mult"] == m)) for m in sorted({r["mult"] for r in nres})}
    out = {"n_injected": len(inj), "n_clean_themes": len(top) - len(inj), "recall_by_magnitude": by_mag, "baseline_recall_by_magnitude": by_mag_naive, "recall": rec, "mean_delay_days": delay,
           "false_alert_rate_per_theme_day": fpr, "baseline_recall": nrec, "baseline_mean_delay_days": ndelay,
           "baseline_false_alert_rate": nfpr, "incidents": results}
    (ROOT / "data" / "eval").mkdir(parents=True, exist_ok=True)
    (ROOT / "data" / "eval" / "trends.json").write_text(json.dumps(out, indent=2, default=str))
    print(json.dumps({k: v for k, v in out.items() if k != "incidents"}, indent=2))
    spark.stop()


if __name__ == "__main__":
    main()
