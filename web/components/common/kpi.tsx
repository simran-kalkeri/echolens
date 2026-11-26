"use client";
import { cn } from "@/lib/format";
import { CountUp } from "./motion";
import { Skeleton } from "@/components/ui/primitives";

export function KpiTile({
  label,
  value,
  format,
  hint,
  tone,
  className,
  suffix,
}: {
  label: string;
  value: number | null;
  format?: (n: number) => string;
  hint?: React.ReactNode;
  tone?: "neg" | "pos" | "warn" | "default";
  suffix?: string;
  className?: string;
}) {
  return (
    <div data-reveal className={cn("flex min-w-0 flex-col justify-between rounded-lg border border-border bg-panel p-4", className)}>
      <div className="flex items-center gap-1.5 text-xs text-fg-3">
        {tone && tone !== "default" && (
          <span
            className="size-1.5 rounded-full"
            style={{ background: tone === "neg" ? "#e5636a" : tone === "pos" ? "#3fb68b" : "#ec835a" }}
            aria-hidden
          />
        )}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-3 flex items-baseline gap-1">
        <span className="text-[26px] leading-none font-semibold tracking-[-0.02em] text-fg">
          {value == null ? "—" : <CountUp value={value} format={format} />}
        </span>
        {suffix && <span className="text-sm text-fg-3">{suffix}</span>}
      </div>
      {hint && <div className="mt-2 truncate text-2xs text-fg-3">{hint}</div>}
    </div>
  );
}

export function KpiSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-4 h-6 w-24" />
      <Skeleton className="mt-3 h-2.5 w-28" />
    </div>
  );
}

export function ChartSkeleton({ height = 260 }: { height?: number }) {
  return (
    <div className="flex items-end gap-1.5 px-1" style={{ height }} aria-label="Loading chart">
      {Array.from({ length: 28 }).map((_, i) => (
        <Skeleton key={i} className="flex-1 rounded-sm" style={{ height: `${30 + ((i * 37) % 60)}%` }} />
      ))}
    </div>
  );
}

/** Tiny dependency-free SVG sparkline. */
export function Sparkline({
  data,
  color = "#7d818b",
  width = 96,
  height = 24,
  fill = true,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
  fill?: boolean;
}) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * width, height - 2 - ((v - min) / span) * (height - 4)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const id = `sp${Math.abs(data.reduce((a, b) => (a * 31 + b) | 0, 7))}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block shrink-0 overflow-visible" aria-hidden>
      {fill && (
        <>
          <defs>
            <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${d}L${width},${height}L0,${height}Z`} fill={`url(#${id})`} />
        </>
      )}
      <path d={d} fill="none" stroke={color} strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Weekly-binned series for sparklines (smoother than daily). */
export function weekly(values: number[], bin = 7) {
  const out: number[] = [];
  for (let i = 0; i < values.length; i += bin) out.push(values.slice(i, i + bin).reduce((a, b) => a + b, 0));
  return out;
}
