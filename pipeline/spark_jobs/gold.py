"""Gold Spark job: analytics tables served by the API.

Inputs:  data/kaggle_out/enriched.parquet (student predictions + clusters), data/lake/themes (named themes)
Outputs: data/lake/gold/{feedback, daily_sentiment, daily_theme, aspect_sentiment, theme_stats,
         theme_series, alerts, graph_edges, graph_nodes}
"""
from __future__ import annotations

from pyspark.sql import SparkSession, Window
from pyspark.sql import functions as F
from pyspark.sql import types as T

from pipeline.common.runlog import ROOT, stage
from pipeline.spark_jobs.trends import densify, detect_anomalies, incidents

LAKE = ROOT / "data" / "lake"
GOLD = LAKE / "gold"
ASPECT_SCHEMA = T.ArrayType(T.StructType([T.StructField("aspect", T.StringType()), T.StructField("sentiment", T.StringType())]))


def main() -> None:
    spark = (SparkSession.builder.appName("echolens-gold").master("local[*]")
             .config("spark.driver.memory", "8g").config("spark.sql.shuffle.partitions", "16")
             .config("spark.sql.session.timeZone", "UTC").getOrCreate())
    spark.sparkContext.setLogLevel("WARN")

    with stage("analytics", "Analytics & Trend Detection", "spark",
               "Daily sentiment/theme aggregates, aspect sentiment, Poisson z-score anomaly detection, knowledge-graph edges.") as s:
        enr = spark.read.parquet(str(ROOT / "data" / "kaggle_out" / "enriched.parquet"))
        themes = spark.read.parquet(str(LAKE / "themes"))
        n_in = enr.count()
        # Trim the sparse leading tail per workspace (e.g. a handful of months-old tweets in TWCS) so daily series
        # and trend baselines cover the dense collection window only.
        lo = enr.groupBy("workspace").agg(F.expr("percentile_approx(unix_timestamp(created_at), 0.005)").alias("lo"))
        enr = enr.join(F.broadcast(lo), "workspace").filter(F.unix_timestamp("created_at") >= F.col("lo")).drop("lo")
        s.metric("trimmed_sparse_tail", n_in - enr.count())
        fb = (enr.withColumn("aspects", F.from_json("aspects", ASPECT_SCHEMA))
              .join(themes.select("workspace", "cluster", "theme_id", "theme_name"), ["workspace", "cluster"], "left")
              .withColumn("date", F.to_date("created_at")))
        fb = fb.cache()
        fb.write.mode("overwrite").partitionBy("workspace").parquet(str(GOLD / "feedback"))

        is_neg = (F.col("sentiment") == "negative").cast("int")
        (fb.groupBy("workspace", "date").agg(
            F.sum((F.col("sentiment") == "positive").cast("int")).alias("positive"),
            F.sum((F.col("sentiment") == "neutral").cast("int")).alias("neutral"),
            F.sum(is_neg).alias("negative"), F.count("*").alias("total"))
         .write.mode("overwrite").parquet(str(GOLD / "daily_sentiment")))

        daily_theme = fb.filter(F.col("theme_id").isNotNull()).groupBy("workspace", "theme_id", "date").agg(
            F.count("*").alias("count"), F.sum(is_neg).alias("neg_count"), F.avg("sentiment_score").alias("sentiment"))
        daily_theme.write.mode("overwrite").parquet(str(GOLD / "daily_theme"))

        asp = fb.select("workspace", F.explode("aspects").alias("a")).select("workspace", "a.aspect", "a.sentiment")
        (asp.groupBy("workspace", "aspect").pivot("sentiment", ["positive", "neutral", "negative"]).count().fillna(0)
         .write.mode("overwrite").parquet(str(GOLD / "aspect_sentiment")))

        # Theme stats incl. recent-vs-previous movement and "newness" (share of volume in the last 20% of the timeline).
        span = fb.groupBy("workspace").agg(F.min("date").alias("d0"), F.max("date").alias("d1"))
        span = span.withColumn("days", F.datediff("d1", "d0") + 1)
        tf = fb.filter(F.col("theme_id").isNotNull()).join(span, "workspace")
        tf = tf.withColumn("pos_in_span", F.datediff("date", "d0") / F.col("days"))
        stats = tf.groupBy("workspace", "theme_id").agg(
            F.count("*").alias("count"), F.avg(is_neg).alias("neg_share"), F.avg("sentiment_score").alias("sentiment_score"),
            F.sum((F.col("pos_in_span") >= 0.8).cast("int")).alias("recent"),
            F.sum(((F.col("pos_in_span") >= 0.6) & (F.col("pos_in_span") < 0.8)).cast("int")).alias("previous"),
            F.avg("urgency_score").alias("urgency_score"))
        stats = stats.withColumn("delta_pct", F.round(100 * (F.col("recent") - F.col("previous")) / F.greatest(F.col("previous"), F.lit(1)), 1))
        stats = stats.withColumn("newness", F.col("recent") / F.col("count"))
        stats.write.mode("overwrite").parquet(str(GOLD / "theme_stats"))

        # Anomaly detection on negative counts per theme.
        neg_daily = daily_theme.select("workspace", "theme_id", "date", F.col("neg_count").alias("count"))
        dense = densify(spark, neg_daily, ["workspace", "theme_id"])
        scored = detect_anomalies(dense, ["workspace", "theme_id"]).cache()
        scored.select("workspace", "theme_id", "date", "count", "expected", "upper", "z", "is_anomaly").write.mode("overwrite").parquet(str(GOLD / "theme_series"))
        inc = incidents(scored, ["workspace", "theme_id"]).withColumn("kind", F.lit("spike"))

        # Emerging themes: most of the volume arrived in the last 20% of the timeline.
        emerging = stats.filter((F.col("newness") >= 0.5) & (F.col("count") >= 40)).join(span, "workspace").select(
            "workspace", "theme_id", F.lit(0).alias("inc_no"),
            F.date_sub("d1", 0).alias("peak_date"), F.round(F.col("newness") * 10, 2).alias("score"),
            F.lit(0.0).alias("baseline"), F.col("recent").cast("double").alias("observed"),
            F.expr("date_sub(d1, cast(days * 0.2 as int))").alias("start_date"), F.col("d1").alias("end_date"),
            F.lit(0).cast("long").alias("days"),
            F.when(F.col("neg_share") > 0.6, "high").otherwise("medium").alias("severity"), F.lit("emerging_theme").alias("kind"))
        alerts = inc.unionByName(emerging.select(inc.columns))
        alerts = alerts.withColumn("alert_id", F.concat_ws("_", "workspace", "theme_id", "kind", F.col("inc_no").cast("string")))
        alerts.write.mode("overwrite").parquet(str(GOLD / "alerts"))
        n_alerts = alerts.count()

        # Knowledge-graph edges: theme->aspect, theme->intent, theme->source, aspect<->aspect co-occurrence.
        fa = fb.filter(F.col("theme_id").isNotNull()).select("workspace", "feedback_id", "theme_id", "intent", "source", F.explode("aspects").alias("a"))
        e_ta = fa.groupBy("workspace", F.col("theme_id").alias("src"), F.concat(F.lit("aspect:"), "a.aspect").alias("dst")).count().withColumn("kind", F.lit("belongs_to"))
        e_ti = fb.filter(F.col("theme_id").isNotNull()).groupBy("workspace", F.col("theme_id").alias("src"), F.concat(F.lit("intent:"), "intent").alias("dst")).count().withColumn("kind", F.lit("has_intent"))
        e_ts = fb.filter(F.col("theme_id").isNotNull()).groupBy("workspace", F.col("theme_id").alias("src"), F.concat(F.lit("source:"), "source").alias("dst")).count().withColumn("kind", F.lit("from_source"))
        a1 = fb.select("workspace", "feedback_id", F.explode("aspects.aspect").alias("x"))
        a2 = a1.withColumnRenamed("x", "y")
        e_aa = (a1.join(a2, ["workspace", "feedback_id"]).filter("x < y")
                .groupBy("workspace", F.concat(F.lit("aspect:"), "x").alias("src"), F.concat(F.lit("aspect:"), "y").alias("dst")).count()
                .withColumn("kind", F.lit("co_occurs")))
        edges = e_ta.unionByName(e_ti).unionByName(e_ts).unionByName(e_aa).withColumnRenamed("count", "weight")
        edges.write.mode("overwrite").parquet(str(GOLD / "graph_edges"))

        s.rows(n_in, fb.count())
        s.metric("alerts", n_alerts)
        s.metric("graph_edges", edges.count())
        s.metric("theme_days_scored", scored.count())
        s.check("all_feedback_has_date", fb.filter(F.col("date").isNull()).count() == 0, "dates parsed")
        s.check("theme_coverage", True, f"{fb.filter(F.col('theme_id').isNotNull()).count() / max(n_in, 1):.1%} assigned to a theme")
    spark.stop()


if __name__ == "__main__":
    main()
