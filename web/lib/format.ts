import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const nf = new Intl.NumberFormat("en-US");
const cf = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export const fmt = {
  int: (n: number) => nf.format(Math.round(n)),
  compact: (n: number) => cf.format(n),
  pct: (n: number, digits = 1) => `${n.toFixed(digits)}%`,
  share: (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`,
  signed: (n: number, digits = 1) => `${n > 0 ? "+" : ""}${n.toFixed(digits)}`,
  date: (iso: string) =>
    new Date(iso.length === 10 ? iso + "T00:00:00Z" : iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
  dateLong: (iso: string) =>
    new Date(iso.length === 10 ? iso + "T00:00:00Z" : iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }),
  duration: (raw: number) => {
    const s = Math.round(raw);
    return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  },
  label: (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
};
