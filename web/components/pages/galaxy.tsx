"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, MousePointer2, X } from "lucide-react";
import { useGalaxy } from "@/lib/queries";
import { clusterColor, sentimentScale } from "@/lib/colors";
import { cn, fmt } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Segmented, Skeleton } from "@/components/ui/primitives";
import { ErrorState, PageContainer, PageHeader } from "@/components/common/states";
import type { GalaxyColorMode } from "./galaxy-scene";

const GalaxyScene = dynamic(() => import("./galaxy-scene").then((m) => m.GalaxyScene), {
  ssr: false,
  loading: () => <SceneLoading />,
});

function SceneLoading() {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="flex flex-col items-center gap-3">
        <div className="relative size-24">
          <Skeleton className="absolute inset-0 rounded-full" />
          <Skeleton className="absolute inset-6 rounded-full" />
        </div>
        <span className="text-xs text-fg-3">Projecting embeddings…</span>
      </div>
    </div>
  );
}

export function GalaxyPage() {
  const { data, isLoading, error, refetch } = useGalaxy();
  const [mode, setMode] = useState<GalaxyColorMode>("cluster");
  const [focus, setFocus] = useState<number | null>(null);
  const [labels, setLabels] = useState(true);
  const clusters = useMemo(() => (data ? [...data.clusters].sort((a, b) => b.count - a.count) : []), [data]);
  const sentByCluster = useMemo(() => {
    const m = new Map<number, number>();
    if (!data) return m;
    const acc = new Map<number, [number, number]>();
    for (const p of data.points) {
      const a = acc.get(p.cluster) ?? [0, 0];
      a[0] += p.sentiment;
      a[1]++;
      acc.set(p.cluster, a);
    }
    acc.forEach(([s, n], k) => m.set(k, s / n));
    return m;
  }, [data]);
  const focused = clusters.find((c) => c.id === focus);

  return (
    <PageContainer>
      <PageHeader
        title="Embedding galaxy"
        description={`Every point is one piece of feedback, embedded with a sentence encoder and projected to 3D with UMAP. Nearby points say similar things; clusters become themes.${data ? ` Showing a ${fmt.int(data.points.length)}-point sample.` : ""}`}
        actions={
          <>
            <Segmented
              aria-label="Point colour"
              value={mode}
              onChange={setMode}
              options={[
                { value: "cluster", label: "By cluster" },
                { value: "sentiment", label: "By sentiment" },
              ]}
            />
            <Segmented
              aria-label="Cluster labels"
              value={labels ? "on" : "off"}
              onChange={(v) => setLabels(v === "on")}
              options={[
                { value: "on", label: "Labels" },
                { value: "off", label: "Hide" },
              ]}
            />
          </>
        }
      />
      {error ? (
        <Card>
          <ErrorState error={error} onRetry={() => refetch()} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_300px]">
          <Card className="relative h-[calc(100dvh-230px)] min-h-[440px] overflow-hidden bg-[radial-gradient(ellipse_at_center,#12151b_0%,#0c0d10_70%)]">
            {isLoading || !data ? <SceneLoading /> : <GalaxyScene data={data} mode={mode} focus={focus} onFocus={setFocus} showLabels={labels} />}
            <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-1.5 rounded-md border border-border bg-panel/80 px-2.5 py-1.5 text-2xs text-fg-3 backdrop-blur">
              <MousePointer2 className="size-3" /> Drag to orbit · right-drag to pan · scroll to zoom · hover a point to read it
            </div>
            {mode === "sentiment" && (
              <div className="pointer-events-none absolute right-3 bottom-3 flex items-center gap-2 rounded-md border border-border bg-panel/80 px-2.5 py-1.5 text-2xs text-fg-3 backdrop-blur">
                <span>Negative</span>
                <span className="h-1.5 w-24 rounded-full" style={{ background: `linear-gradient(90deg, ${sentimentScale(-1)}, ${sentimentScale(0)}, ${sentimentScale(1)})` }} />
                <span>Positive</span>
              </div>
            )}
            {focused && (
              <div className="absolute top-3 left-3 flex max-w-[calc(100%-24px)] items-center gap-2 rounded-md border border-border-strong bg-panel/90 py-1 pr-1 pl-2.5 text-xs backdrop-blur">
                <span className="size-2 shrink-0 rounded-full" style={{ background: clusterColor(focused.id) }} />
                <span className="truncate text-fg">{focused.name}</span>
                <Link href={`/themes?theme=${focused.theme_id}`} className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-fg-3 hover:bg-hover hover:text-accent">
                  Theme <ArrowRight className="size-3" />
                </Link>
                <button onClick={() => setFocus(null)} className="grid size-6 shrink-0 place-items-center rounded text-fg-3 hover:bg-hover hover:text-fg" aria-label="Clear cluster filter">
                  <X className="size-3.5" />
                </button>
              </div>
            )}
          </Card>
          <Card className="flex max-h-[calc(100dvh-230px)] min-h-0 flex-col">
            <div className="flex items-baseline justify-between px-4 pt-4 pb-2">
              <h3 className="text-[13px] font-medium text-fg">Clusters</h3>
              <span className="text-2xs text-fg-3">Click to isolate</span>
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              {isLoading || !data
                ? Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="mx-2 my-1.5 h-8" />)
                : clusters.map((c) => {
                    const s = sentByCluster.get(c.id) ?? 0;
                    return (
                      <li key={c.id}>
                        <button
                          onClick={() => setFocus(focus === c.id ? null : c.id)}
                          className={cn(
                            "flex h-9 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] transition-colors",
                            focus === c.id ? "bg-hover text-fg" : focus !== null ? "text-fg-3 hover:text-fg-2" : "text-fg-2 hover:bg-hover/60 hover:text-fg",
                          )}
                        >
                          <span className="size-2 shrink-0 rounded-full" style={{ background: clusterColor(c.id) }} />
                          <span className="flex-1 truncate">{c.name}</span>
                          <span className="size-1.5 shrink-0 rounded-full" style={{ background: sentimentScale(s * 1.2) }} title={`Mean sentiment ${s.toFixed(2)}`} />
                          <span className="w-10 text-right text-2xs text-fg-3 tnum">{fmt.compact(c.count)}</span>
                        </button>
                      </li>
                    );
                  })}
            </ul>
          </Card>
        </div>
      )}
    </PageContainer>
  );
}
