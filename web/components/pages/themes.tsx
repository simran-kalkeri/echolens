"use client";
import { Suspense, useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, Search } from "lucide-react";
import type { Theme, ThemesResponse } from "@/lib/types";
import { useThemes } from "@/lib/queries";
import { sliceByRange, useApp } from "@/lib/store";
import { C, SENTIMENT_COLOR, sentimentScale } from "@/lib/colors";
import { cn, fmt } from "@/lib/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Segmented, Skeleton } from "@/components/ui/primitives";
import { EChart, tipRow, tipTitle, tooltipCommon, FONT } from "@/components/charts/echart";
import { ChartSkeleton, Sparkline, weekly } from "@/components/common/kpi";
import { EmptyState, ErrorState, PageContainer, PageHeader } from "@/components/common/states";
import { ThemeSheet } from "@/components/common/theme-detail";
import { useReveal } from "@/components/common/motion";

type ThemeRow = Theme & { aspectLabel: string; growth: number; spark: number[] };

function Taxonomy({ data, mode, onPick }: { data: ThemesResponse; mode: "sunburst" | "treemap"; onPick: (id: string) => void }) {
  const option = useMemo(() => {
    const tree = data.aspects.map((a) => {
      const score = (a.positive - a.negative) / Math.max(1, a.count);
      return {
        name: a.label,
        value: a.count,
        _score: score,
        itemStyle: { color: mode === "sunburst" ? "#1f2228" : "#15171b", borderColor: C.panel },
        children: a.themes.map((t) => ({
          name: t.name,
          value: t.count,
          id: t.id,
          _score: t.sentiment_score,
          _neg: t.neg_share,
          itemStyle: { color: sentimentScale(t.sentiment_score * 1.25) },
        })),
      };
    });
    const tooltip = {
      ...tooltipCommon,
      formatter: (p: { name: string; value: number; data: { _neg?: number; _score?: number } }) =>
        tipTitle(p.name) +
        tipRow(C.text3, "Mentions", fmt.int(p.value)) +
        (p.data._neg != null ? tipRow(SENTIMENT_COLOR.negative, "Negative", fmt.share(p.data._neg)) : "") +
        (p.data._score != null ? tipRow("transparent", "Sentiment", fmt.signed(p.data._score, 2)) : ""),
    };
    if (mode === "sunburst")
      return {
        tooltip,
        series: [
          {
            type: "sunburst",
            data: tree,
            radius: ["14%", "96%"],
            sort: undefined,
            nodeClick: false,
            emphasis: { focus: "ancestor" },
            itemStyle: { borderColor: C.panel, borderWidth: 2, borderRadius: 3 },
            label: { color: C.text, fontSize: 11, fontFamily: FONT, minAngle: 9, overflow: "truncate" },
            levels: [
              {},
              { r0: "14%", r: "40%", label: { rotate: "tangential", color: C.text2, fontSize: 10.5, minAngle: 22 } },
              { r0: "41%", r: "96%", label: { align: "right", rotate: "radial", width: 150, padding: 4, color: "#f2f3f5", minAngle: 6 } },
            ],
          },
        ],
      };
    return {
      tooltip,
      series: [
        {
          type: "treemap",
          data: tree,
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          upperLabel: { show: true, height: 22, color: C.text2, fontSize: 11, fontFamily: FONT, padding: [0, 6] },
          label: { show: true, color: "#f2f3f5", fontSize: 11, fontFamily: FONT, overflow: "break", padding: 6 },
          itemStyle: { borderColor: C.panel, gapWidth: 2, borderRadius: 4 },
          levels: [
            { itemStyle: { borderColor: C.panel, borderWidth: 0, gapWidth: 4 } },
            { itemStyle: { borderColor: "#1f2228", borderWidth: 2, gapWidth: 2 }, upperLabel: { show: true } },
            { itemStyle: { borderColor: C.panel, borderWidth: 0 } },
          ],
        },
      ],
    };
  }, [data, mode]);
  return (
    <EChart
      option={option}
      height={mode === "treemap" ? 400 : 480}
      onEvents={{
        click: (p) => {
          const id = (p as { data?: { id?: string } }).data?.id;
          if (id) onPick(id);
        },
      }}
    />
  );
}

type SortKey = "count" | "neg_share" | "growth";

function ThemeTable({ rows, onPick, sort, setSort }: { rows: ThemeRow[]; onPick: (id: string) => void; sort: SortKey; setSort: (s: SortKey) => void }) {
  const Th = ({ k, children, className }: { k?: SortKey; children: React.ReactNode; className?: string }) => (
    <th className={cn("h-9 px-3 text-left text-2xs font-medium tracking-wide text-fg-3 uppercase", className)}>
      {k ? (
        <button onClick={() => setSort(k)} className={cn("inline-flex items-center gap-1 uppercase hover:text-fg-2", sort === k && "text-fg-2")}>
          {children}
          {sort === k && <ArrowDown className="size-3" />}
        </button>
      ) : (
        children
      )}
    </th>
  );
  if (!rows.length) return <EmptyState title="No themes match" body="Try a different search term." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-[13px]">
        <thead className="border-b border-border">
          <tr>
            <Th>Theme</Th>
            <Th className="hidden md:table-cell">Aspect</Th>
            <Th k="count" className="text-right">Mentions</Th>
            <Th k="neg_share">Negative</Th>
            <Th k="growth" className="text-right">30d</Th>
            <Th>Trend</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} onClick={() => onPick(t.id)} className="group cursor-pointer border-b border-border/70 transition-colors last:border-b-0 hover:bg-hover/50">
              <td className="max-w-[280px] px-3 py-2.5">
                <button className="block w-full truncate text-left text-fg group-hover:text-accent" onClick={() => onPick(t.id)}>
                  {t.name}
                </button>
                <div className="mt-0.5 truncate font-mono text-2xs text-fg-3">{t.keywords.slice(0, 3).join(" · ")}</div>
              </td>
              <td className="hidden px-3 py-2.5 text-xs text-fg-2 md:table-cell">{t.aspectLabel}</td>
              <td className="px-3 py-2.5 text-right text-fg tnum">{fmt.int(t.count)}</td>
              <td className="px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-20 overflow-hidden rounded-full bg-raised">
                    <div className="h-full rounded-full" style={{ width: `${t.neg_share * 100}%`, background: sentimentScale(t.sentiment_score * 1.25) }} />
                  </div>
                  <span className="text-xs text-fg-2 tnum">{fmt.share(t.neg_share)}</span>
                </div>
              </td>
              <td className={cn("px-3 py-2.5 text-right text-xs tnum", t.growth > 15 && t.neg_share > 0.5 ? "text-neg" : t.growth < -15 ? "text-pos" : "text-fg-2")}>
                {fmt.signed(t.growth, 0)}%
              </td>
              <td className="px-3 py-2.5">
                <Sparkline data={t.spark} color={t.neg_share > 0.5 ? SENTIMENT_COLOR.negative : SENTIMENT_COLOR.positive} width={88} height={22} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ThemesInner() {
  const { data, isLoading, error, refetch } = useThemes();
  const range = useApp((s) => s.range);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selected = params.get("theme");
  const [mode, setMode] = useState<"sunburst" | "treemap">("treemap");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("count");
  const ref = useReveal(!!data);

  const setSelected = useCallback(
    (id: string | null) => {
      const sp = new URLSearchParams(params.toString());
      if (id) sp.set("theme", id);
      else sp.delete("theme");
      router.replace(`${pathname}${sp.size ? `?${sp}` : ""}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const rows: ThemeRow[] = useMemo(() => {
    if (!data) return [];
    const all = data.aspects.flatMap((a) =>
      a.themes.map((t) => {
        const tr = t.trend.map((d) => d.count);
        const cur = tr.slice(-30).reduce((s, v) => s + v, 0);
        const prev = tr.slice(-60, -30).reduce((s, v) => s + v, 0);
        const scoped = sliceByRange(t.trend, range);
        return {
          ...t,
          count: range === "all" ? t.count : scoped.reduce((s, d) => s + d.count, 0),
          aspectLabel: a.label,
          growth: ((cur - prev) / Math.max(1, prev)) * 100,
          spark: weekly(scoped.map((d) => d.count)),
        };
      }),
    );
    const ql = q.trim().toLowerCase();
    const filtered = ql ? all.filter((t) => `${t.name} ${t.keywords.join(" ")} ${t.aspectLabel}`.toLowerCase().includes(ql)) : all;
    return filtered.sort((a, b) => b[sort] - a[sort]);
  }, [data, q, sort, range]);

  return (
    <PageContainer>
      <PageHeader
        title="Themes"
        description="A two-level taxonomy: fixed aspects (L1) and themes discovered by clustering embeddings and named by an LLM (L2). Colour encodes sentiment, from red (negative) to green (positive)."
      />
      {error ? (
        <Card>
          <ErrorState error={error} onRetry={() => refetch()} />
        </Card>
      ) : (
        <div ref={ref} className="flex flex-col gap-4">
          <Card data-reveal>
            <CardHeader
              title="Taxonomy"
              description="Aspect → theme, sized by mentions. Click a theme to open it."
              action={
                <Segmented
                  aria-label="Taxonomy chart type"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: "treemap", label: "Treemap" },
                    { value: "sunburst", label: "Sunburst" },
                  ]}
                />
              }
            />
            <CardBody>
              {data ? <Taxonomy data={data} mode={mode} onPick={setSelected} /> : <ChartSkeleton height={400} />}
              <div className="mt-3 flex items-center gap-2 text-2xs text-fg-3">
                <span>Negative</span>
                <span className="h-1.5 flex-1 rounded-full" style={{ background: `linear-gradient(90deg, ${sentimentScale(-1)}, ${sentimentScale(0)}, ${sentimentScale(1)})` }} />
                <span>Positive</span>
              </div>
            </CardBody>
          </Card>
          <Card data-reveal className="min-w-0">
            <CardHeader
              title={`All themes${data ? ` · ${rows.length}` : ""}`}
              description="Sorted by the selected column"
              action={
                <div className="relative w-full sm:w-56">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-3" />
                  <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter themes" className="pl-8" aria-label="Filter themes" />
                </div>
              }
            />
            <CardBody className="px-1 pb-1">
              {isLoading || !data ? (
                <div className="flex flex-col gap-2 p-3">
                  {Array.from({ length: 9 }).map((_, i) => (
                    <Skeleton key={i} className="h-10" />
                  ))}
                </div>
              ) : (
                <ThemeTable rows={rows} onPick={setSelected} sort={sort} setSort={setSort} />
              )}
            </CardBody>
          </Card>
        </div>
      )}
      <ThemeSheet id={selected} onClose={() => setSelected(null)} onSelectTheme={setSelected} />
    </PageContainer>
  );
}

export function ThemesPage() {
  return (
    <Suspense>
      <ThemesInner />
    </Suspense>
  );
}
