"""EchoLens GPU enrichment job — runs as a Kaggle kernel (GPU).

A. Distil the Groq teacher into a small multi-task student (ModernBERT): sentiment, intent, urgency and
   aspect-category sentiment (14 aspects x {none, pos, neu, neg}). Evaluate vs a TF-IDF+LR baseline.
B. Sanity-check the same architecture on a public human-labelled benchmark (SemEval-2014 restaurants ACSA).
C. Run the student over the whole silver corpus.
D. Embed every item with bge-small-en-v1.5.
E. Per workspace: UMAP(5d) + HDBSCAN themes, UMAP(3d) for the galaxy view, clustering metrics vs KMeans.

Input dataset: <user>/echolens-inputs  (silver.parquet, teacher_labels.jsonl, Restaurants_Train_v2.xml)
Output: /kaggle/working/out/*
"""
import glob
import json
import os
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

if not os.getenv("ECHOLENS_IN"):
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", "umap-learn", "sentence-transformers>=3", "transformers>=4.48"], check=False)

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score, silhouette_score
from sklearn.cluster import HDBSCAN, KMeans
from transformers import AutoModel, AutoTokenizer

T0 = time.time()
SMOKE = os.getenv("ECHOLENS_SMOKE") == "1"          # tiny local CPU run to catch bugs before using GPU quota
IN = os.getenv("ECHOLENS_IN") or os.path.dirname(glob.glob("/kaggle/input/**/silver.parquet", recursive=True)[0])
OUT = os.getenv("ECHOLENS_OUT", "/kaggle/working/out")
os.makedirs(OUT, exist_ok=True)
DEV = "cuda" if torch.cuda.is_available() else "cpu"
torch.manual_seed(0)
np.random.seed(0)
log = lambda *a: print(f"[{time.time() - T0:7.1f}s]", *a, flush=True)
log("device", DEV, torch.cuda.get_device_name(0) if DEV == "cuda" else "")

SENT = ["negative", "neutral", "positive"]
INTENTS = ["complaint", "bug_report", "feature_request", "question", "praise", "churn_risk"]
URG = ["low", "medium", "high", "critical"]
ASPECTS = ["performance_reliability", "bugs_errors", "ui_ux", "pricing_billing", "account_access", "customer_service",
           "delivery_logistics", "ads", "content_catalog", "connectivity_devices", "features", "privacy_security", "updates", "other"]
ASP_CLS = ["none", "negative", "neutral", "positive"]
BASE = "answerdotai/ModernBERT-base"
MAXLEN = 128
METRICS = {"timings": {}}


# ------------------------------------------------------------------ model
class MultiTask(nn.Module):
    def __init__(self, base, n_aspects, n_asp_cls, heads):
        super().__init__()
        self.enc = AutoModel.from_pretrained(base)
        h = self.enc.config.hidden_size
        self.drop = nn.Dropout(0.1)
        self.heads = nn.ModuleDict({k: nn.Linear(h, n) for k, n in heads.items()})
        self.aspect = nn.Linear(h, n_aspects * n_asp_cls) if n_aspects else None
        self.n_aspects, self.n_asp_cls = n_aspects, n_asp_cls

    def forward(self, ids, mask):
        hs = self.enc(input_ids=ids, attention_mask=mask).last_hidden_state
        pooled = (hs * mask.unsqueeze(-1)).sum(1) / mask.sum(1, keepdim=True)   # mean pooling
        pooled = self.drop(pooled)
        out = {k: head(pooled) for k, head in self.heads.items()}
        if self.aspect is not None:
            out["aspects"] = self.aspect(pooled).view(-1, self.n_aspects, self.n_asp_cls)
        return out


def encode(tok, texts):
    return tok(list(texts), truncation=True, max_length=MAXLEN, padding=True, return_tensors="pt")


def train_model(tok, texts, targets, heads, n_aspects, n_asp_cls, epochs=4, lr=4e-5, bs=32, asp_weight=None):
    model = MultiTask(BASE, n_aspects, n_asp_cls, heads).to(DEV)
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=0.01)
    steps = epochs * ((len(texts) + bs - 1) // bs)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=lr, total_steps=steps, pct_start=0.1)
    scaler = torch.amp.GradScaler(enabled=DEV == "cuda")
    ce = nn.CrossEntropyLoss()
    ce_asp = nn.CrossEntropyLoss(weight=asp_weight.to(DEV) if asp_weight is not None else None)
    idx = np.arange(len(texts))
    for ep in range(epochs):
        np.random.shuffle(idx)
        model.train()
        tot = 0.0
        for s in range(0, len(idx), bs):
            b = idx[s : s + bs]
            enc = encode(tok, [texts[i] for i in b])
            with torch.autocast(DEV, dtype=torch.float16, enabled=DEV == "cuda"):
                out = model(enc["input_ids"].to(DEV), enc["attention_mask"].to(DEV))
                loss = sum(ce(out[k].float(), torch.tensor(targets[k][b]).to(DEV)) for k in heads)
                if n_aspects:
                    loss = loss + 2.0 * ce_asp(out["aspects"].float().reshape(-1, n_asp_cls), torch.tensor(targets["aspects"][b]).reshape(-1).to(DEV))
            opt.zero_grad()
            scaler.scale(loss).backward()
            scaler.unscale_(opt)
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            scaler.step(opt)
            scaler.update()
            sched.step()
            tot += loss.item()
        log(f"  epoch {ep + 1}/{epochs} loss {tot / max(1, len(idx) // bs):.4f}")
    return model


@torch.no_grad()
def predict(model, tok, texts, heads, bs=256):
    model.eval()
    res = {k: [] for k in heads}
    probs = {k: [] for k in heads}
    asp = []
    order = np.argsort([len(t) for t in texts])           # length-bucketing for speed
    for s in range(0, len(texts), bs):
        b = order[s : s + bs]
        enc = encode(tok, [texts[i] for i in b])
        with torch.autocast(DEV, dtype=torch.float16, enabled=DEV == "cuda"):
            out = model(enc["input_ids"].to(DEV), enc["attention_mask"].to(DEV))
        for k in heads:
            p = out[k].float().softmax(-1).cpu().numpy()
            probs[k].append(p)
        if model.aspect is not None:
            asp.append(out["aspects"].float().softmax(-1).cpu().numpy())
    inv = np.argsort(order)
    probs = {k: np.concatenate(v)[inv] for k, v in probs.items()}
    asp = np.concatenate(asp)[inv] if asp else None
    return probs, asp


def cls_report(task, y_true, y_pred, labels, baseline_pred=None):
    rep = classification_report(y_true, y_pred, labels=list(range(len(labels))), target_names=labels, output_dict=True, zero_division=0)
    row = {
        "task": task,
        "macro_f1": f1_score(y_true, y_pred, average="macro", labels=list(range(len(labels))), zero_division=0),
        "accuracy": accuracy_score(y_true, y_pred),
        "per_class": [{"label": l, "precision": rep[l]["precision"], "recall": rep[l]["recall"], "f1": rep[l]["f1-score"], "support": int(rep[l]["support"])} for l in labels],
        "confusion": {"labels": labels, "matrix": confusion_matrix(y_true, y_pred, labels=list(range(len(labels)))).tolist()},
    }
    if baseline_pred is not None:
        row["baseline_macro_f1"] = f1_score(y_true, baseline_pred, average="macro", labels=list(range(len(labels))), zero_division=0)
        row["baseline_accuracy"] = accuracy_score(y_true, baseline_pred)
    log(f"  {task}: macroF1={row['macro_f1']:.3f} acc={row['accuracy']:.3f} baseline={row.get('baseline_macro_f1', 0):.3f}")
    return row


def aspect_metrics(true_mat, pred_mat):
    """true/pred: (n, n_aspects) class ids, 0 = none. Detection F1 (aspect present) + joint aspect-sentiment F1."""
    tp = ((true_mat > 0) & (pred_mat > 0)).sum(); fp = ((true_mat == 0) & (pred_mat > 0)).sum(); fn = ((true_mat > 0) & (pred_mat == 0)).sum()
    det_p, det_r = tp / max(tp + fp, 1), tp / max(tp + fn, 1)
    jtp = ((true_mat > 0) & (pred_mat == true_mat)).sum()
    j_p, j_r = jtp / max((pred_mat > 0).sum(), 1), jtp / max((true_mat > 0).sum(), 1)
    pol_acc = jtp / max(tp, 1)   # polarity accuracy on correctly detected aspects
    f = lambda p, r: 2 * p * r / max(p + r, 1e-9)
    return {"detection_f1": float(f(det_p, det_r)), "joint_f1": float(f(j_p, j_r)), "polarity_acc_on_detected": float(pol_acc)}


tok = AutoTokenizer.from_pretrained(BASE)

# ------------------------------------------------------------------ A. student on teacher labels
t = time.time()
lab = pd.read_json(os.path.join(IN, "teacher_labels.jsonl"), lines=True)
lab = lab.drop_duplicates("feedback_id").reset_index(drop=True)
if SMOKE:
    lab = pd.concat([lab[lab.split == "test"].head(40), lab[lab.split != "test"].head(160)]).reset_index(drop=True)
is_test = (lab["split"] == "test").values   # test set = items labelled by the strongest teacher (gpt-oss-120b)
y = {
    "sentiment": lab.sentiment.map(SENT.index).values,
    "intent": lab.intent.map(INTENTS.index).values,
    "urgency": lab.urgency.map(URG.index).values,
}
amat = np.zeros((len(lab), len(ASPECTS)), dtype=np.int64)
for i, al in enumerate(lab.aspects):
    for a in al:
        amat[i, ASPECTS.index(a["a"])] = ASP_CLS.index(a["s"])
y["aspects"] = amat
texts = lab.text.tolist()
tr = np.where(~is_test)[0]; te = np.where(is_test)[0]
log(f"teacher labels: {len(lab)} train={len(tr)} test={len(te)}")

heads = {"sentiment": 3, "intent": 6, "urgency": 4}
asp_w = torch.tensor([0.3, 1.0, 1.0, 1.0])
student = train_model(tok, [texts[i] for i in tr], {k: v[tr] for k, v in y.items()}, heads, len(ASPECTS), 4, epochs=1 if SMOKE else 5, asp_weight=asp_w)
probs, asp = predict(student, tok, [texts[i] for i in te], heads)

# Baseline: TF-IDF + logistic regression per task (classic, strong for short text)
vec = TfidfVectorizer(ngram_range=(1, 2), min_df=2, sublinear_tf=True).fit([texts[i] for i in tr])
Xtr, Xte = vec.transform([texts[i] for i in tr]), vec.transform([texts[i] for i in te])
results = []
for k, labels in [("sentiment", SENT), ("intent", INTENTS), ("urgency", URG)]:
    base = LogisticRegression(max_iter=2000, class_weight="balanced").fit(Xtr, y[k][tr]).predict(Xte)
    results.append(cls_report(k, y[k][te], probs[k].argmax(-1), labels, base))
asp_pred = asp.argmax(-1)
# aspect baseline: one LR per aspect
base_asp = np.zeros_like(y["aspects"][te])
for j in range(len(ASPECTS)):
    yj = y["aspects"][tr][:, j]
    if len(set(yj)) > 1:
        base_asp[:, j] = LogisticRegression(max_iter=2000, class_weight="balanced").fit(Xtr, yj).predict(Xte)
am = aspect_metrics(y["aspects"][te], asp_pred)
am_base = aspect_metrics(y["aspects"][te], base_asp)
log("  aspects:", am, "baseline:", am_base)
METRICS["student"] = {"base_model": BASE, "n_train": int(len(tr)), "n_test": int(len(te)), "tasks": results, "aspects": am, "aspects_baseline": am_base}
METRICS["timings"]["train_student_s"] = round(time.time() - t, 1)
# Test-set predictions are saved so the local eval can compare with a zero-shot LLM baseline on the same items.
pd.DataFrame({"feedback_id": lab.feedback_id.values[te], **{f"pred_{k}": probs[k].argmax(-1) for k in heads}}).to_parquet(f"{OUT}/student_test_preds.parquet")

# ------------------------------------------------------------------ B. SemEval-2014 restaurants ACSA
t = time.time()
root = ET.parse(os.path.join(IN, "Restaurants_Train_v2.xml")).getroot()
CATS = ["food", "service", "price", "ambience", "anecdotes/miscellaneous"]
POL = ["none", "negative", "neutral", "positive", "conflict"]
s_texts, s_mat = [], []
for sen in root.iter("sentence"):
    s_texts.append(sen.find("text").text)
    row = [0] * len(CATS)
    for c in sen.iter("aspectCategory"):
        row[CATS.index(c.get("category"))] = POL.index(c.get("polarity"))
    s_mat.append(row)
s_mat = np.array(s_mat)
if SMOKE:
    s_texts, s_mat = s_texts[:200], s_mat[:200]
s_test = np.random.RandomState(7).rand(len(s_texts)) < 0.15
str_, ste = np.where(~s_test)[0], np.where(s_test)[0]
sem = train_model(tok, [s_texts[i] for i in str_], {"aspects": s_mat[str_]}, {}, len(CATS), len(POL), epochs=1 if SMOKE else 6, asp_weight=torch.tensor([0.3, 1, 1, 1, 1.0]))
_, sem_asp = predict(sem, tok, [s_texts[i] for i in ste], {})
sem_m = aspect_metrics(s_mat[ste], sem_asp.argmax(-1))
log("  semeval ACSA:", sem_m)
METRICS["semeval_acsa"] = {"dataset": "SemEval-2014 Task 4 Restaurants (official train, 15% held-out)", "n_train": int(len(str_)), "n_test": int(len(ste)), **sem_m}
METRICS["timings"]["semeval_s"] = round(time.time() - t, 1)
del sem
torch.cuda.empty_cache()

# ------------------------------------------------------------------ C. bulk inference with the student
t = time.time()
silver = pd.read_parquet(os.path.join(IN, "silver.parquet"))
if SMOKE:
    silver = silver.groupby("workspace").head(700).reset_index(drop=True)
all_texts = silver.text.tolist()
P, A = predict(student, tok, all_texts, heads, bs=512)
silver["sentiment"] = [SENT[i] for i in P["sentiment"].argmax(-1)]
silver["sentiment_score"] = (P["sentiment"][:, 2] - P["sentiment"][:, 0]).round(4)
silver["sentiment_conf"] = P["sentiment"].max(-1).round(4)
silver["intent"] = [INTENTS[i] for i in P["intent"].argmax(-1)]
silver["urgency"] = [URG[i] for i in P["urgency"].argmax(-1)]
silver["urgency_score"] = (P["urgency"] @ np.array([0, 0.33, 0.66, 1.0])).round(4)
amax = A.argmax(-1)
silver["aspects"] = [json.dumps([{"aspect": ASPECTS[j], "sentiment": ASP_CLS[c]} for j, c in enumerate(row) if c > 0]) for row in amax]
n_per_s = len(all_texts) / (time.time() - t)
METRICS["timings"]["student_inference_s"] = round(time.time() - t, 1)
METRICS["student"]["throughput_items_per_s"] = round(n_per_s, 1)
log(f"bulk inference on {len(all_texts)} items: {n_per_s:.0f} items/s")
torch.save(student.state_dict(), f"{OUT}/student.pt")
del student
torch.cuda.empty_cache()

# ------------------------------------------------------------------ D. embeddings
from sentence_transformers import SentenceTransformer

t = time.time()
emb_model = SentenceTransformer("BAAI/bge-small-en-v1.5", device=DEV)
emb = emb_model.encode(all_texts, batch_size=512, normalize_embeddings=True, show_progress_bar=False, convert_to_numpy=True).astype(np.float32)
METRICS["timings"]["embedding_s"] = round(time.time() - t, 1)
log(f"embeddings {emb.shape} in {time.time() - t:.0f}s")

# ------------------------------------------------------------------ E. clustering per workspace
import umap

t = time.time()
silver["cluster"] = -1
silver["cluster_prob"] = 0.0
galaxy = []
clust_metrics = {}
for ws, g in silver.groupby("workspace"):
    ix = g.index.values
    X = emb[ix]
    red = umap.UMAP(n_components=5, n_neighbors=15, min_dist=0.0, metric="cosine", random_state=42, low_memory=True).fit_transform(X)
    mcs = max(40, len(ix) // 300)
    hd = HDBSCAN(min_cluster_size=mcs, min_samples=10, cluster_selection_method="eom").fit(red)
    labels = hd.labels_.copy()
    # Soft-assign noise to the nearest cluster centroid in embedding space when similar enough.
    k = labels.max() + 1
    cents = np.stack([X[labels == c].mean(0) for c in range(k)])
    cents /= np.linalg.norm(cents, axis=1, keepdims=True)
    noise = np.where(labels == -1)[0]
    noise_before = len(noise) / len(ix)
    if len(noise):
        sims = X[noise] @ cents.T
        best = sims.argmax(1)
        ok = sims.max(1) >= 0.80
        labels[noise[ok]] = best[ok]
    silver.loc[ix, "cluster"] = labels
    silver.loc[ix, "cluster_prob"] = np.where(hd.labels_ >= 0, hd.probabilities_, 0.0)
    m = labels >= 0
    samp = np.random.RandomState(0).choice(np.where(m)[0], size=min(8000, m.sum()), replace=False)
    sil = silhouette_score(red[samp], labels[samp])
    km = KMeans(n_clusters=k, n_init=3, random_state=0).fit(red)
    sil_km = silhouette_score(red[samp], km.labels_[samp])
    sil_emb = silhouette_score(X[samp], labels[samp], metric="cosine")
    clust_metrics[ws] = {"n": int(len(ix)), "clusters": int(k), "noise_before_reassign": round(noise_before, 4),
                         "noise_after_reassign": round(float((labels == -1).mean()), 4), "silhouette_umap": float(sil),
                         "silhouette_kmeans_same_k": float(sil_km), "silhouette_embedding_cosine": float(sil_emb)}
    log(f"  {ws}: n={len(ix)} k={k} noise {noise_before:.2f}->{(labels == -1).mean():.2f} sil={sil:.3f} (kmeans {sil_km:.3f})")
    # 3D projection for the galaxy view (sample)
    gs = np.random.RandomState(1).choice(len(ix), size=min(6000, len(ix)), replace=False)
    xyz = umap.UMAP(n_components=3, n_neighbors=20, min_dist=0.1, metric="cosine", random_state=42).fit_transform(X[gs])
    xyz = (xyz - xyz.mean(0)) / xyz.std(0)
    galaxy.append(pd.DataFrame({"feedback_id": g.feedback_id.values[gs], "workspace": ws, "x": xyz[:, 0], "y": xyz[:, 1], "z": xyz[:, 2]}))
METRICS["clustering"] = clust_metrics
METRICS["timings"]["clustering_s"] = round(time.time() - t, 1)

silver.to_parquet(f"{OUT}/enriched.parquet", index=False, coerce_timestamps="us", allow_truncated_timestamps=True)
pd.concat(galaxy).to_parquet(f"{OUT}/galaxy.parquet", index=False)
np.save(f"{OUT}/embeddings.npy", emb.astype(np.float16))
silver[["feedback_id"]].to_parquet(f"{OUT}/embedding_ids.parquet", index=False)
METRICS["total_runtime_s"] = round(time.time() - T0, 1)
METRICS["gpu"] = torch.cuda.get_device_name(0) if DEV == "cuda" else "cpu"
json.dump(METRICS, open(f"{OUT}/metrics.json", "w"), indent=2, default=float)
log("done")
