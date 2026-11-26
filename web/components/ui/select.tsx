"use client";
import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/format";

export const ALL = "__all";

export function Select({
  value,
  onChange,
  options,
  placeholder,
  className,
  icon,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; hint?: string }[];
  placeholder?: string;
  className?: string;
  icon?: React.ReactNode;
  "aria-label"?: string;
}) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onChange}>
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={cn(
          "inline-flex h-8 min-w-0 items-center justify-between gap-2 rounded-md border border-border bg-raised px-2.5 text-[13px] text-fg-2 transition-colors hover:border-border-strong hover:text-fg focus:outline-none focus-visible:border-accent data-[placeholder]:text-fg-3",
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2 truncate">
          {icon}
          <SelectPrimitive.Value placeholder={placeholder}>{options.find((o) => o.value === value)?.label}</SelectPrimitive.Value>
        </span>
        <SelectPrimitive.Icon>
          <ChevronDown className="size-3.5 shrink-0 text-fg-3" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="z-[60] max-h-80 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-border-strong bg-raised p-1 shadow-xl shadow-black/50"
        >
          <SelectPrimitive.Viewport>
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                className="relative flex h-8 cursor-default items-center gap-3 rounded-[4px] pr-8 pl-2 text-[13px] text-fg-2 outline-none select-none data-[highlighted]:bg-hover data-[highlighted]:text-fg"
              >
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                {o.hint && <span className="ml-auto text-2xs text-fg-3 tnum">{o.hint}</span>}
                <SelectPrimitive.ItemIndicator className="absolute right-2">
                  <Check className="size-3.5 text-accent" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
