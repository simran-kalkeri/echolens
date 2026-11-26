"use client";
import Link from "next/link";
import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import { useTheme } from "@/lib/queries";
import { ASPECT_LABEL } from "@/lib/labels";
import { C, INTENT_COLOR, SENTIMENT_COLOR, URGENCY_COLOR } from "@/lib/colors";
import { fmt } from "@/lib/format";
import { Badge, Skeleton } from "@/components/ui/primitives";
import { Sheet } from "@/components/ui/sheet";
import { EChart, axisCommon, tipRow, tipTitle, tooltipCommon } from "@/components/charts/echart";
import { CitedMarkdown, FeedbackCard } from "./feedback";
import { ErrorState } from "./states";
import type { ThemeDetailResponse } from "@/lib/types";

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="border-b border-border px-5 py-4 last:border-b-0">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-2xs font-medium tracking-wide text-fg-3 uppercase">{title}</h4>
        {aside}
      </div>
      {children}
    </section>
  );
}

function StackBar({ items }: { items: { key: string; label: string; count: number; color: string }[] }) {
  const total = items.reduce((s, i) => s + i.count, 0) || 1;
  return (
    <div>
      <div className="flex h-2 gap-[2px] overflow-hidden rounded-full">
        {items.filter((i) => i.count > 0).map((i) => (
          <div key={i.key} style={{ width: `${(i.count / total) * 100}%`, background: i.color }} title={`${i.label}: ${fmt.int(i.count)}`} />
        ))}
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
        {items.map((i) => (
          <div key={i.key} className="flex items-center gap-1.5 text-2xs">
            <span className="size-2 shrink-0 rounded-[2px]" style={{ background: i.color }} />
            <span className="truncate text-fg-2">{i.label}</span>
            <span className="ml-auto text-fg-3 tnum">{Math.round((i.count / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrendChart({ t }: { t: ThemeDetailResponse }) {
  const option = useMemo(
    () => ({
      grid: { left: 4, right: 4, top: 8, bottom: 4, containLabel: true },
      tooltip: {
        ...tooltipCommon,
        trigger: "axis",
        formatter: (ps: { dataIndex: number }[]) => tipTitle(fmt.dateLong(t.trend[ps[0].dataIndex].date)) + tipRow(C.accent, "Mentions", fmt.int(t.trend[ps[0].dataIndex].count)),
      },
      xAxis: {
        type: "category",
        data: t.trend.map((d) => d.date),
        boundaryGap: false,
        ...axisCommon,
        splitLine: { show: false },
        axisLabel: { ...axisCommon.axisLabel, formatter: (v: string) => fmt.date(v), hideOverlap: true },
      },
      yAxis: { type: "value", ...axisCommon, axisLine: { show: false }, splitNumber: 3 },
      series: [
        {
          type: "line",
          smooth: 0.3,
          symbol: "none",
          data: t.trend.map((d) => d.count),
          lineStyle: { width: 1.5, color: C.accent },
          areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "rgba(79,143,247,0.25)" }, { offset: 1, color: "rgba(79,143,247,0)" }] } },
        },
      ],
    }),
    [t],
  );
  return <EChart option={option} height={140} />;
}

export function ThemeDetailBody({ id, onSelectTheme }: { id: string; onSelectTheme?: (id: string) => void }) {
  const { data: t, isLoading, error, refetch } = useTheme(id);
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isLoading || !t)
    return (
      <div className="flex flex-col gap-4 p-5">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-24" />
        <Skeleton className="h-36" />
        <Skeleton className="h-20" />
      </div>
    );
  return (
    <div>
      <div className="grid grid-cols-3 border-b border-border">
        {[
          { l: "Mentions", v: fmt.int(t.count) },
          { l: "Negative", v: fmt.share(t.neg_share), c: SENTIMENT_COLOR.negative },
          { l: "Sentiment", v: fmt.signed(t.sentiment_score, 2) },
        ].map((s) => (
          <div key={s.l} className="border-r border-border px-5 py-3 last:border-r-0">
            <div className="text-2xs text-fg-3">{s.l}</div>
            <div className="mt-1 text-lg font-semibold text-fg tnum" style={{ color: s.c }}>
              {s.v}
            </div>
          </div>
        ))}
      </div>
      {t.summary && (
        <Section title="AI summary" aside={<span className="text-2xs text-fg-3">Hover citations for evidence</span>}>
          <CitedMarkdown text={t.summary} citations={t.evidence} />
        </Section>
      )}
      <Section title="Daily mentions">
        <TrendChart t={t} />
      </Section>
      <Section title="Intent">
        <StackBar items={t.intent_mix.map((i) => ({ key: i.intent, label: fmt.label(i.intent), count: i.count, color: INTENT_COLOR[i.intent] }))} />
      </Section>
      <Section title="Urgency">
        <StackBar items={t.urgency_mix.map((i) => ({ key: i.urgency, label: fmt.label(i.urgency), count: i.count, color: URGENCY_COLOR[i.urgency] }))} />
      </Section>
      <Section title="Keywords">
        <div className="flex flex-wrap gap-1.5">
          {t.keywords.map((k) => (
            <Badge key={k} className="font-mono">{k}</Badge>
          ))}
        </div>
      </Section>
      {t.related.length > 0 && (
        <Section title="Related themes">
          <ul className="flex flex-col gap-1">
            {t.related.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => onSelectTheme?.(r.id)}
                  disabled={!onSelectTheme}
                  className="flex h-8 w-full items-center gap-3 rounded-md px-2 text-left text-[13px] text-fg-2 hover:bg-hover hover:text-fg disabled:hover:bg-transparent"
                >
                  <span className="flex-1 truncate">{r.name}</span>
                  <span className="h-1 w-16 overflow-hidden rounded-full bg-raised">
                    <span className="block h-full bg-accent/70" style={{ width: `${Math.min(1, r.weight / 0.6) * 100}%` }} />
                  </span>
                  <span className="w-8 text-right text-2xs text-fg-3 tnum">{r.weight.toFixed(2)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section
        title={`Evidence · ${t.evidence.length}`}
        aside={
          <Link href={`/explorer?theme=${t.id}`} className="inline-flex items-center gap-1 text-2xs text-fg-3 hover:text-accent">
            All feedback <ArrowRight className="size-3" />
          </Link>
        }
      >
        <div className="flex flex-col gap-2">
          {t.evidence.map((f) => (
            <FeedbackCard key={f.id} f={f} />
          ))}
        </div>
      </Section>
    </div>
  );
}

export function ThemeSheet({ id, onClose, onSelectTheme }: { id: string | null; onClose: () => void; onSelectTheme?: (id: string) => void }) {
  const { data } = useTheme(id);
  return (
    <Sheet
      open={!!id}
      onOpenChange={(o) => !o && onClose()}
      title={data?.name ?? "Theme"}
      description={
        data ? (
          <span className="flex flex-wrap items-center gap-2">
            <Badge>{ASPECT_LABEL[data.aspect]}</Badge>
            <span className="text-fg-3">{data.description}</span>
          </span>
        ) : undefined
      }
    >
      {id && <ThemeDetailBody id={id} onSelectTheme={onSelectTheme} />}
    </Sheet>
  );
}
