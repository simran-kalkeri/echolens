"use client";
import { useMemo, useState } from "react";
import { Check, X, Minus } from "lucide-react";
import type { EvalResponse, MetricRow } from "@/lib/types";
import { useEval } from "@/lib/queries";
import { C, CATEGORICAL, SENTIMENT_COLOR } from "@/lib/colors";
import { cn, fmt } from "@/lib/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Segmented, Skeleton } from "@/components/ui/primitives";
import { EChart, axisCommon, legendCommon, tipRow, tipTitle, tooltipCommon, FONT } from "@/components/charts/echart";
import { ErrorState, PageContainer, PageHeader } from "@/components/common/states";
import { useReveal, CountUp } from "@/components/common/motion";
import { KpiSkeleton } from "@/components/common/kpi";

function fmtMetric(m: Pick<MetricRow, "value" | "unit">, v = m.value) {
  if (m.unit === "%") return `${v.toFixed(1)}%`;
  if (m.unit === "USD") return `$${v < 0.01 ? v.toFixed(3) : v.toFixed(2)}`;
  if (m.unit) return `${Number.isInteger(v) ? v : v.toFixed(1)}${m.unit.startsWith("/") ? "" : " "}${m.unit}`;
  if (Math.abs(v) <= 1) return v.toFixed(3);
  return fmt.int(v);
}

function PassPill({ passed }: { passed?: boolean }) {
  if (passed === undefined)
    return (
      <span className="inline-flex h-5 items-center gap-1 rounded-sm border border-border px-1.5 text-2xs text-fg-3">
        <Minus className="size-3" /> info
      </span>
    );
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-sm px-1.5 text-2xs font-medium",
        passed ? "bg-pos/15 text-pos" : "bg-neg/15 text-neg",
      )}
    >
      {passed ? <Check className="size-3" /> : <X className="size-3" />}
      {passed ? "Pass" : "Fail"}
    </span>
  );
}

function HeadlineTile({ m }: { m: MetricRow }) {
  const lowerBetter = /latency|delay|false|cost|noise|ece/i.test(m.name);
  const delta = m.baseline != null ? m.value - m.baseline : null;
  return (
    <div data-reveal className="flex flex-col rounded-lg border border-border bg-panel p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs text-fg-3">{m.name}</span>
        <PassPill passed={m.passed} />
      </div>
      <div className="mt-3 text-[26px] leading-none font-semibold tracking-[-0.02em] text-fg">
        <CountUp value={m.value} format={(v) => fmtMetric(m, v)} />
      </div>
      <div className="mt-3 flex flex-col gap-1 text-2xs text-fg-3 tnum">
        {m.threshold != null && (
          <div className="flex items-center gap-2">
            <span className="relative h-1 flex-1 rounded-full bg-raised">
              <span
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${Math.min(100, (m.value / Math.max(m.value, m.threshold) ) * 100)}%`, background: m.passed ? SENTIMENT_COLOR.positive : SENTIMENT_COLOR.negative }}
              />
              <span className="absolute -top-1 h-3 w-px bg-fg-2" style={{ left: `${(m.threshold / Math.max(m.value, m.threshold)) * 100}%` }} />
            </span>
            <span>floor {lowerBetter ? "≤" : "≥"} {fmtMetric(m, m.threshold)}</span>
          </div>
        )}
        {delta != null && (
          <span>
            <span className={delta > 0 !== lowerBetter ? "text-pos" : "text-neg"}>
              {delta > 0 ? "+" : ""}
              {Math.abs(delta) < 1 ? delta.toFixed(3) : delta.toFixed(1)}
            </span>{" "}
            vs {m.baseline_name}
          </span>
        )}
      </div>
    </div>
  );
}

function MetricTable({ rows }: { rows: MetricRow[] }) {
  return (
    <table className="w-full text-[13px]">
      <tbody>
        {rows.map((m) => (
          <tr key={m.name} className="border-b border-border/70 last:border-b-0">
            <td className="py-2 pr-3 text-fg-2">{m.name}</td>
            <td className="py-2 pr-3 text-right font-medium text-fg tnum">{fmtMetric(m)}</td>
            <td className="hidden py-2 pr-3 text-right text-2xs text-fg-3 tnum sm:table-cell">
              {m.threshold != null ? `floor ${fmtMetric(m, m.threshold)}` : m.baseline != null ? `${m.baseline_name} ${fmtMetric(m, m.baseline)}` : ""}
            </td>
            <td className="w-16 py-2 text-right">
              <PassPill passed={m.passed} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Confusion({ c }: { c: NonNullable<EvalResponse["classification"][number]["confusion"]> }) {
  const option = useMemo(() => {
    const n = c.labels.length;
    const data: [number, number, number, number][] = [];
    c.matrix.forEach((row, i) => {
      const sum = row.reduce((a, b) => a + b, 0) || 1;
      row.forEach((v, j) => data.push([j, n - 1 - i, v / sum, v]));
    });
    return {
      grid: { left: 4, right: 8, top: 8, bottom: 28, containLabel: true },
      tooltip: {
        ...tooltipCommon,
        formatter: (p: { value: [number, number, number, number] }) =>
          tipTitle(`true ${fmt.label(c.labels[n - 1 - p.value[1]])} → predicted ${fmt.label(c.labels[p.value[0]])}`) +
          tipRow(C.accent, "Count", fmt.int(p.value[3])) +
          tipRow("transparent", "Row share", `${(p.value[2] * 100).toFixed(1)}%`),
      },
      xAxis: {
        type: "category",
        data: c.labels.map(fmt.label),
        name: "Predicted",
        nameLocation: "middle",
        nameGap: 26,
        nameTextStyle: { color: C.text3, fontSize: 10, fontFamily: FONT },
        ...axisCommon,
        axisLine: { show: false },
        splitLine: { show: false },
        axisLabel: { ...axisCommon.axisLabel, interval: 0, fontSize: 10, width: 64, overflow: "truncate" },
      },
      yAxis: {
        type: "category",
        data: [...c.labels].reverse().map(fmt.label),
        ...axisCommon,
        axisLine: { show: false },
        splitLine: { show: false },
        axisLabel: { ...axisCommon.axisLabel, fontSize: 10 },
      },
      visualMap: { show: false, min: 0, max: 1, dimension: 2, inRange: { color: ["#15171b", "#172843", "#1b3f73", "#2a62b3", "#3987e5"] } },
      series: [
        {
          type: "heatmap",
          data,
          itemStyle: { borderColor: C.panel, borderWidth: 2, borderRadius: 3 },
          label: {
            show: true,
            fontSize: 10,
            fontFamily: FONT,
            formatter: (p: { value: [number, number, number, number] }) => (p.value[3] ? String(p.value[3]) : ""),
            color: "#e8e9ec",
          },
          emphasis: { itemStyle: { borderColor: C.text2, borderWidth: 1 } },
        },
      ],
    };
  }, [c]);
  return <EChart option={option} height={Math.max(220, c.labels.length * 40 + 40)} />;
}

function Retrieval({ rows }: { rows: EvalResponse["retrieval"]["by_method"] }) {
  const option = useMemo(() => {
    const metrics = [
      { k: "recall_at_10" as const, n: "Recall@10" },
      { k: "ndcg_at_10" as const, n: "nDCG@10" },
      { k: "mrr" as const, n: "MRR" },
    ];
    return {
      grid: { left: 4, right: 8, top: 36, bottom: 4, containLabel: true },
      legend: { ...legendCommon, top: 0, left: 0 },
      tooltip: {
        ...tooltipCommon,
        trigger: "axis",
        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(255,255,255,0.03)" } },
        formatter: (ps: { dataIndex: number; seriesName: string; color: string; value: number }[]) =>
          tipTitle(rows[ps[0].dataIndex].method) + ps.map((p) => tipRow(p.color, p.seriesName, p.value.toFixed(3))).join(""),
      },
      xAxis: { type: "category", data: rows.map((r) => r.method), ...axisCommon, splitLine: { show: false }, axisLabel: { ...axisCommon.axisLabel, interval: 0, fontSize: 10.5 } },
      yAxis: { type: "value", min: 0.5, max: 0.9, ...axisCommon, axisLine: { show: false } },
      series: metrics.map((m, i) => ({
        name: m.n,
        type: "bar",
        barMaxWidth: 16,
        barGap: "20%",
        color: CATEGORICAL[i],
        itemStyle: { borderRadius: [3, 3, 0, 0] },
        data: rows.map((r) => r[m.k]),
      })),
    };
  }, [rows]);
  return <EChart option={option} height={260} />;
}

export function EvalPage() {
  const { data, isLoading, error, refetch } = useEval();
  const [task, setTask] = useState("sentiment");
  const ref = useReveal(!!data);
  const cls = data?.classification.find((c) => c.task === task) ?? data?.classification[0];
  const passed = data ? [...data.summary].filter((m) => m.passed).length : 0;

  return (
    <PageContainer>
      <PageHeader
        title="Evaluation"
        description="Every model measured against a baseline: classifiers on a test set labelled by the gpt-oss-120b teacher plus the human-labelled SemEval-2014 benchmark, retrieval on paraphrased queries, and trend detection on injected incidents. Floors are regression gates pinned at the first full run."
        actions={
          data && (
            <span className="text-xs text-fg-3 tnum">
              {passed}/{data.summary.length} headline checks passing · generated {fmt.dateLong(data.generated_at)}
            </span>
          )
        }
      />
      {error ? (
        <Card>
          <ErrorState error={error} onRetry={() => refetch()} />
        </Card>
      ) : isLoading || !data || !cls ? (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <KpiSkeleton key={i} />
            ))}
          </div>
          <Skeleton className="h-96 rounded-lg" />
        </div>
      ) : (
        <div ref={ref} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {data.summary.map((m) => (
              <HeadlineTile key={m.name} m={m} />
            ))}
          </div>

          <Card data-reveal>
            <CardHeader
              title="Classification"
              description={`${fmt.label(cls.task)} · ${cls.dataset}`}
              action={
                <Segmented
                  aria-label="Classification task"
                  value={task}
                  onChange={setTask}
                  options={data.classification.map((c) => ({ value: c.task, label: fmt.label(c.task) }))}
                />
              }
            />
            <CardBody className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              <div className="min-w-0 lg:col-span-7">
                <div className="mb-4 flex flex-wrap gap-2">
                  {cls.metrics.map((m) => (
                    <div key={m.name} className="flex items-center gap-2 rounded-md border border-border bg-raised/60 px-3 py-1.5 text-xs">
                      <span className="text-fg-3">{m.name}</span>
                      <span className="font-medium text-fg tnum">{fmtMetric(m)}</span>
                      {m.passed !== undefined && <PassPill passed={m.passed} />}
                    </div>
                  ))}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[440px] text-[13px]">
                    <thead>
                      <tr className="border-b border-border text-left text-2xs tracking-wide text-fg-3 uppercase">
                        <th className="h-8 pr-3 font-medium">Class</th>
                        <th className="h-8 px-3 text-right font-medium">Precision</th>
                        <th className="h-8 px-3 text-right font-medium">Recall</th>
                        <th className="h-8 px-3 font-medium">F1</th>
                        <th className="h-8 pl-3 text-right font-medium">Support</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cls.per_class.map((r) => (
                        <tr key={r.label} className="border-b border-border/70 last:border-b-0">
                          <td className="py-2 pr-3 text-fg-2">{fmt.label(r.label)}</td>
                          <td className="px-3 py-2 text-right text-fg tnum">{r.precision.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right text-fg tnum">{r.recall.toFixed(2)}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-raised">
                                <div className="h-full rounded-full bg-accent" style={{ width: `${r.f1 * 100}%`, opacity: 0.4 + r.f1 * 0.6 }} />
                              </div>
                              <span className="text-fg tnum">{r.f1.toFixed(3)}</span>
                            </div>
                          </td>
                          <td className="py-2 pl-3 text-right text-fg-3 tnum">{fmt.int(r.support)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="min-w-0 lg:col-span-5">
                <div className="mb-2 text-2xs font-medium tracking-wide text-fg-3 uppercase">Confusion matrix · row-normalised</div>
                {cls.confusion ? (
                  <Confusion c={cls.confusion} />
                ) : (
                  <div className="grid h-[220px] place-items-center rounded-md border border-dashed border-border text-xs text-fg-3">
                    Multi-label task: no single confusion matrix
                  </div>
                )}
              </div>
            </CardBody>
          </Card>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <Card data-reveal className="xl:col-span-7">
              <CardHeader title="Retrieval by method" description="Gold query set (200 analyst questions), higher is better" />
              <CardBody>
                <Retrieval rows={data.retrieval.by_method} />
              </CardBody>
            </Card>
            <Card data-reveal className="xl:col-span-5">
              <CardHeader title="Retrieval" />
              <CardBody>
                <MetricTable rows={data.retrieval.metrics} />
              </CardBody>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <Card data-reveal className="min-w-0 xl:col-span-7">
              <CardHeader title="Incident detection" description="Synthetic incidents injected into held-out data; did the detector catch them?" />
              <CardBody>
                <div className="mb-3">
                  <MetricTable rows={data.trends.metrics} />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-[13px]">
                    <thead>
                      <tr className="border-b border-border text-left text-2xs tracking-wide text-fg-3 uppercase">
                        <th className="h-8 pr-3 font-medium">Incident</th>
                        <th className="h-8 px-3 font-medium">Injected</th>
                        <th className="h-8 px-3 font-medium">Detected</th>
                        <th className="h-8 pl-3 text-right font-medium">Delay</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.trends.incidents.map((i) => (
                        <tr key={i.name} className="border-b border-border/70 last:border-b-0">
                          <td className="py-2 pr-3 text-fg-2">{i.name}</td>
                          <td className="px-3 py-2 font-mono text-2xs text-fg-3">{fmt.date(i.injected_at)}</td>
                          <td className="px-3 py-2 font-mono text-2xs">
                            {i.detected_at ? <span className="text-fg-2">{fmt.date(i.detected_at)}</span> : <span className="text-neg">missed</span>}
                          </td>
                          <td className="py-2 pl-3 text-right tnum">
                            {i.delay_days == null ? (
                              <span className="text-fg-3">—</span>
                            ) : (
                              <span className={i.delay_days <= 1 ? "text-pos" : "text-fg-2"}>
                                {i.delay_days}d
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardBody>
            </Card>
            <div className="flex flex-col gap-4 xl:col-span-5">
              <Card data-reveal>
                <CardHeader title="Clustering" />
                <CardBody>
                  <MetricTable rows={data.clustering} />
                </CardBody>
              </Card>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card data-reveal>
              <CardHeader title="Grounding" description="Are the LLM's claims backed by the cited feedback?" />
              <CardBody>
                <MetricTable rows={data.grounding} />
              </CardBody>
            </Card>
            <Card data-reveal>
              <CardHeader title="Cost & latency" />
              <CardBody>
                <MetricTable rows={data.cost} />
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
