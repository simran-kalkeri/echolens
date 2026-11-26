"use client";
import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as HoverCardPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/format";

/* ---------- Badge ---------- */
export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border border-border bg-raised px-1.5 text-2xs font-medium text-fg-2",
        className,
      )}
      {...props}
    />
  );
}

/* ---------- Skeleton ---------- */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div aria-hidden style={style} className={cn("skeleton rounded-md", className)} />;
}

/* ---------- Input ---------- */
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-8 w-full rounded-md border border-border bg-raised px-2.5 text-[13px] text-fg placeholder:text-fg-3 transition-colors hover:border-border-strong focus:border-accent focus:outline-none",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

/* ---------- Tooltip ---------- */
export const TooltipProvider = TooltipPrimitive.Provider;
export function Tip({ content, children, side }: { content: React.ReactNode; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <TooltipPrimitive.Root delayDuration={150}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-[60] max-w-xs rounded-md border border-border-strong bg-raised px-2 py-1 text-xs text-fg shadow-lg shadow-black/40"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/* ---------- Popover ---------- */
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export function PopoverContent({ className, sideOffset = 6, align = "start", ...props }: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        sideOffset={sideOffset}
        align={align}
        className={cn("z-[60] rounded-lg border border-border-strong bg-raised p-1 text-fg shadow-xl shadow-black/50 outline-none", className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

/** Hover-or-focus card built on Popover so it also works on touch (tap to open). */
export function HoverCard({ trigger, children, className }: { trigger: React.ReactElement; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), 120);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), 150);
  };
  return (
    <HoverCardPrimitive.Root open={open} onOpenChange={setOpen}>
      <HoverCardPrimitive.Trigger asChild onMouseEnter={show} onMouseLeave={hide}>
        {trigger}
      </HoverCardPrimitive.Trigger>
      <HoverCardPrimitive.Portal>
        <HoverCardPrimitive.Content
          side="top"
          sideOffset={6}
          collisionPadding={12}
          onMouseEnter={show}
          onMouseLeave={hide}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={cn("z-[60] w-80 rounded-lg border border-border-strong bg-raised text-fg shadow-xl shadow-black/50 outline-none", className)}
        >
          {children}
        </HoverCardPrimitive.Content>
      </HoverCardPrimitive.Portal>
    </HoverCardPrimitive.Root>
  );
}

/* ---------- Segmented control ---------- */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  "aria-label": ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode }[];
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("inline-flex rounded-md border border-border bg-raised p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-6 rounded-[4px] px-2.5 text-xs font-medium whitespace-nowrap transition-colors",
            value === o.value ? "bg-hover text-fg shadow-[inset_0_0_0_1px_#2c2f36]" : "text-fg-3 hover:text-fg-2",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
