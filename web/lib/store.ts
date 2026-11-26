"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type RangePreset = "30d" | "90d" | "180d" | "all";

interface AppState {
  ws: string;
  range: RangePreset;
  setWs: (ws: string) => void;
  setRange: (r: RangePreset) => void;
}

export const useApp = create<AppState>()(
  persist(
    (set) => ({
      ws: "spotify",
      range: "all",
      setWs: (ws) => set({ ws }),
      setRange: (range) => set({ range }),
    }),
    { name: "echolens-app", skipHydration: true },
  ),
);

export const RANGE_LABEL: Record<RangePreset, string> = {
  "30d": "30 days",
  "90d": "90 days",
  "180d": "180 days",
  all: "All time",
};

/**
 * The contract has no date params, so the date filter is applied client-side to the
 * daily series. Windows are anchored at the workspace's date_max (data ends 2022-06-30).
 */
export function sliceByRange<T extends { date: string }>(rows: T[], range: RangePreset): T[] {
  if (range === "all" || rows.length === 0) return rows;
  const n = range === "30d" ? 30 : range === "90d" ? 90 : 180;
  return rows.slice(Math.max(0, rows.length - n));
}
