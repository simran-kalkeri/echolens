"use client";
import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ReactFlow, Background, BackgroundVariant, Controls, Handle, Position, BaseEdge, getSmoothStepPath, type Node, type Edge, type NodeProps, type EdgeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Check, CircleDashed, Clock, Database, Play, RotateCcw, ShieldCheck, X, Inbox, LayoutDashboard, Quote } from "lucide-react";
import type { PipelineResponse, PipelineStage } from "@/lib/types";
import { usePipeline } from "@/lib/queries";
import { C, SENTIMENT_COLOR } from "@/lib/colors";
import { cn, fmt } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/primitives";
import { Sheet } from "@/components/ui/sheet";
import { ErrorState, PageContainer, PageHeader } from "@/components/common/states";
import { prefersReducedMotion } from "@/components/common/motion";

const ENGINE: Record<PipelineStage["engine"], { label: string; color: string }> = {
  spark: { label: "Spark", color: "#e8803f" },
  "kaggle-gpu": { label: "Kaggle GPU", color: "#2bb3c4" },
  groq: { label: "Groq", color: "#f06c5b" },
  duckdb: { label: "DuckDB", color: "#e0c341" },
  python: { label: "Python", color: "#6f9fe8" },
};

type Phase = "idle" | "pending" | "running" | "done";
const ReplayCtx = createContext<{ phase: (id: string) => Phase; vertical: boolean }>({ phase: () => "idle", vertical: false });

type StageData = { stage: PipelineStage; onOpen: (s: PipelineStage) => void };
type TermData = { kind: "sources" | "evidence"; label: string; sub: string };

function EngineBadge({ engine }: { engine: PipelineStage["engine"] }) {
  const e = ENGINE[engine] ?? { label: String(engine ?? "n/a"), color: "#8a8f98" };
  return (
    <span className="inline-flex h-5 items-center gap-1.5 rounded-sm border border-border bg-bg/60 px-1.5 text-2xs font-medium text-fg-2">
      <span className="size-1.5 rounded-[2px]" style={{ background: e.color }} />
      {e.label}
    </span>
  );
}

function StatusIcon({ status, phase }: { status: PipelineStage["status"]; phase: Phase }) {
  if (phase === "pending") return <CircleDashed className="size-3.5 text-fg-3" />;
  if (phase === "running") return <span className="size-3.5 animate-spin rounded-full border-[1.5px] border-accent border-t-transparent" />;
  if (status === "failed") return <X className="size-3.5 text-neg" />;
  if (status === "skipped") return <CircleDashed className="size-3.5 text-fg-3" />;
  return (
    <span className="grid size-3.5 place-items-center rounded-full bg-pos/20">
      <Check className="size-2.5 text-pos" strokeWidth={3} />
    </span>
  );
}

const StageNode = memo(function StageNode({ id, data }: NodeProps<Node<StageData>>) {
  const { phase, vertical } = useContext(ReplayCtx);
  const p = phase(id);
  const s = data.stage;
  const hs = sides(id, vertical);
  const failedChecks = s.checks.filter((c) => !c.passed).length;
  return (
    <button
      onClick={() => data.onOpen(s)}
      className={cn(
        "stage-node w-[236px] rounded-lg border bg-panel p-3 text-left transition-[border-color,opacity,box-shadow] duration-300",
        p === "pending" ? "border-border opacity-45" : p === "running" ? "border-accent shadow-[0_0_0_4px_rgba(79,143,247,0.15)]" : "border-border-strong hover:border-fg-3",
      )}
    >
      <Handle type="target" position={hs.in} className="!size-1.5 !min-w-0 !border-0 !bg-border-strong" />
      <div className="flex items-center justify-between gap-2">
        <EngineBadge engine={s.engine} />
        <StatusIcon status={s.status} phase={p} />
      </div>
      <div className="mt-2.5 text-[13px] leading-4 font-medium text-fg">{s.name}</div>
      <div className="mt-2.5 flex items-center justify-between font-mono text-2xs text-fg-3 tnum">
        <span className="flex items-center gap-1">
          <Database className="size-3" />
          {s.rows_in != null ? `${fmt.compact(s.rows_in)} → ${fmt.compact(s.rows_out ?? 0)}` : "serving"}
        </span>
        <span className="flex items-center gap-1">
          <Clock className="size-3" />
          {fmt.duration(s.duration_s)}
        </span>
      </div>
      {failedChecks > 0 && (
        <div className="mt-2 flex items-center gap-1 text-2xs text-[#ec835a]">
          <ShieldCheck className="size-3" /> {failedChecks} check below target
        </div>
      )}
      <Handle type="source" position={hs.out} className="!size-1.5 !min-w-0 !border-0 !bg-border-strong" />
    </button>
  );
});

const TermNode = memo(function TermNode({ id, data }: NodeProps<Node<TermData>>) {
  const { phase, vertical } = useContext(ReplayCtx);
  const p = phase(id);
  const hs = sides(id, vertical);
  const Icon = data.kind === "sources" ? Inbox : Quote;
  return (
    <div
      className={cn(
        "w-[196px] rounded-lg border border-dashed bg-bg p-3 transition-[border-color,opacity] duration-300",
        p === "pending" ? "border-border opacity-45" : p === "running" ? "border-accent" : "border-border-strong",
      )}
    >
      {data.kind === "evidence" && <Handle type="target" position={hs.in} className="!size-1.5 !min-w-0 !border-0 !bg-border-strong" />}
      <div className="flex items-center gap-2 text-[13px] font-medium text-fg">
        <Icon className="size-3.5 text-accent" />
        {data.label}
      </div>
      <div className="mt-1.5 text-2xs leading-4 text-fg-3">{data.sub}</div>
      {data.kind === "sources" && <Handle type="source" position={hs.out} className="!size-1.5 !min-w-0 !border-0 !bg-border-strong" />}
    </div>
  );
});

function FlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, source }: EdgeProps) {
  const { phase } = useContext(ReplayCtx);
  const [path] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 12 });
  const p = phase(source);
  const flowing = p === "done" || p === "idle";
  const reduce = typeof window !== "undefined" && prefersReducedMotion();
  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke: p === "pending" ? "#24272d" : "#3a3e47", strokeWidth: 1.25, transition: "stroke .3s" }} />
      {flowing && !reduce && (
        <>
          <circle r="2.25" fill={C.accent} opacity={0.9}>
            <animateMotion dur="2.4s" repeatCount="indefinite" path={path} />
          </circle>
          <circle r="2.25" fill={C.accent} opacity={0.5}>
            <animateMotion dur="2.4s" begin="1.2s" repeatCount="indefinite" path={path} />
          </circle>
        </>
      )}
    </>
  );
}

const nodeTypes = { stage: StageNode, term: TermNode };
const edgeTypes = { flow: FlowEdge };

type Side = "L" | "R" | "T" | "B";
/**
 * Snake layout mirroring the architecture diagram: the first band flows left→right
 * (ingest → NLP → ABSA | embeddings), the second band flows back right→left
 * (analytics → detection | retrieval → insights → dashboard → evidence).
 */
const WIDE: Record<string, { x: number; y: number; in: Side; out: Side }> = {
  sources: { x: 0, y: 0, in: "L", out: "R" },
  ingest: { x: 290, y: 0, in: "L", out: "R" },
  clean_dedup: { x: 580, y: 0, in: "L", out: "R" },
  nlp: { x: 870, y: 0, in: "L", out: "R" },
  absa: { x: 1160, y: -80, in: "L", out: "R" },
  embed_cluster: { x: 1160, y: 80, in: "L", out: "R" },
  taxonomy: { x: 1450, y: 80, in: "L", out: "B" },
  analytics: { x: 1160, y: 330, in: "R", out: "L" },
  emerging: { x: 870, y: 250, in: "R", out: "L" },
  retrieval: { x: 870, y: 410, in: "R", out: "L" },
  insights: { x: 580, y: 410, in: "R", out: "L" },
  dashboard: { x: 290, y: 330, in: "R", out: "L" },
  evidence: { x: 20, y: 330, in: "R", out: "L" },
};
const NARROW: Record<string, [number, number]> = {
  sources: [0, 0], ingest: [0, 1], clean_dedup: [0, 2], nlp: [0, 3], absa: [-0.55, 4], embed_cluster: [0.55, 4],
  taxonomy: [0.55, 5], analytics: [0, 6], emerging: [-0.55, 7], retrieval: [0.55, 7], insights: [0.55, 8], dashboard: [0, 9], evidence: [0, 10],
};
const SIDE: Record<Side, Position> = { L: Position.Left, R: Position.Right, T: Position.Top, B: Position.Bottom };
function sides(id: string, vertical: boolean) {
  if (vertical) return { in: Position.Top, out: Position.Bottom };
  const l = WIDE[id];
  return { in: SIDE[l?.in ?? "L"], out: SIDE[l?.out ?? "R"] };
}

function useIsNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    setNarrow(mq.matches);
    const h = () => setNarrow(mq.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);
  return narrow;
}

function buildFlow(p: PipelineResponse, onOpen: (s: PipelineStage) => void, vertical: boolean) {
  const pos = (id: string) => {
    if (vertical) {
      const [c, r] = NARROW[id] ?? [0, 0];
      return { x: c * 260, y: r * 150 };
    }
    const l = WIDE[id] ?? { x: 0, y: 0 };
    return { x: l.x, y: l.y };
  };
  const nodes: Node[] = [
    { id: "sources", type: "term", position: pos("sources"), data: { kind: "sources", label: "Feedback sources", sub: "App-store reviews, support tickets, NPS surveys" } },
    ...p.stages.map((s) => ({ id: s.id, type: "stage", position: pos(s.id), data: { stage: s, onOpen } })),
    { id: "evidence", type: "term", position: pos("evidence"), data: { kind: "evidence", label: "Evidence-backed insights", sub: "Every claim links to the feedback that supports it" } },
  ];
  const edges: Edge[] = [
    { id: "e-sources-ingest", source: "sources", target: "ingest", type: "flow" },
    ...p.edges.map((e) => ({ id: `e-${e.source}-${e.target}`, source: e.source, target: e.target, type: "flow" })),
    { id: "e-dashboard-evidence", source: "dashboard", target: "evidence", type: "flow" },
  ];
  return { nodes, edges };
}

/** Topological order for the replay. */
function topoOrder(p: PipelineResponse) {
  const ids = ["sources", ...p.stages.map((s) => s.id), "evidence"];
  const edges = [["sources", "ingest"], ...p.edges.map((e) => [e.source, e.target]), ["dashboard", "evidence"]];
  const indeg = new Map(ids.map((i) => [i, 0]));
  for (const [, t] of edges) indeg.set(t, (indeg.get(t) ?? 0) + 1);
  const levels: string[][] = [];
  let frontier = ids.filter((i) => indeg.get(i) === 0);
  while (frontier.length) {
    levels.push(frontier);
    const next: string[] = [];
    for (const n of frontier)
      for (const [s, t] of edges)
        if (s === n) {
          indeg.set(t, (indeg.get(t) ?? 0) - 1);
          if (indeg.get(t) === 0) next.push(t);
        }
    frontier = next;
  }
  return levels;
}

function StagePanel({ s, onClose }: { s: PipelineStage | null; onClose: () => void }) {
  const kept = s && s.rows_in ? (s.rows_out ?? 0) / s.rows_in : null;
  return (
    <Sheet
      open={!!s}
      onOpenChange={(o) => !o && onClose()}
      title={s?.name ?? ""}
      description={s ? <span className="flex items-center gap-2"><EngineBadge engine={s.engine} /><span>{s.description}</span></span> : undefined}
    >
      {s && (
        <div className="flex flex-col">
          <div className="grid grid-cols-3 border-b border-border">
            {[
              { l: "Rows in", v: s.rows_in != null ? fmt.int(s.rows_in) : "—" },
              { l: "Rows out", v: s.rows_out != null ? fmt.int(s.rows_out) : "—" },
              { l: "Duration", v: fmt.duration(s.duration_s) },
            ].map((m) => (
              <div key={m.l} className="border-r border-border px-5 py-3 last:border-r-0">
                <div className="text-2xs text-fg-3">{m.l}</div>
                <div className="mt-1 text-base font-semibold text-fg tnum">{m.v}</div>
              </div>
            ))}
          </div>
          {kept != null && (
            <div className="border-b border-border px-5 py-4">
              <div className="mb-2 flex justify-between text-2xs text-fg-3">
                <span>Row flow</span>
                <span className="tnum">{kept > 1 ? `×${kept.toFixed(2)} expansion` : `${(kept * 100).toFixed(1)}% kept`}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-raised">
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(1, kept) * 100}%` }} />
              </div>
            </div>
          )}
          <div className="border-b border-border px-5 py-4">
            <div className="mb-3 text-2xs font-medium tracking-wide text-fg-3 uppercase">Metrics</div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              {Object.entries(s.metrics).map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="truncate text-2xs text-fg-3">{fmt.label(k)}</dt>
                  <dd className="mt-0.5 truncate font-mono text-[13px] text-fg tnum">{typeof v === "number" ? fmt.int(v) : v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="px-5 py-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-2xs font-medium tracking-wide text-fg-3 uppercase">Data-quality checks</span>
              <span className="text-2xs text-fg-3 tnum">
                {s.checks.filter((c) => c.passed).length}/{s.checks.length} passing
              </span>
            </div>
            <ul className="flex flex-col gap-1.5">
              {s.checks.map((c) => (
                <li key={c.name} className="flex items-center gap-3 rounded-md border border-border px-3 py-2 text-[13px]">
                  {c.passed ? (
                    <span className="grid size-4 shrink-0 place-items-center rounded-full bg-pos/20"><Check className="size-3 text-pos" strokeWidth={3} /></span>
                  ) : (
                    <span className="grid size-4 shrink-0 place-items-center rounded-full bg-neg/20"><X className="size-3 text-neg" strokeWidth={3} /></span>
                  )}
                  <span className="flex-1 text-fg-2">{c.name}</span>
                  <span className="font-mono text-xs text-fg tnum">{c.value}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Sheet>
  );
}

export function PipelinePage() {
  const { data, isLoading, error, refetch } = usePipeline();
  const [open, setOpen] = useState<PipelineStage | null>(null);
  const [phases, setPhases] = useState<Record<string, Phase> | null>(null);
  const [progress, setProgress] = useState(0);
  const vertical = useIsNarrow();
  const scope = useRef<HTMLDivElement>(null);
  const tl = useRef<gsap.core.Timeline | null>(null);

  const flow = useMemo(() => (data ? buildFlow(data, setOpen, vertical) : null), [data, vertical]);
  const ctx = useMemo(() => ({ phase: (id: string): Phase => (phases ? (phases[id] ?? "pending") : "idle"), vertical }), [phases, vertical]);

  const { contextSafe } = useGSAP({ scope });
  const replay = contextSafe(() => {
    if (!data) return;
    tl.current?.kill();
    const levels = topoOrder(data);
    const all = levels.flat();
    const state: Record<string, Phase> = Object.fromEntries(all.map((id) => [id, "pending" as Phase]));
    setPhases({ ...state });
    setProgress(0);
    const reduce = prefersReducedMotion();
    const t = gsap.timeline({ onComplete: () => setTimeout(() => setPhases(null), 900) });
    const prog = { v: 0 };
    levels.forEach((lvl, i) => {
      const stepDur = reduce ? 0.05 : 0.55;
      t.call(() => {
        lvl.forEach((id) => (state[id] = "running"));
        setPhases({ ...state });
      }, undefined, i * stepDur);
      t.call(() => {
        lvl.forEach((id) => (state[id] = "done"));
        setPhases({ ...state });
      }, undefined, i * stepDur + stepDur * 0.85);
    });
    t.to(prog, { v: 1, duration: levels.length * (reduce ? 0.05 : 0.55), ease: "none", onUpdate: () => setProgress(prog.v) }, 0);
    tl.current = t;
  });
  useEffect(() => () => void tl.current?.kill(), []);

  const totals = useMemo(() => {
    if (!data) return null;
    const checks = data.stages.flatMap((s) => s.checks);
    const secs = (new Date(data.finished_at).getTime() - new Date(data.started_at).getTime()) / 1000;
    return { checks: checks.length, passed: checks.filter((c) => c.passed).length, secs };
  }, [data]);

  return (
    <PageContainer>
      <PageHeader
        title="Pipeline"
        description="The batch pipeline behind every number in EchoLens: distributed preprocessing on Spark, GPU inference on Kaggle, LLM insight generation on Groq, analytics in DuckDB. Click a stage for metrics and data-quality checks."
        actions={
          <Button variant="secondary" onClick={replay} disabled={!data || (phases !== null && progress < 1)}>
            {phases ? <RotateCcw /> : <Play />} Replay run
          </Button>
        }
      />
      {error ? (
        <Card>
          <ErrorState error={error} onRetry={() => refetch()} />
        </Card>
      ) : (
        <div ref={scope} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
            {[
              { l: "Run", v: data?.run_id ?? "—", mono: true },
              { l: "Started", v: data ? fmt.dateLong(data.started_at) : "—" },
              { l: "Wall time", v: totals ? fmt.duration(Math.round(totals.secs)) : "—" },
              { l: "Quality checks", v: totals ? `${totals.passed} / ${totals.checks} passing` : "—" },
            ].map((m) => (
              <div key={m.l} className="min-w-0 bg-panel px-4 py-3">
                <div className="text-2xs text-fg-3">{m.l}</div>
                <div className={cn("mt-1 truncate text-[13px] text-fg tnum", m.mono && "font-mono text-xs")}>{m.v}</div>
              </div>
            ))}
          </div>
          <Card className="relative overflow-hidden">
            <div className="absolute inset-x-0 top-0 z-10 h-px bg-transparent">
              <div className="h-full bg-accent transition-[width] duration-100" style={{ width: `${phases ? progress * 100 : 0}%` }} />
            </div>
            <div className="hairline-grid h-[620px] lg:h-[640px]">
              {isLoading || !flow ? (
                <div className="flex h-full items-center justify-center gap-6 p-8">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-24 w-44 shrink-0" />
                  ))}
                </div>
              ) : (
                <ReplayCtx.Provider value={ctx}>
                  <ReactFlow
                    key={vertical ? "v" : "h"}
                    nodes={flow.nodes}
                    edges={flow.edges}
                    nodeTypes={nodeTypes}
                    edgeTypes={edgeTypes}
                    fitView
                    fitViewOptions={{ padding: 0.08 }}
                    minZoom={0.3}
                    maxZoom={1.6}
                    nodesDraggable={false}
                    nodesConnectable={false}
                    elementsSelectable={false}
                    proOptions={{ hideAttribution: true }}
                    panOnScroll={false}
                    zoomOnScroll={false}
                    preventScrolling={false}
                  >
                    <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#22252b" />
                    <Controls showInteractive={false} position="bottom-right" />
                  </ReactFlow>
                </ReplayCtx.Provider>
              )}
            </div>
          </Card>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-2xs text-fg-3">
            {Object.entries(ENGINE).map(([k, e]) => (
              <span key={k} className="flex items-center gap-1.5">
                <span className="size-2 rounded-[2px]" style={{ background: e.color }} />
                {e.label}
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <LayoutDashboard className="size-3" /> Dots on edges show data flowing between stages
            </span>
            <span className="ml-auto flex items-center gap-1.5" style={{ color: SENTIMENT_COLOR.positive }}>
              <Check className="size-3" /> Last run succeeded
            </span>
          </div>
        </div>
      )}
      <StagePanel s={open} onClose={() => setOpen(null)} />
    </PageContainer>
  );
}
