"use client";
import Link from "next/link";
import { useMemo } from "react";
import { ArrowDownRight, ArrowUpRight, Lightbulb, TrendingUp, Flame, Heart, ArrowRight } from "lucide-react";
import type { Insight, OverviewResponse } from "@/lib/types";
import { useInsights, useOverview, useThemes } from "@/lib/queries";
import { sliceByRange, useApp, RANGE_LABEL } from "@/lib/store";
import { C, CATEGORICAL, INTENT_COLOR, SENTIMENT_COLOR, SOURCE_COLOR, URGENCY_COLOR } from "@/lib/colors";
import { cn, fmt } from "@/lib/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/primitives";
import { EChart, axisCommon, legendCommon, tipRow, tipTitle, tooltipCommon, FONT } from "@/components/charts/echart";
import { ChartSkeleton, KpiSkeleton, KpiTile, Sparkline } from "@/components/common/kpi";
import { ErrorState, PageContainer, PageHeader } from "@/components/common/states";
import { useReveal } from "@/components/common/motion";
import { CitedText } from "@/components/common/feedback";

/* ---------------- charts ---------------- */

function SentimentTrend({ rows }: { rows: OverviewResponse["sentiment_trend"] }) {
  const option = useMemo(() => {
    const keys = ["negative", "neutral", "positive"] as const;
    return {
      grid: { left: 8, right: 12, top: 36, bottom: 4, containLabel: true },
      legend: { ...legendCommon, top: 0, left: 0, data: keys.map((k) => fmt.label(k)) },
      tooltip: {
        ...tooltipCommon,
        trigger: "axis",
        axisPointer: { type: "line", lineStyle: { color: C.borderStrong } },
        formatter: (ps: { dataIndex: number }[]) => {
          const r = rows[ps[0].dataIndex];
          const total = r.positive + r.neutral + r.negative;
          return (
            tipTitle(fmt.dateLong(r.date)) +
            [...keys].reverse().map((k) => tipRow(SENTIMENT_COLOR[k], fmt.label(k), `${fmt.int(r[k])} · ${((r[k] / total) * 100).toFixed(0)}%`)).join("") +
            tipRow("transparent", "Total", fmt.int(total))
          );
        },
      },
      xAxis: {
        type: "category",
        data: rows.map((r) => r.date),
        boundaryGap: false,
        ...axisCommon,
        splitLine: { show: false },
        axisLabel: { ...axisCommon.axisLabel, formatter: (v: string) => fmt.date(v), hideOverlap: true },
      },
      yAxis: { type: "value", ...axisCommon, axisLine: { show: false }, axisLabel: { ...axisCommon.axisLabel, formatter: (v: number) => fmt.compact(v) } },
      series: keys.map((k) => ({
        name: fmt.label(k),
        type: "line",
        stack: "s",
        smooth: 0.3,
        symbol: "none",
        color: SENTIMENT_COLOR[k],
        lineStyle: { width: 1, color: SENTIMENT_COLOR[k] },
        areaStyle: { color: SENTIMENT_COLOR[k], opacity: k === "neutral" ? 0.18 : 0.28 },
        emphasis: { focus: "series" },
        data: rows.map((r) => r[k]),
      })),
    };
  }, [rows]);
  return <EChart option={option} height={280} />;
}

function ThemeStream({ rows }: { rows: OverviewResponse["theme_stream"] }) {
  const option = useMemo(() => {
    const names = rows.length ? Object.keys(rows[0]).filter((k) => k !== "date") : [];
    // 7-day trailing mean keeps the river legible; the tooltip shows the smoothed daily rate
    const data: [string, number, string][] = [];
    rows.forEach((r, i) => {
      const win = rows.slice(Math.max(0, i - 6), i + 1);
      for (const n of names) data.push([r.date, Math.round(win.reduce((s, x) => s + Number(x[n]), 0) / win.length), n]);
    });
    return {
      color: CATEGORICAL,
      legend: { ...legendCommon, top: 0, left: 0, data: names, type: "scroll", pageTextStyle: { color: C.text3 }, pageIconColor: C.text2 },
      tooltip: {
        ...tooltipCommon,
        trigger: "axis",
        axisPointer: { type: "line", lineStyle: { color: C.borderStrong } },
        formatter: (ps: { value: [string, number, string]; color: string }[]) => {
          const sorted = [...ps].sort((a, b) => b.value[1] - a.value[1]);
          return tipTitle(`${fmt.dateLong(ps[0].value[0])} · 7-day avg`) + sorted.map((p) => tipRow(p.color, p.value[2], fmt.int(p.value[1]))).join("");
        },
      },
      singleAxis: {
        top: 44,
        bottom: 24,
        left: 16,
        right: 16,
        type: "time",
        ...axisCommon,
        axisLine: { show: false },
        axisPointer: { animation: true, label: { show: false } },
        splitLine: { show: true, lineStyle: { color: C.grid } },
        axisLabel: { ...axisCommon.axisLabel, formatter: (v: number) => new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric" }) },
      },
      series: [
        {
          type: "themeRiver",
          boundaryGap: ["8%", "8%"],
          emphasis: { itemStyle: { shadowBlur: 0 }, focus: "series" },
          label: { show: false },
          itemStyle: { opacity: 0.9, borderColor: C.bg, borderWidth: 0.5 },
          data,
        },
      ],
    };
  }, [rows]);
  return <EChart option={option} height={300} />;
}

function AspectDiverging({ rows }: { rows: OverviewResponse["aspect_sentiment"] }) {
  const option = useMemo(() => {
    const sorted = [...rows].sort((a, b) => a.negative / (a.negative + a.neutral + a.positive) - b.negative / (b.negative + b.neutral + b.positive));
    const pct = (r: (typeof rows)[number], k: "negative" | "neutral" | "positive") => (r[k] / (r.negative + r.neutral + r.positive)) * 100;
    return {
      grid: { left: 8, right: 16, top: 32, bottom: 8, containLabel: true },
      legend: { ...legendCommon, top: 0, left: 0, data: ["Negative", "Neutral", "Positive"] },
      tooltip: {
        ...tooltipCommon,
        trigger: "axis",
        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(255,255,255,0.03)" } },
        formatter: (ps: { dataIndex: number }[]) => {
          const r = sorted[ps[0].dataIndex];
          return (
            tipTitle(r.label) +
            (["negative", "neutral", "positive"] as const).map((k) => tipRow(SENTIMENT_COLOR[k], fmt.label(k), `${pct(r, k).toFixed(0)}% · ${fmt.int(r[k])}`)).join("")
          );
        },
      },
      xAxis: {
        type: "value",
        min: -100,
        max: 100,
        ...axisCommon,
        axisLabel: { ...axisCommon.axisLabel, formatter: (v: number) => `${Math.abs(v)}%` },
      },
      yAxis: {
        type: "category",
        data: sorted.map((r) => r.label),
        ...axisCommon,
        axisLine: { show: false },
        axisLabel: { ...axisCommon.axisLabel, color: C.text2, width: 150, overflow: "truncate" },
      },
      // one stack; ECharts stacks negative and positive values separately ("samesign"),
      // so the neutral share straddles zero and negative / positive extend outward.
      series: [
        { name: "Neutral", data: sorted.map((r) => -pct(r, "neutral") / 2), color: "#3a3d45" },
        { name: "Negative", data: sorted.map((r) => -pct(r, "negative")), color: SENTIMENT_COLOR.negative, radius: [3, 0, 0, 3] },
        { name: "Neutral", data: sorted.map((r) => pct(r, "neutral") / 2), color: "#3a3d45" },
        { name: "Positive", data: sorted.map((r) => pct(r, "positive")), color: SENTIMENT_COLOR.positive, radius: [0, 3, 3, 0] },
      ].map((s) => ({
        name: s.name,
        type: "bar",
        stack: "d",
        barWidth: 12,
        data: s.data,
        itemStyle: { color: s.color, borderRadius: s.radius ?? 0, borderColor: C.panel, borderWidth: 1 },
        emphasis: { disabled: true },
      })),
    };
  }, [rows]);
  return <EChart option={option} height={Math.max(220, rows.length * 30 + 60)} />;
}

function IntentDonut({ rows }: { rows: OverviewResponse["intent_mix"] }) {
  const total = rows.reduce((s, r) => s + r.count, 0);
  const option = useMemo(
    () => ({
      tooltip: {
        ...tooltipCommon,
        trigger: "item",
        formatter: (p: { name: string; value: number; color: string; percent: number }) => tipRow(p.color, p.name, `${fmt.int(p.value)} · ${p.percent.toFixed(0)}%`),
      },
      series: [
        {
          type: "pie",
          radius: ["62%", "86%"],
          center: ["50%", "50%"],
          padAngle: 1.5,
          itemStyle: { borderRadius: 3, borderColor: C.panel, borderWidth: 2 },
          label: { show: false },
          emphasis: { scale: true, scaleSize: 3 },
          data: rows.map((r) => ({ name: fmt.label(r.intent), value: r.count, itemStyle: { color: INTENT_COLOR[r.intent] } })),
        },
      ],
      graphic: [
        { type: "text", left: "center", top: "42%", style: { text: fmt.compact(total), fill: C.text, fontSize: 20, fontWeight: 600, fontFamily: FONT } },
        { type: "text", left: "center", top: "56%", style: { text: "classified", fill: C.text3, fontSize: 11, fontFamily: FONT } },
      ],
    }),
    [rows, total],
  );
  const sorted = [...rows].sort((a, b) => b.count - a.count);
  return (
    <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-[180px_1fr]">
      <EChart option={option} height={180} />
      <ul className="flex flex-col gap-2">
        {sorted.map((r) => (
          <li key={r.intent} className="flex items-center gap-2 text-xs">
            <span className="size-2 rounded-[2px]" style={{ background: INTENT_COLOR[r.intent] }} />
            <span className="flex-1 text-fg-2">{fmt.label(r.intent)}</span>
            <span className="text-fg-3 tnum">{((r.count / total) * 100).toFixed(1)}%</span>
            <span className="w-14 text-right text-fg tnum">{fmt.compact(r.count)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MixBars({ items }: { items: { key: string; label: string; count: number; color: string }[] }) {
  const total = items.reduce((s, r) => s + r.count, 0);
  const max = Math.max(...items.map((i) => i.count));
  return (
    <ul className="flex flex-col gap-3">
      {items.map((i) => (
        <li key={i.key}>
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 text-fg-2">
              <span className="size-2 rounded-[2px]" style={{ background: i.color }} />
              {i.label}
            </span>
            <span className="text-fg tnum">
              {fmt.compact(i.count)} <span className="text-fg-3">· {((i.count / total) * 100).toFixed(0)}%</span>
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-raised">
            <div className="h-full rounded-full" style={{ width: `${(i.count / max) * 100}%`, background: i.color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function NegCalendar({ rows }: { rows: OverviewResponse["calendar"] }) {
  const option = useMemo(() => {
    const vals = rows.map((r) => r.negative).sort((a, b) => a - b);
    const max = vals[vals.length - 1] ?? 1;
    const min = vals[Math.floor(vals.length * 0.05)] ?? 0;
    const first = rows[0]?.date ?? "2022-01-01";
    const last = rows[rows.length - 1]?.date ?? "2022-06-30";
    return {
      tooltip: {
        ...tooltipCommon,
        formatter: (p: { value: [string, number, number] }) =>
          tipTitle(fmt.dateLong(p.value[0])) +
          tipRow(SENTIMENT_COLOR.negative, "Negative", fmt.int(p.value[1])) +
          tipRow("transparent", "Share of day", `${((p.value[1] / p.value[2]) * 100).toFixed(0)}%`),
      },
      visualMap: {
        min,
        max,
        dimension: 1,
        show: true,
        orient: "horizontal",
        left: 0,
        bottom: 0,
        itemWidth: 10,
        itemHeight: 120,
        text: [fmt.compact(max), fmt.compact(min)],
        textStyle: { color: C.text3, fontSize: 10, fontFamily: FONT },
        inRange: { color: ["#1d1f24", "#3a2427", "#6b2f35", "#a8434a", "#e5636a"] },
      },
      calendar: {
        top: 22,
        left: 32,
        right: 8,
        bottom: 40,
        range: [first, last],
        cellSize: ["auto", 15],
        splitLine: { show: false },
        itemStyle: { color: "#121317", borderColor: C.panel, borderWidth: 3 },
        yearLabel: { show: false },
        dayLabel: { color: C.text3, fontSize: 10, firstDay: 1, nameMap: ["S", "M", "T", "W", "T", "F", "S"], fontFamily: FONT },
        monthLabel: { color: C.text3, fontSize: 11, fontFamily: FONT },
      },
      series: [{ type: "heatmap", coordinateSystem: "calendar", data: rows.map((r) => [r.date, r.negative, r.total]) }],
    };
  }, [rows]);
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        <EChart option={option} height={200} />
      </div>
    </div>
  );
}

function TopMovers({ rows, stream }: { rows: OverviewResponse["top_movers"]; stream?: Record<string, number[]> }) {
  return (
    <ul className="divide-y divide-border">
      {rows.map((m) => {
        const up = m.delta_pct >= 0;
        const bad = up && m.neg_share > 0.5;
        return (
          <li key={m.theme_id}>
            <Link href={`/themes?theme=${m.theme_id}`} className="group flex items-center gap-3 py-2.5 transition-colors">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-fg group-hover:text-accent">{m.name}</div>
                <div className="mt-0.5 flex items-center gap-2 text-2xs whitespace-nowrap text-fg-3 tnum">
                  <span>{fmt.int(m.count)} / 30d</span>
                  <span className="flex items-center gap-1">
                    <span className="h-1 w-10 overflow-hidden rounded-full bg-raised">
                      <span className="block h-full bg-neg" style={{ width: `${m.neg_share * 100}%` }} />
                    </span>
                    {Math.round(m.neg_share * 100)}% neg
                  </span>
                </div>
              </div>
              {stream?.[m.theme_id] && <Sparkline data={stream[m.theme_id]} color={bad ? SENTIMENT_COLOR.negative : C.text3} width={64} height={22} />}
              <span
                className={cn("flex w-16 items-center justify-end gap-0.5 text-xs font-medium tnum", bad ? "text-neg" : up ? "text-fg-2" : "text-pos")}
              >
                {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
                {Math.abs(m.delta_pct).toFixed(0)}%
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

const INSIGHT_META: Record<Insight["kind"], { label: string; icon: typeof Flame; color: string }> = {
  pain_point: { label: "Pain point", icon: Flame, color: SENTIMENT_COLOR.negative },
  emerging: { label: "Emerging", icon: TrendingUp, color: URGENCY_COLOR.high },
  feature_request: { label: "Feature request", icon: Lightbulb, color: C.accent },
  praise: { label: "Praise", icon: Heart, color: SENTIMENT_COLOR.positive },
};

export function InsightCard({ ins }: { ins: Insight }) {
  const meta = INSIGHT_META[ins.kind];
  const Icon = meta.icon;
  return (
    <Card data-reveal className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-2xs font-medium tracking-wide uppercase" style={{ color: meta.color }}>
          <Icon className="size-3.5" />
          {meta.label}
        </span>
        <span className="text-2xs text-fg-3 tnum" title="Share of claims supported by cited feedback">
          {Math.round(ins.groundedness * 100)}% grounded
        </span>
      </div>
      <h3 className="mt-3 text-[14px] leading-5 font-medium text-balance text-fg">{ins.title}</h3>
      <CitedText text={ins.body} citations={ins.citations} className="mt-2 flex-1 text-[13px] leading-5 text-fg-2" />
      {ins.theme_id && (
        <Link href={`/themes?theme=${ins.theme_id}`} className="mt-3 inline-flex items-center gap-1 self-start text-xs text-fg-3 hover:text-accent">
          Open theme <ArrowRight className="size-3" />
        </Link>
      )}
    </Card>
  );
}

/* ---------------- page ---------------- */

export function OverviewPage() {
  const { data, isLoading, error, refetch } = useOverview();
  const insights = useInsights();
  const themes = useThemes();
  const range = useApp((s) => s.range);
  const ref = useReveal(!!data, [range]);

  const view = useMemo(() => {
    if (!data) return null;
    const trend = sliceByRange(data.sentiment_trend, range);
    const stream = sliceByRange(data.theme_stream, range);
    const cal = sliceByRange(data.calendar, range);
    const tot = trend.reduce((s, r) => s + r.negative + r.neutral + r.positive, 0);
    const neg = trend.reduce((s, r) => s + r.negative, 0);
    const pos = trend.reduce((s, r) => s + r.positive, 0);
    const scoped = range !== "all";
    // weekly series of the last 8 weeks per theme, for the movers' sparklines
    const sparks: Record<string, number[]> = {};
    for (const a of themes.data?.aspects ?? [])
      for (const t of a.themes) {
        const daily = t.trend.slice(-56).map((d) => d.count);
        const wk: number[] = [];
        for (let i = 0; i < daily.length; i += 7) wk.push(daily.slice(i, i + 7).reduce((x, y) => x + y, 0));
        sparks[t.id] = wk;
      }
    return {
      trend,
      stream,
      cal,
      sparks,
      kpi: {
        total: scoped ? tot : data.kpis.total,
        negative_pct: scoped ? (neg / tot) * 100 : data.kpis.negative_pct,
        sentiment_index: scoped ? ((pos - neg) / tot) * 100 : data.kpis.sentiment_index,
      },
    };
  }, [data, range, themes.data]);

  return (
    <PageContainer>
      <PageHeader
        title="Overview"
        description={`What customers are saying, how it is trending, and where it hurts. ${range === "all" ? "All time" : `Last ${RANGE_LABEL[range]}`}, all channels.`}
      />
      {error ? (
        <Card>
          <ErrorState error={error} onRetry={() => refetch()} />
        </Card>
      ) : (
        <div ref={ref} className="flex flex-col gap-4">
          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {isLoading || !data || !view ? (
              Array.from({ length: 6 }).map((_, i) => <KpiSkeleton key={i} />)
            ) : (
              <>
                <KpiTile label="Feedback analysed" value={view.kpi.total} format={(n) => fmt.int(n)} hint={`${data.kpis.themes} themes discovered`} />
                <KpiTile
                  label="Sentiment index"
                  value={view.kpi.sentiment_index}
                  format={(n) => fmt.signed(n, 1)}
                  tone={view.kpi.sentiment_index < 0 ? "neg" : "pos"}
                  hint="positive % minus negative %"
                />
                <KpiTile label="Negative share" value={view.kpi.negative_pct} format={(n) => n.toFixed(1)} suffix="%" tone="neg" hint="of all feedback in range" />
                <KpiTile label="Avg. rating" value={data.kpis.avg_rating} format={(n) => n.toFixed(2)} suffix="/ 5" hint="reviews and surveys" />
                <KpiTile label="Open alerts" value={data.kpis.open_alerts} tone={data.kpis.open_alerts ? "warn" : "default"} hint={<Link href="/alerts" className="hover:text-accent">View emerging issues</Link>} />
                <KpiTile label="Critical urgency" value={data.kpis.critical_count} format={(n) => fmt.int(n)} tone="neg" hint="items flagged critical" />
              </>
            )}
          </div>

          {/* trend + movers */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <Card data-reveal className="min-w-0 xl:col-span-7 2xl:col-span-8">
              <CardHeader title="Sentiment over time" description="Daily feedback volume by sentiment" />
              <CardBody>{view ? <SentimentTrend rows={view.trend} /> : <ChartSkeleton height={280} />}</CardBody>
            </Card>
            <Card data-reveal className="min-w-0 xl:col-span-5 2xl:col-span-4">
              <CardHeader title="Top movers" description="Last 30 days vs. prior 30" />
              <CardBody className="pt-0">
                {data && view ? (
                  <TopMovers rows={data.top_movers.slice(0, 7)} stream={view.sparks} />
                ) : (
                  <div className="flex flex-col gap-3 pt-2">
                    {Array.from({ length: 7 }).map((_, i) => (
                      <Skeleton key={i} className="h-9" />
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          </div>

          {/* insights */}
          <div>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-[13px] font-medium text-fg">AI insights</h2>
              <span className="text-2xs text-fg-3">Hover a citation to see the source feedback</span>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              {insights.data
                ? insights.data.map((ins) => <InsightCard key={ins.id} ins={ins} />)
                : insights.error
                  ? <Card className="md:col-span-2 xl:col-span-4"><ErrorState error={insights.error} onRetry={() => insights.refetch()} /></Card>
                  : Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-lg" />)}
            </div>
          </div>

          {/* theme stream */}
          <Card data-reveal>
            <CardHeader title="Theme flow" description="Daily volume of the eight largest themes" />
            <CardBody>{view ? <ThemeStream rows={view.stream} /> : <ChartSkeleton height={300} />}</CardBody>
          </Card>

          {/* aspects + intents */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <Card data-reveal className="xl:col-span-7">
              <CardHeader title="Sentiment by aspect" description="Share of mentions; sorted from most to least negative" />
              <CardBody>{data ? <AspectDiverging rows={data.aspect_sentiment} /> : <ChartSkeleton />}</CardBody>
            </Card>
            <Card data-reveal className="xl:col-span-5">
              <CardHeader title="Intent mix" description="What customers are trying to do" />
              <CardBody>{data ? <IntentDonut rows={data.intent_mix} /> : <ChartSkeleton height={180} />}</CardBody>
            </Card>
          </div>

          {/* calendar + channels */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <Card data-reveal className="min-w-0 xl:col-span-8">
              <CardHeader title="Negative volume calendar" description="Daily count of negative feedback" />
              <CardBody>{view ? <NegCalendar rows={view.cal} /> : <ChartSkeleton height={200} />}</CardBody>
            </Card>
            <Card data-reveal className="xl:col-span-4">
              <CardHeader title="Channels & urgency" />
              <CardBody className="flex flex-col gap-6">
                {data ? (
                  <>
                    <MixBars items={data.channel_mix.map((c) => ({ key: c.source, label: fmt.label(c.source) + "s", count: c.count, color: SOURCE_COLOR[c.source] }))} />
                    <div className="border-t border-border pt-5">
                      <MixBars
                        items={[...data.urgency_mix].reverse().map((u) => ({ key: u.urgency, label: fmt.label(u.urgency), count: u.count, color: URGENCY_COLOR[u.urgency] }))}
                      />
                    </div>
                  </>
                ) : (
                  <ChartSkeleton height={220} />
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
