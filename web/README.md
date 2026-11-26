# EchoLens — web

Next.js 15 frontend for EchoLens, a customer-feedback intelligence platform: taxonomy, trends,
emerging-issue detection, a knowledge graph, an embedding galaxy and an AI analyst whose answers
cite the feedback they rely on.

## Run

```bash
cd web
npm install
npm run dev        # http://localhost:3000
npm run build      # production build (type-checks + lints)
npm start
```

Node 20+ (developed on Node 22).

## Data source

| Env var | Effect |
|---|---|
| `NEXT_PUBLIC_API_URL` unset | All endpoints are served from deterministic mock data in `lib/mock/` (a Spotify workspace plus five smaller ones, Jan–Jun 2022). The sidebar says "Serving mock data". |
| `NEXT_PUBLIC_API_URL=http://localhost:8000` | The typed client in `lib/api.ts` fetches the FastAPI backend. |

Copy `.env.example` to `.env.local` to set it. The API contract lives in `../docs/api-contract.ts`
and is mirrored verbatim in `lib/types.ts`.

The analyst (`POST /api/analyst/ask`) is Server-Sent Events over a POST body, so it is read with
`fetch` + `ReadableStream` (`askAnalyst()` in `lib/api.ts`), not `EventSource`. The mock replays the
same event sequence: `status` → `tool` calls → streamed `token`s → `final` (answer with `[#id]`
citations, claim checks, groundedness).

## Pages

| Route | What it shows |
|---|---|
| `/` | Overview: KPI tiles, sentiment trend, top movers, AI insight cards with citation chips, theme river, aspect sentiment (diverging), intent mix, negative-volume calendar, channel and urgency mix |
| `/themes` | Aspect → theme taxonomy (treemap / sunburst), sortable theme table with sparklines, theme drawer (cited summary, trend, intent / urgency mix, related themes, evidence) |
| `/alerts` | Emerging issues: observed vs expected band, anomaly points, LLM explanation, evidence |
| `/analyst` | AI analyst chat: streamed tool steps, streamed markdown answer, hoverable citations, groundedness meter, claim-level support, suggested questions |
| `/explorer` | Feedback table with semantic search, filters (source, sentiment, intent, urgency, aspect, theme), pagination, detail drawer |
| `/graph` | Sigma.js (WebGL) knowledge graph, ForceAtlas2 layout, colour by type or sentiment, neighbour highlight, search, theme drawer |
| `/galaxy` | React Three Fiber 3D embedding scatter (instanced mesh), colour by cluster or sentiment, hover text, cluster labels, click to isolate |
| `/pipeline` | React Flow DAG of the batch pipeline with engine badges, rows in → out, duration, animated data flow, GSAP "replay run", stage panel with metrics and data-quality checks |
| `/eval` | Evaluation report: headline metrics vs thresholds and baselines, per-class tables, confusion matrices, retrieval by method, incident detection, grounding, cost |

The workspace switcher and date range live in the top bar (Zustand, persisted). The contract has
no date parameters, so the range filters the daily series client-side, anchored at the end of the
data.

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind CSS v4 · Radix primitives in shadcn/ui style
(`components/ui`) · TanStack Query · Zustand · Apache ECharts · Sigma.js + graphology ·
React Three Fiber + drei · React Flow · GSAP (`useGSAP`) · Geist Sans / Mono · lucide-react ·
react-markdown.

Motion respects `prefers-reduced-motion` (entrances, count-ups, chart animation, auto-rotation and
edge-flow dots all switch off).
