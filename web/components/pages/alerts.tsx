"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, Radar, Sparkles, TrendingUp, Zap } from "lucide-react";
import type { Alert } from "@/lib/types";
import { useAlerts } from "@/lib/queries";
import { C, SENTIMENT_COLOR, URGENCY_COLOR } from "@/lib/colors";
import { fmt } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Badge, Segmented, Skeleton } from "@/components/ui/primitives";
import { EChart, axisCommon, legendCommon, tipRow, tipTitle, tooltipCommon } from "@/components/charts/echart";
import { CitedMarkdown, FeedbackCard } from "@/components/common/feedback";
import { SeverityBadge } from "@/components/common/badges";
import { EmptyState, ErrorState, PageContainer, PageHeader } from "@/components/common/states";
import { useReveal } from "@/components/common/motion";
import { ChartSkeleton } from "@/components/common/kpi";

function AlertChart({ a }: { a: Alert }) {
  const option = useMemo(() => {
    const s = a.series;
    const anomalies = s.map((d) => (d.count > d.upper ? d.count : null));
    const iStart = s.findIndex((d) => d.date >= a.start_date);
    const iPeak = s.findIndex((d) => d.date === a.peak_date);
    return {
      grid: { left: 4, right: 8, top: 32, bottom: 4, containLabel: true },
      legend: { ...legendCommon, top: 0, left: 0, data: ["Negative / day", "Expected", "Expected band", "Anomaly"] },
      tooltip: {
        ...tooltipCommon,
        trigger: "axis",
        axisPointer: { type: "line", lineStyle: { color: C.borderStrong } },
        formatter: (ps: { dataIndex: number }[]) => {
          const d = s[ps[0].dataIndex];
          const out = d.count > d.upper;
          return (
            tipTitle(fmt.dateLong(d.date)) +
            tipRow(out ? SENTIMENT_COLOR.negative : C.text, "Observed", fmt.int(d.count)) +
            tipRow(C.text3, "Expected", d.expected.toFixed(1)) +
            tipRow("rgba(125,129,139,.35)", "Upper bound", d.upper.toFixed(1)) +
            (out ? `<div style="margin-top:4px;color:${SENTIMENT_COLOR.negative};font-size:11px">Outside expected band</div>` : "")
          );
        },
      },
      xAxis: {
        type: "category",
        data: s.map((d) => d.date),
        boundaryGap: false,
        ...axisCommon,
        splitLine: { show: false },
        axisLabel: { ...axisCommon.axisLabel, formatter: (v: string) => fmt.date(v), hideOverlap: true },
      },
      yAxis: { type: "value", ...axisCommon, axisLine: { show: false }, splitNumber: 4 },
      series: [
        // band = stacked (expected baseline transparent) + (upper - expected)
        { name: "band-base", type: "line", stack: "band", symbol: "none", lineStyle: { opacity: 0 }, data: s.map((d) => d.expected), silent: true, tooltip: { show: false } },
        {
          name: "Expected band",
          type: "line",
          stack: "band",
          symbol: "none",
          lineStyle: { opacity: 0 },
          areaStyle: { color: "rgba(125,129,139,0.16)" },
          color: "rgba(125,129,139,0.5)",
          data: s.map((d) => +(d.upper - d.expected).toFixed(2)),
          silent: true,
        },
        {
          name: "Expected",
          type: "line",
          symbol: "none",
          color: C.text3,
          lineStyle: { width: 1, type: [4, 3], color: C.text3 },
          data: s.map((d) => d.expected),
        },
        {
          name: "Negative / day",
          type: "line",
          symbol: "none",
          smooth: 0.2,
          color: C.text,
          lineStyle: { width: 1.5, color: "#d5d7dc" },
          data: s.map((d) => d.count),
          markArea:
            iStart >= 0
              ? {
                  silent: true,
                  itemStyle: { color: "rgba(229,99,106,0.07)" },
                  data: [[{ xAxis: s[iStart].date }, { xAxis: s[Math.min(s.length - 1, iPeak + Math.max(3, iPeak - iStart))].date }]],
                }
              : undefined,
          markPoint:
            iPeak >= 0
              ? {
                  symbol: "circle",
                  symbolSize: 9,
                  itemStyle: { color: SENTIMENT_COLOR.negative, borderColor: C.panel, borderWidth: 2 },
                  label: {
                    show: true,
                    position: "top",
                    distance: 6,
                    color: C.text,
                    fontSize: 11,
                    formatter: () => `peak ${a.observed}`,
                  },
                  data: [{ coord: [s[iPeak].date, s[iPeak].count] }],
                }
              : undefined,
        },
        {
          name: "Anomaly",
          type: "scatter",
          symbolSize: 6,
          color: SENTIMENT_COLOR.negative,
          itemStyle: { color: SENTIMENT_COLOR.negative },
          data: anomalies,
          z: 5,
        },
      ],
    };
  }, [a]);
  return <EChart option={option} height={240} />;
}

function AlertCard({ a }: { a: Alert }) {
  const lift = a.observed / Math.max(0.1, a.baseline);
  const sevColor = URGENCY_COLOR[a.severity];
  return (
    <Card data-reveal className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3">
        <span className="size-2 rounded-full" style={{ background: sevColor, boxShadow: `0 0 0 4px ${sevColor}22` }} aria-hidden />
        <h3 className="text-[14px] font-medium text-fg">{a.theme_name}</h3>
        <SeverityBadge severity={a.severity} />
        <Badge>
          {a.kind === "spike" ? <Zap className="size-3" /> : <Sparkles className="size-3" />}
          {a.kind === "spike" ? "Volume spike" : "Emerging theme"}
        </Badge>
        <div className="ml-auto flex items-center gap-4 text-xs text-fg-3 tnum">
          <span>
            Started <span className="text-fg-2">{fmt.date(a.start_date)}</span>
          </span>
          <span>
            Peak <span className="text-fg-2">{fmt.date(a.peak_date)}</span>
          </span>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-12">
        <div className="min-w-0 border-border p-4 lg:col-span-7 lg:border-r">
          <div className="mb-3 grid grid-cols-3 gap-3">
            {[
              { l: "Observed at peak", v: fmt.int(a.observed), c: SENTIMENT_COLOR.negative },
              { l: "Expected / day", v: a.baseline.toFixed(1) },
              { l: "Anomaly score", v: a.score.toFixed(1), sub: `${lift.toFixed(1)}× baseline` },
            ].map((m) => (
              <div key={m.l} className="min-w-0">
                <div className="truncate text-2xs text-fg-3">{m.l}</div>
                <div className="mt-0.5 flex items-baseline gap-1.5">
                  <span className="text-lg font-semibold tnum" style={{ color: m.c ?? C.text }}>
                    {m.v}
                  </span>
                  {m.sub && <span className="hidden text-2xs text-fg-3 sm:inline">{m.sub}</span>}
                </div>
              </div>
            ))}
          </div>
          <AlertChart a={a} />
        </div>
        <div className="flex min-w-0 flex-col gap-4 p-4 lg:col-span-5">
          {a.summary && (
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-2xs font-medium tracking-wide text-fg-3 uppercase">
                <Sparkles className="size-3 text-accent" /> What happened
              </div>
              <CitedMarkdown text={a.summary} citations={a.evidence} />
            </div>
          )}
          <div>
            <div className="mb-2 text-2xs font-medium tracking-wide text-fg-3 uppercase">Evidence</div>
            <div className="flex flex-col gap-2">
              {a.evidence.slice(0, 2).map((f) => (
                <FeedbackCard key={f.id} f={f} compact />
              ))}
            </div>
          </div>
          <Link href={`/themes?theme=${a.theme_id}`} className="mt-auto inline-flex items-center gap-1 self-start text-xs text-fg-3 hover:text-accent">
            Investigate theme <ArrowRight className="size-3" />
          </Link>
        </div>
      </div>
    </Card>
  );
}

export function AlertsPage() {
  const { data, isLoading, error, refetch } = useAlerts();
  const [filter, setFilter] = useState<"all" | "spike" | "emerging_theme">("all");
  const list = (data ?? []).filter((a) => filter === "all" || a.kind === filter);
  const ref = useReveal(!!data, [filter]);
  const counts = useMemo(() => {
    const c = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const a of data ?? []) c[a.severity]++;
    return c;
  }, [data]);

  return (
    <PageContainer>
      <PageHeader
        title="Emerging issues"
        description="Daily negative volume per theme is compared with its trailing 14-day mean; counts are treated as Poisson, so a day is flagged when z = (observed − expected) / √(expected + 1) ≥ 4. Themes whose volume mostly arrived recently are flagged as emerging."
        actions={
          <Segmented
            aria-label="Alert type"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "spike", label: "Spikes" },
              { value: "emerging_theme", label: "Emerging" },
            ]}
          />
        }
      />
      {error ? (
        <Card>
          <ErrorState error={error} onRetry={() => refetch()} />
        </Card>
      ) : isLoading || !data ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-14 rounded-lg" />
          {[0, 1].map((i) => (
            <Card key={i} className="p-4">
              <Skeleton className="mb-4 h-4 w-1/3" />
              <ChartSkeleton height={240} />
            </Card>
          ))}
        </div>
      ) : (
        <div ref={ref} className="flex flex-col gap-4">
          <div data-reveal className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border bg-panel px-4 py-3 text-xs">
            <span className="flex items-center gap-2 text-fg-2">
              <Radar className="size-3.5 text-accent" />
              <span className="tnum">{data.length}</span> open alerts
            </span>
            {(Object.keys(counts) as (keyof typeof counts)[]).map((k) => (
              <span key={k} className="flex items-center gap-1.5 text-fg-3">
                <span className="size-1.5 rounded-full" style={{ background: URGENCY_COLOR[k] }} />
                {fmt.label(k)} <span className="text-fg-2 tnum">{counts[k]}</span>
              </span>
            ))}
            <span className="ml-auto flex items-center gap-1.5 text-fg-3">
              <TrendingUp className="size-3.5" /> Baseline: trailing 14 days · threshold z ≥ 4
            </span>
          </div>
          {list.length === 0 ? (
            <Card>
              <EmptyState title="No alerts of this type" body="Nothing is outside its expected band right now." />
            </Card>
          ) : (
            list.map((a) => <AlertCard key={a.id} a={a} />)
          )}
        </div>
      )}
    </PageContainer>
  );
}
