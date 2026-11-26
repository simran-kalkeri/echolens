# EchoLens — Evaluation Report

_Generated 2026-11-24T20:23:47 UTC by `python -m eval.run_eval`_

## Headline

| Metric | Value | Baseline | Threshold | Pass |
|---|---|---|---|---|
| Sentiment macro-F1 | 0.817 | 0.696 (TF-IDF + LogReg) | 0.780 | ✅ |
| Intent macro-F1 | 0.624 | 0.582 (TF-IDF + LogReg) | 0.590 | ✅ |
| Urgency macro-F1 | 0.497 | 0.439 (TF-IDF + LogReg) | 0.470 | ✅ |
| Aspect-sentiment joint F1 | 0.558 | 0.471 (TF-IDF + LogReg) |  |  |
| SemEval-14 category F1 | 0.849 |  | 0.820 | ✅ |
| Retrieval Recall@10 | 0.493 |  | 0.450 | ✅ |
| Incident recall | 0.667 |  | 0.600 | ✅ |
| Insight groundedness | 0.686 |  | 0.650 | ✅ |

## Classification — sentiment
_Teacher-labelled test set (gpt-oss-120b, n=599)_

| Metric | Value | Baseline | Threshold | Pass |
|---|---|---|---|---|
| Macro-F1 (student) | 0.817 | 0.696 (TF-IDF + LogReg) | 0.780 | ✅ |
| Accuracy (student) | 0.878 | 0.775 (TF-IDF + LogReg) |  |  |
| Macro-F1 on LLM subset (n=240): student vs zero-shot gpt-oss-20b + qwen3.8-27b | 0.817 | 0.824 (zero-shot LLM) |  |  |

## Classification — intent
_Teacher-labelled test set (gpt-oss-120b, n=599)_

| Metric | Value | Baseline | Threshold | Pass |
|---|---|---|---|---|
| Macro-F1 (student) | 0.624 | 0.582 (TF-IDF + LogReg) | 0.590 | ✅ |
| Accuracy (student) | 0.751 | 0.668 (TF-IDF + LogReg) |  |  |
| Macro-F1 on LLM subset (n=240): student vs zero-shot gpt-oss-20b + qwen3.8-27b | 0.579 | 0.692 (zero-shot LLM) |  |  |

## Classification — urgency
_Teacher-labelled test set (gpt-oss-120b, n=599)_

| Metric | Value | Baseline | Threshold | Pass |
|---|---|---|---|---|
| Macro-F1 (student) | 0.497 | 0.439 (TF-IDF + LogReg) | 0.470 | ✅ |
| Accuracy (student) | 0.678 | 0.608 (TF-IDF + LogReg) |  |  |
| Macro-F1 on LLM subset (n=240): student vs zero-shot gpt-oss-20b + qwen3.8-27b | 0.493 | 0.529 (zero-shot LLM) |  |  |

## Classification — aspects
_Teacher-labelled test set (14 aspect categories x sentiment)_

| Metric | Value | Baseline | Threshold | Pass |
|---|---|---|---|---|
| Aspect detection F1 | 0.592 | 0.548 (TF-IDF + LogReg) | 0.560 | ✅ |
| Joint aspect-sentiment F1 | 0.558 | 0.471 (TF-IDF + LogReg) |  |  |
| Polarity accuracy on detected aspects | 0.942 |  |  |  |

## Classification — semeval_acsa
_SemEval-2014 Task 4 Restaurants (official train, 15% held-out) (n_test=476)_

| Metric | Value | Baseline | Threshold | Pass |
|---|---|---|---|---|
| Aspect-category detection F1 | 0.849 |  | 0.820 | ✅ |
| Joint category-polarity F1 | 0.674 |  |  |  |
| Polarity accuracy on detected categories | 0.794 |  |  |  |

## Clustering

| Metric | Value | Baseline | Threshold | Pass |
|---|---|---|---|---|
| Silhouette, HDBSCAN on UMAP (mean over workspaces) | 0.281 | 0.426 (KMeans, same k) | 0.250 | ✅ |
| Silhouette in original embedding space (cosine) | 0.036 |  |  |  |
| Noise share after soft reassignment | 0.068 |  |  |  |
| Themes discovered | 291.000 |  |  |  |
| NPMI topic coherence (mean) | 0.111 |  | 0.080 | ✅ |

## Retrieval

| Metric | Value | Baseline | Threshold | Pass |
|---|---|---|---|---|
| Recall@10 (hybrid + rerank) | 0.493 | 0.467 (dense only) | 0.450 | ✅ |
| nDCG@10 (hybrid + rerank) | 0.428 | 0.453 (dense only) |  |  |
| MRR (hybrid + rerank) | 0.335 | 0.326 (dense only) |  |  |
| Latency per query (hybrid + rerank) | 1347.066 ms |  |  |  |
| Queries evaluated | 150.000 |  |  |  |

## Emerging-issue detection

| Metric | Value | Baseline | Threshold | Pass |
|---|---|---|---|---|
| Incident recall (injected spikes) | 0.667 | 0.633 (2x-mean threshold) | 0.600 | ✅ |
| Mean detection delay | 0.550 days | 0.421 (2x-mean threshold) |  |  |
| False-alert rate per theme-day (null series) | 0.001 | 0.001 (2x-mean threshold) | 0.010 | ✅ |
| Recall for 1.5x incidents | 0.100 | 0.000 (2x-mean threshold) |  |  |
| Recall for 2x incidents | 0.833 | 0.833 (2x-mean threshold) |  |  |
| Recall for 3x incidents | 1.000 | 1.000 (2x-mean threshold) |  |  |
| Recall for 5x incidents | 1.000 | 1.000 (2x-mean threshold) |  |  |

## Grounding (AI analyst)

| Metric | Value | Baseline | Threshold | Pass |
|---|---|---|---|---|
| Groundedness of LLM-written artifacts (claims supported by cited feedback) | 0.686 |  | 0.650 | ✅ |
| Insight cards with >= 1 valid citation | 1.000 |  | 0.900 | ✅ |
| Theme/alert summaries with >= 1 valid citation | 0.875 |  |  |  |
| LLM artifacts verified | 96.000 |  |  |  |
| Live analyst questions evaluated (stopped: free-tier daily LLM cap) | 0.000 |  |  |  |

## Cost & efficiency

| Metric | Value | Baseline | Threshold | Pass |
|---|---|---|---|---|
| Student throughput (GPU) | 520.900 items/s |  |  |  |
| Corpus enriched by the student | 208593.000 items |  |  |  |
| Items labelled by the LLM teacher | 3586.000 items |  |  |  |
| Share of corpus needing an LLM call | 0.017 ratio |  |  |  |
| LLM tokens used in evaluation run | 2323.000 tokens |  |  |  |

### Retrieval by method

| Method | Recall@10 | nDCG@10 | MRR |
|---|---|---|---|
| bm25 | 0.353 | 0.316 | 0.214 |
| dense | 0.467 | 0.453 | 0.326 |
| hybrid | 0.447 | 0.416 | 0.314 |
| hybrid_rerank | 0.493 | 0.428 | 0.335 |
