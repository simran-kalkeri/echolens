"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import type SigmaType from "sigma";
import { Search, ZoomIn, ZoomOut, Maximize2, X } from "lucide-react";
import type { GraphResponse } from "@/lib/types";
import { useGraph } from "@/lib/queries";
import { mulberry32 } from "@/lib/mock/generate";
import { CATEGORICAL, C, sentimentScale } from "@/lib/colors";
import { cn, fmt } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Input, Segmented, Skeleton } from "@/components/ui/primitives";
import { ErrorState, PageContainer, PageHeader } from "@/components/common/states";
import { ThemeSheet } from "@/components/common/theme-detail";
import { FONT } from "@/components/charts/echart";

type GNode = GraphResponse["nodes"][number];
type ColorMode = "type" | "sentiment";

const TYPE_COLOR: Record<GNode["type"], string> = {
  aspect: CATEGORICAL[0],
  theme: CATEGORICAL[1],
  intent: CATEGORICAL[2],
  source: CATEGORICAL[3],
};
const TYPE_LABEL: Record<GNode["type"], string> = { aspect: "Aspect", theme: "Theme", intent: "Intent", source: "Source" };
const DIM = "#23262c";

function buildGraph(data: GraphResponse) {
  const g = new Graph({ type: "undirected", multi: false });
  const r = mulberry32(42);
  const max = Math.max(...data.nodes.map((n) => n.size));
  for (const n of data.nodes) {
    const base = n.type === "aspect" ? 4 : n.type === "theme" ? 2.5 : 3;
    g.addNode(n.id, {
      x: r() * 100,
      y: r() * 100,
      size: base + Math.sqrt(n.size / max) * (n.type === "theme" ? 7 : 5),
      label: n.type === "intent" || n.type === "source" ? fmt.label(n.label) : n.label,
      ntype: n.type,
      sentiment: n.sentiment,
      volume: n.size,
      community: n.community,
    });
  }
  const maxW = Math.max(...data.edges.map((e) => e.weight));
  for (const e of data.edges) {
    if (!g.hasNode(e.source) || !g.hasNode(e.target) || g.hasEdge(e.source, e.target)) continue;
    g.addEdge(e.source, e.target, {
      weight: e.weight,
      size: 0.4 + (e.weight / maxW) * (e.kind === "co_occurs" ? 2.2 : 1),
      kind: e.kind,
    });
  }
  forceAtlas2.assign(g, {
    iterations: 400,
    settings: { ...forceAtlas2.inferSettings(g), gravity: 0.8, scalingRatio: 40, barnesHutOptimize: false, adjustSizes: true, edgeWeightInfluence: 0.6 },
  });
  return g;
}

export function GraphPage() {
  const { data, isLoading, error, refetch } = useGraph();
  const container = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<SigmaType | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const state = useRef<{ hovered: string | null; selected: string | null; mode: ColorMode; query: string }>({ hovered: null, selected: null, mode: "type", query: "" });
  const [mode, setMode] = useState<ColorMode>("type");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [themeOpen, setThemeOpen] = useState<string | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{ id: string; label: string; type: string; volume: number; sentiment: number; degree: number } | null>(null);

  const graph = useMemo(() => (data ? buildGraph(data) : null), [data]);

  useEffect(() => {
    if (!graph || !container.current) return;
    let killed = false;
    let instance: SigmaType | null = null;
    (async () => {
      const { default: Sigma, DEFAULT_STYLES } = await import("sigma");
      if (killed || !container.current) return;
      graphRef.current = graph;
      const neighborsOf = (id: string | null) => (id ? new Set([id, ...graph.neighbors(id)]) : null);
      instance = new Sigma(graph, container.current, {
        settings: {
          labelRenderedSizeThreshold: 9,
          labelDensity: 0.9,
          stagePadding: 40,
          minCameraRatio: 0.15,
          maxCameraRatio: 3,
        } as never,
        styles: {
          nodes: {
            ...DEFAULT_STYLES.nodes,
            labelColor: "#c9ccd3",
            labelSize: 12,
            labelFont: FONT,
            backdropColor: "#15171b",
            backdropShadowColor: "rgba(0,0,0,0.6)",
            backdropBorderColor: "#2c2f36",
            backdropBorderWidth: 1,
            backdropCornerRadius: 6,
          },
          edges: DEFAULT_STYLES.edges,
        } as never,
        nodeReducer: (key, _data, attrs) => {
          const s = state.current;
          const focus = neighborsOf(s.hovered ?? s.selected);
          const q = s.query.trim().toLowerCase();
          const a = attrs as { ntype: GNode["type"]; sentiment: number; label: string };
          const base = s.mode === "type" ? TYPE_COLOR[a.ntype] : sentimentScale(a.sentiment * 1.3);
          const res: Record<string, unknown> = { color: base };
          if (focus && !focus.has(key)) {
            res.color = DIM;
            res.labelVisibility = "hidden";
            res.zIndex = 0;
          } else if (focus) {
            res.labelVisibility = "visible";
            res.zIndex = 2;
          }
          if (q && !a.label.toLowerCase().includes(q)) {
            res.color = DIM;
            res.labelVisibility = "hidden";
          } else if (q) {
            res.labelVisibility = "visible";
          }
          if (key === s.selected) res.highlighted = true;
          return res;
        },
        edgeReducer: (key, _data, attrs) => {
          const s = state.current;
          const focusId = s.hovered ?? s.selected;
          const a = attrs as { kind: string };
          const res: Record<string, unknown> = { color: a.kind === "co_occurs" ? "#4a4f5a" : "#2a2d34" };
          if (focusId) {
            const [src, tgt] = graph.extremities(key);
            if (src === focusId || tgt === focusId) {
              res.color = a.kind === "co_occurs" ? C.accent : "#6c707a";
              res.zIndex = 1;
            } else res.visibility = "hidden";
          }
          if (s.query.trim()) res.color = "#1d2025";
          return res;
        },
      });
      sigmaRef.current = instance;
      instance.on("enterNode", ({ node }) => {
        state.current.hovered = node;
        const a = graph.getNodeAttributes(node) as { label: string; ntype: string; volume: number; sentiment: number };
        setHoverInfo({ id: node, label: a.label, type: a.ntype, volume: a.volume, sentiment: a.sentiment, degree: graph.degree(node) });
        instance?.refresh({ skipIndexation: true });
      });
      instance.on("leaveNode", () => {
        state.current.hovered = null;
        setHoverInfo(null);
        instance?.refresh({ skipIndexation: true });
      });
      instance.on("clickNode", ({ node }) => {
        state.current.selected = node;
        setSelected(node);
        if ((graph.getNodeAttribute(node, "ntype") as string) === "theme") setThemeOpen(node);
        instance?.refresh({ skipIndexation: true });
      });
      instance.on("clickStage", () => {
        state.current.selected = null;
        setSelected(null);
        instance?.refresh({ skipIndexation: true });
      });
    })();
    return () => {
      killed = true;
      instance?.kill();
      sigmaRef.current = null;
    };
  }, [graph]);

  useEffect(() => {
    state.current.mode = mode;
    sigmaRef.current?.refresh({ skipIndexation: true });
  }, [mode]);
  useEffect(() => {
    state.current.query = query;
    sigmaRef.current?.refresh({ skipIndexation: true });
  }, [query]);

  const matches = useMemo(() => {
    if (!data || !query.trim()) return [];
    const q = query.trim().toLowerCase();
    return data.nodes.filter((n) => n.label.toLowerCase().includes(q)).slice(0, 6);
  }, [data, query]);

  const focusNode = (id: string) => {
    const s = sigmaRef.current;
    if (!s) return;
    const d = s.getNodeDisplayData(id);
    state.current.selected = id;
    setSelected(id);
    setQuery("");
    if (d) void s.getCamera().animate({ x: d.x, y: d.y, ratio: 0.45 }, { duration: 600 });
    s.refresh({ skipIndexation: true });
    const n = data?.nodes.find((x) => x.id === id);
    if (n?.type === "theme") setThemeOpen(id);
  };
  const cam = (f: "in" | "out" | "reset") => {
    const c = sigmaRef.current?.getCamera();
    if (!c) return;
    if (f === "in") void c.zoomIn({ duration: 300 });
    else if (f === "out") void c.zoomOut({ duration: 300 });
    else void c.reset({ duration: 400 });
  };

  const selectedNode = data?.nodes.find((n) => n.id === selected);
  const selNeighbors = useMemo(() => {
    if (!selected || !graphRef.current || !graphRef.current.hasNode(selected)) return [];
    const g = graphRef.current;
    return g
      .neighbors(selected)
      .map((id) => ({ id, label: g.getNodeAttribute(id, "label") as string, type: g.getNodeAttribute(id, "ntype") as GNode["type"], w: g.getEdgeAttribute(g.edge(selected, id)!, "weight") as number }))
      .sort((a, b) => b.w - a.w)
      .slice(0, 8);
  }, [selected]);

  return (
    <PageContainer>
      <PageHeader
        title="Knowledge graph"
        description="Aspects, themes, intents and channels linked by membership and co-occurrence. Laid out with ForceAtlas2; node size is feedback volume, edge thickness is association strength. Hover to trace neighbours, click a theme for its evidence."
        actions={
          <Segmented
            aria-label="Node colour"
            value={mode}
            onChange={setMode}
            options={[
              { value: "type", label: "Colour by type" },
              { value: "sentiment", label: "By sentiment" },
            ]}
          />
        }
      />
      {error ? (
        <Card>
          <ErrorState error={error} onRetry={() => refetch()} />
        </Card>
      ) : (
        <Card className="relative overflow-hidden">
          <div className="hairline-grid relative h-[calc(100dvh-220px)] min-h-[460px]">
            {isLoading && (
              <div className="absolute inset-0 grid place-items-center">
                <div className="flex flex-col items-center gap-3">
                  <Skeleton className="size-24 rounded-full" />
                  <span className="text-xs text-fg-3">Computing layout…</span>
                </div>
              </div>
            )}
            <div ref={container} className="absolute inset-0" style={{ background: "transparent" }} />

            {/* search */}
            <div className="absolute top-3 left-3 z-10 w-[min(280px,calc(100%-24px))]">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-3" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a node" className="bg-panel/90 pl-8 backdrop-blur" aria-label="Search graph" />
              </div>
              {matches.length > 0 && (
                <ul className="mt-1 rounded-lg border border-border-strong bg-raised p-1 shadow-xl shadow-black/40">
                  {matches.map((n) => (
                    <li key={n.id}>
                      <button onClick={() => focusNode(n.id)} className="flex h-8 w-full items-center gap-2 rounded-[4px] px-2 text-left text-[13px] text-fg-2 hover:bg-hover hover:text-fg">
                        <span className="size-2 rounded-full" style={{ background: TYPE_COLOR[n.type] }} />
                        <span className="flex-1 truncate">{n.type === "theme" || n.type === "aspect" ? n.label : fmt.label(n.label)}</span>
                        <span className="text-2xs text-fg-3">{TYPE_LABEL[n.type]}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* zoom controls */}
            <div className="absolute right-3 bottom-3 z-10 flex flex-col overflow-hidden rounded-md border border-border bg-panel/90 backdrop-blur">
              {[
                { f: "in" as const, I: ZoomIn, l: "Zoom in" },
                { f: "out" as const, I: ZoomOut, l: "Zoom out" },
                { f: "reset" as const, I: Maximize2, l: "Reset view" },
              ].map(({ f, I, l }) => (
                <button key={f} onClick={() => cam(f)} aria-label={l} className="grid size-8 place-items-center border-b border-border text-fg-3 last:border-b-0 hover:bg-hover hover:text-fg">
                  <I className="size-3.5" />
                </button>
              ))}
            </div>

            {/* legend */}
            <div className="absolute bottom-3 left-3 z-10 rounded-md border border-border bg-panel/90 px-3 py-2 text-2xs backdrop-blur">
              {mode === "type" ? (
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {(Object.keys(TYPE_COLOR) as GNode["type"][]).map((t) => (
                    <span key={t} className="flex items-center gap-1.5 text-fg-2">
                      <span className="size-2 rounded-full" style={{ background: TYPE_COLOR[t] }} />
                      {TYPE_LABEL[t]}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-fg-3">
                  <span>Negative</span>
                  <span className="h-1.5 w-28 rounded-full" style={{ background: `linear-gradient(90deg, ${sentimentScale(-1)}, ${sentimentScale(0)}, ${sentimentScale(1)})` }} />
                  <span>Positive</span>
                </div>
              )}
            </div>

            {/* hover / selection card */}
            {(hoverInfo || selectedNode) && (
              <div className="pointer-events-auto absolute top-3 right-3 z-10 hidden w-64 rounded-lg border border-border-strong bg-panel/95 p-3 shadow-xl shadow-black/40 backdrop-blur sm:block">
                {hoverInfo ? (
                  <NodeInfo label={hoverInfo.label} type={hoverInfo.type as GNode["type"]} volume={hoverInfo.volume} sentiment={hoverInfo.sentiment} degree={hoverInfo.degree} />
                ) : selectedNode ? (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <NodeInfo label={selectedNode.type === "theme" || selectedNode.type === "aspect" ? selectedNode.label : fmt.label(selectedNode.label)} type={selectedNode.type} volume={selectedNode.size} sentiment={selectedNode.sentiment} degree={selNeighbors.length} />
                      <button
                        onClick={() => {
                          state.current.selected = null;
                          setSelected(null);
                          sigmaRef.current?.refresh({ skipIndexation: true });
                        }}
                        className="grid size-6 shrink-0 place-items-center rounded text-fg-3 hover:bg-hover hover:text-fg"
                        aria-label="Clear selection"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                    <div className="mt-3 border-t border-border pt-2">
                      <div className="mb-1 text-2xs text-fg-3">Strongest links</div>
                      <ul>
                        {selNeighbors.map((n) => (
                          <li key={n.id}>
                            <button onClick={() => focusNode(n.id)} className="flex h-7 w-full items-center gap-2 rounded px-1 text-left text-xs text-fg-2 hover:bg-hover hover:text-fg">
                              <span className="size-1.5 rounded-full" style={{ background: TYPE_COLOR[n.type] }} />
                              <span className="flex-1 truncate">{n.type === "intent" || n.type === "source" ? fmt.label(n.label) : n.label}</span>
                              <span className="text-2xs text-fg-3 tnum">{n.w.toFixed(2)}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                      {selectedNode.type === "theme" && (
                        <button onClick={() => setThemeOpen(selectedNode.id)} className="mt-2 text-xs text-accent hover:underline">
                          Open theme evidence
                        </button>
                      )}
                    </div>
                  </>
                ) : null}
              </div>
            )}
          </div>
        </Card>
      )}
      <ThemeSheet id={themeOpen} onClose={() => setThemeOpen(null)} onSelectTheme={(id) => focusNode(id)} />
    </PageContainer>
  );
}

function NodeInfo({ label, type, volume, sentiment, degree }: { label: string; type: GNode["type"]; volume: number; sentiment: number; degree: number }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-2xs font-medium tracking-wide uppercase" style={{ color: TYPE_COLOR[type] }}>
        <span className="size-1.5 rounded-full" style={{ background: TYPE_COLOR[type] }} />
        {TYPE_LABEL[type]}
      </div>
      <div className="mt-1 text-[13px] leading-5 font-medium text-fg">{label}</div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-2xs text-fg-3 tnum">
        <div>
          <div>Volume</div>
          <div className="mt-0.5 text-xs text-fg">{fmt.compact(volume)}</div>
        </div>
        <div>
          <div>Sentiment</div>
          <div className={cn("mt-0.5 text-xs")} style={{ color: sentimentScale(sentiment * 1.3) }}>
            {fmt.signed(sentiment, 2)}
          </div>
        </div>
        <div>
          <div>Links</div>
          <div className="mt-0.5 text-xs text-fg">{degree}</div>
        </div>
      </div>
    </div>
  );
}
