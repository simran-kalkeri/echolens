"""Emerging-issue detection on daily per-theme negative-feedback counts (Spark window functions).

Model: for each theme, the expected count on day t is a trailing mean over the previous BASELINE_DAYS days
(excluding t). Counts are treated as Poisson, so the anomaly score is
    z = (observed - expected) / sqrt(expected + 1)
A day is anomalous if z >= Z_THRESHOLD and observed >= MIN_COUNT. Consecutive anomalous days (gap <= 1 day)
form one incident; its severity comes from the peak score.

The same function is used by the production gold job and by eval/trend_injection.py (synthetic incidents).
"""
from __future__ import annotations

from pyspark.sql import DataFrame, SparkSession, Window
from pyspark.sql import functions as F

BASELINE_DAYS = 14
Z_THRESHOLD = 4.0
MIN_COUNT = 5


def densify(spark: SparkSession, daily: DataFrame, key_cols: list[str]) -> DataFrame:
    """Fill missing days with 0 so the trailing baseline is correct. daily: key_cols + date + count."""
    bounds = daily.groupBy("workspace").agg(F.min("date").alias("d0"), F.max("date").alias("d1"))
    days = bounds.select("workspace", F.explode(F.sequence("d0", "d1")).alias("date"))
    keys = daily.select(*key_cols).distinct()
    grid = keys.join(days, "workspace")
    return grid.join(daily, key_cols + ["date"], "left").fillna(0, subset=["count"])


def detect_anomalies(series: DataFrame, key_cols: list[str]) -> DataFrame:
    """series: key_cols + date + count (dense). Adds expected, upper, z, is_anomaly."""
    w = Window.partitionBy(*key_cols).orderBy("date").rowsBetween(-BASELINE_DAYS, -1)
    out = (
        series.withColumn("expected", F.avg("count").over(w))
        .withColumn("n_hist", F.count("count").over(w))
        .withColumn("expected", F.coalesce("expected", F.lit(0.0)))
        .withColumn("z", (F.col("count") - F.col("expected")) / F.sqrt(F.col("expected") + 1))
        .withColumn("upper", F.col("expected") + Z_THRESHOLD * F.sqrt(F.col("expected") + 1))
        .withColumn("is_anomaly", (F.col("n_hist") >= 7) & (F.col("z") >= Z_THRESHOLD) & (F.col("count") >= MIN_COUNT))
    )
    return out


def incidents(scored: DataFrame, key_cols: list[str]) -> DataFrame:
    """Group consecutive anomalous days into incidents."""
    a = scored.filter("is_anomaly")
    w = Window.partitionBy(*key_cols).orderBy("date")
    a = a.withColumn("gap", F.datediff("date", F.lag("date").over(w)))
    a = a.withColumn("new_inc", F.when(F.col("gap").isNull() | (F.col("gap") > 2), 1).otherwise(0))
    a = a.withColumn("inc_no", F.sum("new_inc").over(w.rowsBetween(Window.unboundedPreceding, 0)))
    wp = Window.partitionBy(*key_cols, "inc_no").orderBy(F.desc("z"))
    peak = a.withColumn("r", F.row_number().over(wp)).filter("r = 1").select(
        *key_cols, "inc_no", F.col("date").alias("peak_date"), F.col("z").alias("score"),
        F.col("expected").alias("baseline"), F.col("count").alias("observed"))
    span = a.groupBy(*key_cols, "inc_no").agg(F.min("date").alias("start_date"), F.max("date").alias("end_date"), F.count("*").alias("days"))
    inc = span.join(peak, key_cols + ["inc_no"])
    return inc.withColumn(
        "severity",
        F.when(F.col("score") >= 12, "critical").when(F.col("score") >= 8, "high").when(F.col("score") >= 6, "medium").otherwise("low"),
    )
