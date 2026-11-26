"use client";
import * as echarts from "echarts";
import ReactEChartsCore from "echarts-for-react/lib/core";
import { useEffect, useMemo, useState } from "react";
import { GeistSans } from "geist/font/sans";
import { C } from "@/lib/colors";
import { cn } from "@/lib/format";

/* ---------- theme ---------- */
export const FONT = `${GeistSans.style.fontFamily}, ui-sans-serif, system-ui, sans-serif`;
let registered = false;
function ensureTheme() {
  if (registered) return;
  registered = true;
  echarts.registerTheme("echolens", {
    backgroundColor: "transparent",
    textStyle: { fontFamily: FONT, color: C.text2 },
    color: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#0ca30c", "#9085e9", "#e66767"],
  });
}

export const axisCommon = {
  axisLine: { lineStyle: { color: C.border } },
  axisTick: { show: false },
  axisLabel: { color: C.text3, fontSize: 11, fontFamily: FONT },
  splitLine: { lineStyle: { color: C.grid, type: "solid" as const } },
};

export const tooltipCommon = {
  backgroundColor: "#15171b",
  borderColor: "#2c2f36",
  borderWidth: 1,
  padding: [8, 10],
  textStyle: { color: C.text, fontSize: 12, fontFamily: FONT },
  extraCssText: "box-shadow: 0 8px 24px rgba(0,0,0,.45); border-radius: 6px;",
};

export const legendCommon = {
  textStyle: { color: C.text2, fontSize: 11, fontFamily: FONT },
  itemWidth: 10,
  itemHeight: 10,
  itemGap: 14,
  icon: "roundRect",
};

/** Tooltip row html used across charts: swatch + label + right-aligned tabular value. */
export function tipRow(color: string, label: string, value: string) {
  return `<div style="display:flex;align-items:center;gap:8px;min-width:160px;line-height:20px"><span style="width:8px;height:8px;border-radius:2px;background:${color}"></span><span style="color:${C.text2};flex:1">${label}</span><span style="font-variant-numeric:tabular-nums;color:${C.text}">${value}</span></div>`;
}
export function tipTitle(t: string) {
  return `<div style="color:${C.text};font-weight:500;margin-bottom:4px">${t}</div>`;
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const h = () => setReduced(mq.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);
  return reduced;
}

export function EChart({
  option,
  height = 260,
  className,
  onEvents,
}: {
  option: echarts.EChartsCoreOption;
  height?: number | string;
  className?: string;
  onEvents?: Record<string, (params: unknown) => void>;
}) {
  ensureTheme();
  const reduced = usePrefersReducedMotion();
  const merged = useMemo(
    () => ({
      animation: !reduced,
      animationDuration: 700,
      animationEasing: "cubicOut",
      ...option,
    }),
    [option, reduced],
  );
  return (
    <div className={cn("w-full", className)} style={{ height }}>
      <ReactEChartsCore
        echarts={echarts}
        option={merged}
        theme="echolens"
        notMerge
        lazyUpdate
        style={{ height: "100%", width: "100%" }}
        opts={{ renderer: "canvas" }}
        onEvents={onEvents}
      />
    </div>
  );
}
