# EchoLens

**Customer feedback intelligence with traceable, evidence-backed AI insights.**

[![Backend checks](https://github.com/simran-kalkeri/echolens/actions/workflows/backend-checks.yml/badge.svg)](https://github.com/simran-kalkeri/echolens/actions/workflows/backend-checks.yml)
[![Pages deployment](https://github.com/simran-kalkeri/echolens/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/simran-kalkeri/echolens/actions/workflows/deploy-pages.yml)
[![Frontend version](https://img.shields.io/badge/frontend-v0.1.0-blue)](web/package.json)
[![License](https://img.shields.io/badge/license-not%20specified-lightgrey)](#license)

EchoLens turns app reviews, support conversations, and survey responses into actionable product insights. It helps teams find recurring problems, understand sentiment, detect emerging issues, and ask questions whose answers link back to customer feedback.

Built as a portfolio project for the Enterpret ML internship, it combines a reproducible ML pipeline, an interactive dashboard, and a live AI analyst. The deployed dataset contains **207,552 processed feedback records across six workspaces**. Source data is historical; survey examples are synthetic and labeled accordingly.

## Live Links

| Resource | Link |
| --- | --- |
| Frontend | [EchoLens dashboard](https://simran-kalkeri.github.io/echolens/) |
| Backend | [API readiness and dataset status](https://echolens-api-0ok3.onrender.com/api/ready) |
| API documentation | [Swagger UI](https://echolens-api-0ok3.onrender.com/docs) |
| API schema | [OpenAPI JSON](https://echolens-api-0ok3.onrender.com/openapi.json) |

**Backend base URL:** `https://echolens-api-0ok3.onrender.com`

The frontend runs on GitHub Pages and connects to the live FastAPI service on Render's **Free** plan. The backend may take about a minute to wake after inactivity. The hosted profile uses **BM25 keyword search** to fit the 512 MB memory limit; the full pipeline also supports dense, hybrid, and cross-encoder-reranked retrieval.

## Table of Contents

- [Features](#features)
- [Demo and Screenshots](#demo-and-screenshots)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Installation and Setup](#installation-and-setup)
- [Usage](#usage)
- [API Documentation](#api-documentation)
- [Guardrails and Usage Limits](#guardrails-and-usage-limits)
- [Testing](#testing)
- [Evaluation and Limitations](#evaluation-and-limitations)
- [Deployment](#deployment)
- [Contributing](#contributing)
- [Roadmap](#roadmap)
- [License](#license)
- [Contact and Author](#contact-and-author)

## Features

- **Feedback enrichment:** predict sentiment, intent, urgency, and aspect-level sentiment using a distilled multi-task student model.
- **Theme discovery:** organize feedback into fixed aspect categories and discovered, LLM-named themes.
- **Emerging-issue detection:** identify spikes and growing themes against trailing historical baselines.
- **Live AI analyst:** retrieve evidence, inspect metrics, stream cited answers, and score claim support.
- **Feedback exploration:** search and filter by workspace, theme, source, sentiment, intent, and urgency.
- **Interactive visualizations:** explore a knowledge graph, a 3D embedding galaxy, sentiment trends, and theme flows.
- **Reproducible evaluation:** compare models with baselines and enforce recorded regression thresholds.

Nine dashboard views cover Overview, Themes, Emerging Issues, AI Analyst, Feedback Explorer, Knowledge Graph, Embedding Galaxy, Pipeline, and Evaluation. Workspaces include Spotify, Apple, Amazon, Uber, Delta Air Lines, and Xbox.

## Demo and Screenshots

[Launch the live demo](https://simran-kalkeri.github.io/echolens/). Start with Spotify, open a theme to inspect its evidence, then ask the analyst a question such as “Why are users complaining about shuffle?”

> **Screenshot placeholder:** Add overview, theme explorer, and live analyst screenshots here. Store approved images under `docs/screenshots/` before embedding them.

## Tech Stack

| Area | Technologies |
| --- | --- |
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS 4, Radix UI, TanStack Query, Zustand |
| Visualization | ECharts, Sigma.js, React Three Fiber, React Flow, GSAP |
| Backend | Python 3.11, FastAPI, Uvicorn, Pydantic, HTTPX |
| Database and storage | DuckDB over Parquet, precomputed JSON artifacts, NumPy embedding shards |
| ML and analytics | PySpark, ModernBERT, bge-small embeddings, UMAP, HDBSCAN, BM25, cross-encoder reranking, NetworkX |
| AI provider | Groq with GPT-OSS models, tool calling, and claim verification |
| Tools and DevOps | Docker, Docker Compose, GitHub Actions, GitHub Pages, Render Blueprints, Kaggle GPU jobs |

### Architecture

The offline pipeline ingests and cleans feedback, trains and applies models, discovers themes, and produces serving artifacts. FastAPI queries those artifacts; the dashboard and analyst consume its API.

![EchoLens high-level architecture](architectures/exports/01-high-level-architecture.png)

See [architecture diagrams](architectures/README.md) for editable Excalidraw scenes and detailed workflows.

## Project Structure

```text
echolens/
├── web/                         # Next.js dashboard and API client
├── api/                         # FastAPI routes, DuckDB access, request limits
├── analyst/                     # Groq client, tool loop, citation verification
├── retrieval/                   # BM25, dense, hybrid, and reranked search
├── pipeline/                    # Ingestion, Spark jobs, serving-artifact generation
├── ml/                          # Teacher labeling, student training, theme discovery
├── eval/                        # Evaluation scripts and regression thresholds
├── data/                        # Prebuilt lake tables, indexes, serving JSON, labels
├── tests/                       # API, analyst, guardrail, and regression tests
├── architectures/               # Architecture sources and exported diagrams
├── docs/                        # API contract and evaluation report
├── infra/                       # API, frontend, and Spark Dockerfiles
├── .github/workflows/            # Backend checks and Pages deployment
├── requirements-api-base.txt    # API and BM25 dependencies
├── requirements-api.txt         # Base API plus embedding/reranking dependencies
├── requirements-pipeline.txt    # Pipeline and evaluation dependencies
├── docker-compose.yml           # Local serving stack
└── render.yaml                  # Free-plan backend deployment configuration
```

Prebuilt gold/theme tables, search shards, serving JSON, teacher labels, run logs, and the LLM response cache are included. Raw datasets, bronze/silver tables, student checkpoints, and full Kaggle outputs are excluded and rebuilt through the pipeline.

## Installation and Setup

### Prerequisites

- Python **3.11** and Node.js **22** with npm.
- A Groq API key to enable the live analyst; browsing the processed dataset does not require one.
- Docker for the optional container setup and Spark jobs.
- Kaggle credentials and GPU access only if rebuilding the ML pipeline.

Shell examples below use Bash. On Windows, Git Bash can run the shell examples; PowerShell users can use the activation command noted below.

### 1. Clone the repository

```bash
git clone https://github.com/simran-kalkeri/echolens.git
cd echolens
```

### 2. Set up the backend

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-api-base.txt pytest
cp .env.example .env
```

On Windows, create the environment with `py -3.11 -m venv .venv` and activate it with `.\.venv\Scripts\Activate.ps1`.

Configure the root `.env` for the lightweight, hosted search profile:

```dotenv
GROQ_API_KEY=
RETRIEVAL_METHOD=bm25
ECHOLENS_LOW_MEMORY=true
DUCKDB_MEMORY_LIMIT=96MB
DUCKDB_THREADS=1
```

Set `GROQ_API_KEY` to your own key for live AI requests. Keep `.env` out of Git. Start the API from the repository root:

```bash
uvicorn api.main:app --host 0.0.0.0 --port 8000
```

Local API documentation: [http://localhost:8000/docs](http://localhost:8000/docs).

### 3. Set up the frontend

In a second terminal, from the repository root:

```bash
cd web
npm ci
cp .env.example .env.local
```

Set `web/.env.local` to:

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:8000
```

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Leaving `NEXT_PUBLIC_API_URL` unset enables built-in sample data and a simulated analyst. Never place a Groq key in a `NEXT_PUBLIC_*` variable.

### Optional setups

- **Docker:** after configuring the root `.env`, run `docker compose up --build` from the repository root. The dashboard uses port 3000 and the API uses port 8000. The default API image preloads embedding/reranking models during its build.
- **Full retrieval:** install `requirements-api.txt` and set `RETRIEVAL_METHOD=hybrid_rerank`. Model assets download on first use outside the prewarmed Docker image.
- **Pipeline rebuild:** install `requirements-pipeline.txt`, configure Kaggle access, then run:

```bash
docker build -t echolens-spark -f infra/spark.Dockerfile infra
python -m pipeline.cli all
```

The bundled artifacts support local serving without rerunning ingestion or training.

## Usage

1. Select a workspace and inspect its sentiment, themes, and alerts.
2. Open a theme or citation to inspect supporting feedback.
3. Use the explorer to search feedback and apply filters.
4. Ask the live analyst a product question and review its citations and claim-support score.

For API access, substitute the local or deployed base URL:

```bash
API_BASE=https://echolens-api-0ok3.onrender.com
curl --fail "$API_BASE/api/health"
curl --fail "$API_BASE/api/feedback?ws=spotify&q=shuffle&page_size=5"
```

## API Documentation

[Swagger UI](https://echolens-api-0ok3.onrender.com/docs) documents request schemas and responses. The [TypeScript API contract](docs/api-contract.ts) defines shared frontend types.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Process health |
| GET | `/api/ready` | Dataset readiness, record count, and analyst configuration status |
| GET | `/api/workspaces` | Available workspaces and record counts |
| GET | `/api/overview?ws=spotify` | KPIs and time-series summaries |
| GET | `/api/themes?ws=spotify` | Theme taxonomy |
| GET | `/api/themes/{theme_id}?ws=spotify` | Theme details and supporting feedback |
| GET | `/api/alerts?ws=spotify` | Detected emerging issues |
| GET | `/api/feedback?ws=spotify&q=shuffle` | Search, filters, and pagination |
| GET | `/api/graph?ws=spotify` | Knowledge graph |
| GET | `/api/galaxy?ws=spotify` | Precomputed embedding visualization |
| GET | `/api/insights?ws=spotify` | Precomputed cited insights |
| GET | `/api/pipeline`, `/api/eval` | Recorded pipeline and evaluation results |
| POST | `/api/analyst/ask` | Live analyst response as Server-Sent Events |

### Health response

```http
GET /api/health
```

```json
{"ok": true}
```

### Analyst request and stream

```bash
curl --no-buffer "$API_BASE/api/analyst/ask" \
  -H "Content-Type: application/json" \
  -d '{"ws":"spotify","question":"Why are users complaining about shuffle?"}'
```

The POST response is `text/event-stream`, with events such as:

```text
data: {"type":"status","text":"Planning analysis"}

data: {"type":"token","text":"Users "}
```

The final event includes `answer`, `citations`, `claims`, and `groundedness`. A streamed `error` event indicates an incomplete answer. Validation, quota, and configuration errors can instead return an HTTP error before streaming starts.

## Guardrails and Usage Limits

These are the defaults for the deployed public analyst:

| Control | Behavior |
| --- | --- |
| Server-side credentials | The Groq key stays in Render environment secrets and the ignored local `.env`; it is excluded from Git, Docker build context, and frontend configuration. |
| Per-client quota | **3 admitted questions per rolling 15 minutes**, based on client IP identity. |
| Global quota | **20 admitted questions per rolling 24 hours**, across all clients in the running instance. |
| Concurrency | **One active analyst request** at a time. Quota and busy rejections return HTTP `429` with `Retry-After`. |
| Input validation | Questions must contain text and be at most **800 characters**; analyst request bodies are capped at **4 KiB**. Workspace IDs are validated. |
| Upstream budget | A **90-second budget**, checked before upstream calls, and at most **6 LLM attempts** shared across generation, retries, fallbacks, and claim verification. |
| Bounded tool use | Live analysis uses at most **3 tool rounds**, with at most **2 tool calls per round**, over scoped, read-only feedback tools. |
| Browser-origin policy | The hosted API allows the GitHub Pages frontend origin: `https://simran-kalkeri.github.io`. |
| Evidence and error handling | Unknown citation IDs are removed, claims receive support checks, and public stream errors omit internal exception details. |

Configure quotas with `ANALYST_PER_IP_LIMIT`, `ANALYST_DAILY_LIMIT`, `ANALYST_TIMEOUT_SECONDS`, and `ANALYST_MAX_CALLS`. Set browser origins through `ALLOWED_ORIGINS`.

**Scope:** counters are in memory and reset on process restart or redeployment. The API is public, and direct HTTP clients can reach it independently of browser CORS rules. Provider account limits remain the account-wide spending boundary. Claim verification measures support and does not guarantee factual accuracy.

## Testing

With the backend environment configured as above:

```bash
python -m pytest -q tests
```

The suite covers real-data API contracts, citation utilities, regression metrics, request validation, quotas, concurrency, CORS, and the LLM request budget.

Frontend checks, from `web/`:

```bash
npm run lint
npm run build
```

[Backend checks](https://github.com/simran-kalkeri/echolens/actions/workflows/backend-checks.yml) also builds the lightweight Docker image and exercises real-data endpoints and search under a **512 MB memory cap**. The deployment validation passed **15 tests** and used approximately **183 MiB** after the container smoke test.

## Evaluation and Limitations

Selected results from the recorded experiment, detailed in [the evaluation report](docs/EVALUATION.md):

| Metric | Result | Baseline |
| --- | --- | --- |
| Student sentiment macro-F1 | 0.817 | 0.696, TF-IDF + logistic regression |
| Student intent macro-F1 | 0.624 | 0.582 |
| Student urgency macro-F1 | 0.497 | 0.439 |
| Aspect-sentiment joint F1 | 0.558 | 0.471 |
| Hybrid + reranker Recall@10 | 0.493 | 0.467, dense only |
| Insight groundedness | 0.686 | Original target: 0.80 |

- Classification results primarily measure agreement with teacher labels; the report includes a separate human-labeled SemEval benchmark.
- Retrieval benchmarks describe the full pipeline. The free hosted service uses BM25, so those hybrid retrieval scores do not describe its search mode.
- Feedback comes from historical [Spotify reviews](https://www.kaggle.com/datasets/mfaaris/spotify-app-reviews-2022) and [customer support conversations](https://www.kaggle.com/datasets/thoughtvector/customer-support-on-twitter), plus explicitly labeled synthetic surveys. This is not a real-time ingestion service.
- The recorded insight-groundedness result missed the original target. Regression floors in `eval/thresholds.json` are maintenance checks, not guarantees of answer quality.

## Deployment

### Backend: Render Free

1. Create a Render Blueprint from this repository and its root `render.yaml`.
2. Supply `GROQ_API_KEY` as an environment secret when prompted. Keep the service on the **Free** plan.
3. The blueprint selects the lightweight requirements, disables embedding-model preloading, uses DuckDB views and BM25, and sets `/api/ready` as the health check.
4. Confirm readiness and verify a cited analyst response before connecting a frontend. Record the assigned `https://<service>.onrender.com` URL.

The existing deployment is available at [the backend readiness endpoint](https://echolens-api-0ok3.onrender.com/api/ready). Free instances sleep after inactivity and use ephemeral runtime storage.

### Frontend: GitHub Pages

1. Enable GitHub Pages with **GitHub Actions** as the publishing source.
2. Set the repository **variable** `NEXT_PUBLIC_API_URL` to the backend base URL, without an `/api` suffix. This URL is public; no Groq key belongs in this variable.
3. Run [Deploy dashboard to GitHub Pages](https://github.com/simran-kalkeri/echolens/actions/workflows/deploy-pages.yml), or push a frontend change to `main`.

The workflow builds a static export with `GITHUB_PAGES=true` and publishes `web/out/`. The base path in `web/next.config.ts` is `/echolens`; update it when deploying under a different repository name. Changes to the API URL variable require a new frontend build.

## Contributing

1. Open an issue to discuss substantial changes or report a reproducible problem.
2. Fork the repository and create a focused feature or fix branch.
3. Update relevant documentation and tests when behavior changes; run the applicable checks above.
4. Submit a pull request against `main` describing the change, validation, and any trade-offs.

Keep credentials, raw datasets, model checkpoints, dependency folders, and generated build output out of commits. Review licensing status below before reusing or redistributing project code.

## Roadmap

- [ ] Persist quotas across restarts and add optional authentication or bot protection.
- [ ] Improve claim grounding and expand human-labeled evaluation.
- [ ] Support the full hybrid/reranked profile in a higher-memory deployment.
- [ ] Add ingestion connectors and a documented data-refresh workflow.
- [ ] Add dashboard screenshots and versioned releases.
- [ ] Select and add a project license.

## License

A project license has not yet been specified; this repository currently has no `LICENSE` file. Dataset, model, and dependency licenses are documented by their respective publishers.

## Contact and Author

**Simran Kalkeri** — [GitHub profile](https://github.com/simran-kalkeri)

For bugs, questions, or feature requests, [open an issue](https://github.com/simran-kalkeri/echolens/issues).
