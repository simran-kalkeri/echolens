"""Bronze + Silver Spark jobs.

Bronze: ingest raw sources into one unified, schema-validated feedback table (+ a rejects table).
Silver: clean text, redact PII, filter non-English / too-short items, exact + near-duplicate removal
(MinHash LSH), then cap per-workspace volume and draw a stratified labelling sample.

Run inside the echolens-spark container:  spark-submit pipeline/spark_jobs/ingest.py
"""
from __future__ import annotations

from pyspark.ml.feature import HashingTF, MinHashLSH, Tokenizer
from pyspark.ml.functions import vector_to_array
from pyspark.sql import DataFrame, SparkSession, Window
from pyspark.sql import functions as F
from pyspark.sql import types as T

from pipeline.common.runlog import ROOT, stage

RAW = ROOT / "data" / "raw"
LAKE = ROOT / "data" / "lake"

# Support-ticket workspaces: brand handle on Twitter -> workspace id / display name
BRANDS = {
    "AppleSupport": ("apple", "Apple"),
    "AmazonHelp": ("amazon", "Amazon"),
    "Uber_Support": ("uber", "Uber"),
    "Delta": ("delta", "Delta Air Lines"),
    "XboxSupport": ("xbox", "Xbox"),
}
PER_WORKSPACE_CAP = 45_000
LABEL_SAMPLE = 3_600

UNIFIED = ["feedback_id", "workspace", "source", "text", "rating", "created_at", "author_hash", "thumbs_up"]


def spark_session() -> SparkSession:
    return (
        SparkSession.builder.appName("echolens-ingest")
        .master("local[*]")
        .config("spark.driver.memory", "10g")
        .config("spark.sql.shuffle.partitions", "32")
        .config("spark.sql.session.timeZone", "UTC")
        .getOrCreate()
    )


# ---------------------------------------------------------------- bronze
def load_reviews(spark: SparkSession) -> DataFrame:
    df = spark.read.csv(str(RAW / "spotify" / "reviews.csv"), header=True, multiLine=True, escape='"')
    return df.select(
        F.concat(F.lit("rv_"), F.xxhash64("Time_submitted", "Review").cast("string")).alias("feedback_id"),
        F.lit("spotify").alias("workspace"),
        F.lit("review").alias("source"),
        F.col("Review").alias("text"),
        F.col("Rating").cast("int").alias("rating"),
        F.to_timestamp("Time_submitted", "yyyy-MM-dd HH:mm:ss").alias("created_at"),
        F.lit(None).cast("string").alias("author_hash"),
        F.col("Total_thumbsup").cast("int").alias("thumbs_up"),
    )


def load_surveys(spark: SparkSession) -> DataFrame | None:
    """Synthetic NPS survey verbatims (LLM-generated, see ml/labeling/generate_surveys.py)."""
    path = RAW / "surveys" / "spotify_nps_synthetic.csv"
    if not path.exists():
        return None
    df = spark.read.csv(str(path), header=True, multiLine=True, escape='"')
    nps = F.col("nps_score").cast("int")
    return df.select(
        F.col("response_id").alias("feedback_id"),
        F.lit("spotify").alias("workspace"),
        F.lit("survey").alias("source"),
        F.col("answer").alias("text"),
        F.least(F.lit(5), F.floor(nps / 2) + 1).cast("int").alias("rating"),   # NPS 0-10 -> 1-5 scale
        F.to_timestamp("submitted_at", "yyyy-MM-dd HH:mm:ss").alias("created_at"),
        F.lit(None).cast("string").alias("author_hash"),
        F.lit(None).cast("int").alias("thumbs_up"),
    )


def load_tickets(spark: SparkSession, stg) -> DataFrame:
    tw = spark.read.csv(
        str(RAW / "twcs" / "twcs" / "twcs.csv"), header=True, multiLine=True, escape='"'
    ).withColumn("inbound", F.col("inbound") == F.lit("True"))
    stg.metric("twcs_raw_tweets", tw.count())

    # Conversation starters = inbound customer tweets that do not reply to anything.
    starters = tw.filter(F.col("inbound") & F.col("in_response_to_tweet_id").isNull())
    # The brand is whoever replied to the starter (join on reply edge).
    replies = tw.filter(~F.col("inbound")).select(
        F.col("in_response_to_tweet_id").alias("tweet_id"), F.col("author_id").alias("brand")
    ).dropDuplicates(["tweet_id"])
    convo = starters.join(replies, "tweet_id", "inner")
    stg.metric("twcs_conversations", convo.count())

    mapping = spark.createDataFrame([(k, v[0]) for k, v in BRANDS.items()], ["brand", "workspace"])
    convo = convo.join(F.broadcast(mapping), "brand", "inner")
    return convo.select(
        F.concat(F.lit("tk_"), F.col("tweet_id")).alias("feedback_id"),
        "workspace",
        F.lit("ticket").alias("source"),
        "text",
        F.lit(None).cast("int").alias("rating"),
        F.to_timestamp(F.expr("substring(created_at, 5)"), "MMM dd HH:mm:ss Z yyyy").alias("created_at"),
        F.sha2(F.col("author_id"), 256).substr(1, 16).alias("author_hash"),
        F.lit(None).cast("int").alias("thumbs_up"),
    )


def bronze(spark: SparkSession) -> DataFrame:
    with stage("ingest", "Ingestion & Validation", "spark",
               "Unify reviews + support tickets into one schema; validate types, timestamps, ranges and IDs.") as s:
        reviews = load_reviews(spark)
        tickets = load_tickets(spark, s)
        surveys = load_surveys(spark)
        df = reviews.unionByName(tickets)
        if surveys is not None:
            df = df.unionByName(surveys)
        df = df.cache()
        total = df.count()

        rules = {
            "text_not_empty": F.col("text").isNotNull() & (F.length(F.trim("text")) > 0),
            "timestamp_parsed": F.col("created_at").isNotNull(),
            "rating_in_range": F.col("rating").isNull() | F.col("rating").between(1, 5),
        }
        reason = F.lit(None).cast("string")
        for name, cond in reversed(list(rules.items())):
            reason = F.when(~cond, F.lit(name)).otherwise(reason)
        df = df.withColumn("reject_reason", reason)
        rejects = df.filter(F.col("reject_reason").isNotNull())
        valid = df.filter(F.col("reject_reason").isNull()).drop("reject_reason")

        n_rej = rejects.count()
        dup_ids = valid.groupBy("feedback_id").count().filter("count > 1").count()
        valid = valid.dropDuplicates(["feedback_id"])
        n_valid = valid.count()

        rej_by = {r["reject_reason"]: r["count"] for r in rejects.groupBy("reject_reason").count().collect()}
        for name in rules:
            s.check(name, rej_by.get(name, 0) / max(total, 1) < 0.02, f"{rej_by.get(name, 0)} failed")
        s.check("unique_feedback_id", True, f"{dup_ids} duplicate ids removed")
        s.check("schema_matches_contract", valid.columns == UNIFIED, ",".join(valid.columns))
        s.metric("rejected", n_rej)
        s.metric("by_source", {r["source"]: r["count"] for r in valid.groupBy("source").count().collect()})
        s.rows(total, n_valid)

        valid.write.mode("overwrite").partitionBy("workspace").parquet(str(LAKE / "bronze" / "feedback"))
        rejects.write.mode("overwrite").parquet(str(LAKE / "bronze" / "rejects"))
        df.unpersist()
    return spark.read.parquet(str(LAKE / "bronze" / "feedback"))


# ---------------------------------------------------------------- silver
URL_RE = r"https?://\S+|www\.\S+"
EMAIL_RE = r"[\w.+-]+@[\w-]+\.[\w.]+"
PHONE_RE = r"(?<!\w)(\+?\d[\d\s().-]{7,}\d)(?!\w)"
CARD_RE = r"\b(?:\d[ -]?){13,16}\b"
LEAD_MENTIONS_RE = r"^(\s*@\w+)+\s*"


def silver(spark: SparkSession, bronze_df: DataFrame) -> None:
    with stage("clean_dedup", "Cleaning & Deduplication", "spark",
               "Strip handles/URLs, redact PII, drop non-English and trivial items, exact + MinHash-LSH near-dup removal.") as s:
        n_in = bronze_df.count()
        t = F.col("text")
        cleaned = (
            bronze_df
            .withColumn("pii_hits", F.size(F.split(F.col("text"), EMAIL_RE)) - 1 + F.size(F.split(F.col("text"), CARD_RE)) - 1)
            .withColumn("text", F.regexp_replace(t, LEAD_MENTIONS_RE, ""))
            .withColumn("text", F.regexp_replace(t, URL_RE, "<url>"))
            .withColumn("text", F.regexp_replace(t, EMAIL_RE, "<email>"))
            .withColumn("text", F.regexp_replace(t, CARD_RE, "<card>"))
            .withColumn("text", F.regexp_replace(t, PHONE_RE, "<phone>"))
            .withColumn("text", F.regexp_replace(t, r"@\w+", "@user"))
            .withColumn("text", F.trim(F.regexp_replace(t, r"\s+", " ")))
        )
        # English heuristic: share of ASCII letters among all letters.
        letters = F.length(F.regexp_replace(t, r"[^\p{L}]", ""))
        ascii_letters = F.length(F.regexp_replace(t, r"[^A-Za-z]", ""))
        cleaned = cleaned.withColumn("n_words", F.size(F.split(t, " ")))
        lang_ok = (ascii_letters / F.greatest(letters, F.lit(1))) >= 0.85
        kept = cleaned.filter(lang_ok & (F.col("n_words") >= 3)).cache()
        n_lang = kept.count()
        s.metric("dropped_non_english_or_short", n_in - n_lang)
        s.metric("pii_redactions", int(cleaned.agg(F.sum("pii_hits")).first()[0] or 0))

        # Exact duplicates on normalised text within a workspace (keep the earliest).
        kept = kept.withColumn("norm", F.lower(F.regexp_replace(t, r"[^\w\s]", "")))
        w = Window.partitionBy("workspace", "norm").orderBy("created_at", "feedback_id")
        exact = kept.withColumn("rn", F.row_number().over(w)).filter("rn = 1").drop("rn").cache()
        n_exact = exact.count()
        s.metric("exact_duplicates", n_lang - n_exact)

        # Near duplicates: MinHash signatures -> LSH banding (group by band key, linear time) -> exact Jaccard
        # verification of candidate pairs inside small buckets. Avoids the quadratic blow-up of a self-join on
        # templated support tweets.
        long_items = exact.filter(F.col("n_words") >= 8).select("feedback_id", "workspace", "norm")
        tok = Tokenizer(inputCol="norm", outputCol="tokens").transform(long_items)
        tok = tok.withColumn("tokens", F.array_distinct("tokens"))
        feats = HashingTF(inputCol="tokens", outputCol="features", numFeatures=1 << 18, binary=True).transform(tok)
        feats = feats.filter(F.size("tokens") > 0)
        model = MinHashLSH(inputCol="features", outputCol="hashes", numHashTables=12, seed=7).fit(feats)
        sig = (model.transform(feats)
               .select("feedback_id", "workspace", "tokens", F.posexplode("hashes").alias("i", "v"))
               .withColumn("hv", vector_to_array("v")[0].cast("long"))
               .withColumn("band", (F.col("i") / 4).cast("int")))
        bands = (sig.groupBy("feedback_id", "workspace", "tokens", "band")
                 .agg(F.sort_array(F.collect_list(F.struct("i", "hv"))).alias("hs"))
                 .withColumn("key", F.concat_ws("-", F.expr("transform(hs, x -> cast(x.hv as string))"))))
        buckets = bands.groupBy("workspace", "band", "key").agg(F.collect_list(F.struct("feedback_id", "tokens")).alias("m"))
        buckets = buckets.filter((F.size("m") > 1) & (F.size("m") <= 60))
        pairs = (buckets.select("workspace", F.explode("m").alias("a"), "m").select("workspace", "a", F.explode("m").alias("b"))
                 .filter(F.col("a.feedback_id") < F.col("b.feedback_id"))
                 .withColumn("jac", F.size(F.array_intersect("a.tokens", "b.tokens")) / F.size(F.array_union("a.tokens", "b.tokens")))
                 .filter(F.col("jac") >= 0.8))
        near_dup_ids = pairs.select(F.col("b.feedback_id").alias("feedback_id")).distinct()
        n_near = near_dup_ids.count()
        s.metric("near_duplicates", n_near)
        s.metric("lsh", "MinHash 12 hashes, 3 bands x 4 rows, Jaccard >= 0.8 verified")
        deduped = exact.join(near_dup_ids, "feedback_id", "left_anti")

        # Cap per workspace with a uniform random sample (preserves the time distribution).
        counts = {r["workspace"]: r["count"] for r in deduped.groupBy("workspace").count().collect()}
        fractions = {ws: min(1.0, PER_WORKSPACE_CAP / c) for ws, c in counts.items()}
        capped = deduped.sampleBy("workspace", fractions, seed=42)
        out = capped.select("feedback_id", "workspace", "source", "text", "rating", "created_at", "author_hash", "thumbs_up", "n_words")
        out = out.repartition(8).cache()
        n_out = out.count()
        by_ws = {r["workspace"]: r["count"] for r in out.groupBy("workspace").count().collect()}
        s.metric("by_workspace", by_ws)
        s.metric("dedup_rate_pct", round(100 * (n_lang - n_exact + n_near) / max(n_lang, 1), 2))
        s.check("no_empty_text", out.filter(F.length("text") == 0).count() == 0, "0 empty")
        s.check("every_workspace_present", len(by_ws) == len(BRANDS) + 1, f"{len(by_ws)} workspaces")
        s.check("no_raw_emails_left", out.filter(F.col("text").rlike(EMAIL_RE)).count() == 0, "PII redacted")
        s.rows(n_in, n_out)
        out.write.mode("overwrite").parquet(str(LAKE / "silver" / "feedback"))

        # Stratified labelling sample for the LLM teacher (balanced over workspace, and rating for reviews).
        strat = out.withColumn("stratum", F.concat_ws("_", "workspace", F.coalesce(F.col("rating").cast("string"), F.lit("t"))))
        n_strata = strat.select("stratum").distinct().count()
        per = LABEL_SAMPLE // n_strata
        w2 = Window.partitionBy("stratum").orderBy(F.rand(13))
        sample = strat.filter((F.col("n_words") <= 120)).withColumn("rn", F.row_number().over(w2)).filter(F.col("rn") <= per)
        sample.drop("rn", "stratum").coalesce(1).write.mode("overwrite").parquet(str(LAKE / "silver" / "label_sample"))
        s.metric("label_sample", sample.count())


if __name__ == "__main__":
    spark = spark_session()
    spark.sparkContext.setLogLevel("WARN")
    import sys
    if "--skip-bronze" in sys.argv and (LAKE / "bronze" / "feedback").exists():
        b = spark.read.parquet(str(LAKE / "bronze" / "feedback"))
    else:
        b = bronze(spark)
    silver(spark, b)
    spark.stop()
