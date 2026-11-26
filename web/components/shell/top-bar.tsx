"use client";
import { usePathname } from "next/navigation";
import { CalendarDays, Check, ChevronsUpDown } from "lucide-react";
import { useWorkspaces } from "@/lib/queries";
import { RANGE_LABEL, useApp, type RangePreset } from "@/lib/store";
import { cn, fmt } from "@/lib/format";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/primitives";
import { Select } from "@/components/ui/select";
import { useState } from "react";

const TITLES: Record<string, string> = {
  "/": "Overview",
  "/themes": "Themes",
  "/alerts": "Emerging issues",
  "/analyst": "AI analyst",
  "/explorer": "Feedback explorer",
  "/graph": "Knowledge graph",
  "/galaxy": "Embedding galaxy",
  "/pipeline": "Pipeline",
  "/eval": "Evaluation",
};

function WsAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        "grid size-5 shrink-0 place-items-center rounded-[5px] border border-border-strong bg-hover text-2xs font-semibold text-fg",
        className,
      )}
      aria-hidden
    >
      {name.charAt(0)}
    </span>
  );
}

function WorkspaceSwitcher() {
  const { data } = useWorkspaces();
  const ws = useApp((s) => s.ws);
  const setWs = useApp((s) => s.setWs);
  const [open, setOpen] = useState(false);
  const current = data?.find((w) => w.id === ws);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-[13px] font-medium text-fg transition-colors hover:bg-hover"
          aria-label="Switch workspace"
        >
          <WsAvatar name={current?.name ?? "S"} />
          <span className="truncate">{current?.name ?? "Spotify"}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-fg-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64">
        <div className="px-2 pt-1.5 pb-1 text-2xs font-medium tracking-wide text-fg-3 uppercase">Workspaces</div>
        {data?.map((w) => (
          <button
            key={w.id}
            onClick={() => {
              setWs(w.id);
              setOpen(false);
            }}
            className="flex h-9 w-full items-center gap-2.5 rounded-[5px] px-2 text-left text-[13px] text-fg-2 hover:bg-hover hover:text-fg"
          >
            <WsAvatar name={w.name} />
            <span className="flex-1 truncate">{w.name}</span>
            <span className="text-2xs text-fg-3 tnum">{fmt.compact(w.n_feedback)}</span>
            <Check className={cn("size-3.5 text-accent", w.id === ws ? "opacity-100" : "opacity-0")} />
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export function TopBar({ menuButton }: { menuButton: React.ReactNode }) {
  const pathname = usePathname().replace(/\/$/, "") || "/";
  const range = useApp((s) => s.range);
  const setRange = useApp((s) => s.setRange);
  const title = TITLES[pathname] ?? "";
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-1 border-b border-border bg-bg/85 px-3 backdrop-blur-md sm:gap-2 sm:px-6">
      {menuButton}
      <WorkspaceSwitcher />
      <span className="hidden text-fg-3 sm:inline" aria-hidden>
        /
      </span>
      <span className="hidden truncate text-[13px] text-fg-2 sm:inline">{title}</span>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Select
          aria-label="Date range"
          value={range}
          onChange={(v) => setRange(v as RangePreset)}
          icon={<CalendarDays className="size-3.5 text-fg-3" />}
          className="w-[124px] sm:w-[148px]"
          options={(Object.keys(RANGE_LABEL) as RangePreset[]).map((k) => ({ value: k, label: RANGE_LABEL[k] }))}
        />
      </div>
    </header>
  );
}
