"use client";
import { AlertTriangle, Inbox, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/format";

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pb-6", className)}>
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-[-0.015em] text-fg sm:text-[22px]">{title}</h1>
        {description && <p className="mt-1 max-w-[70ch] text-[13px] leading-5 text-fg-3">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageContainer({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8", className)}>{children}</div>;
}

export function EmptyState({ title, body, className, icon }: { title: string; body?: string; className?: string; icon?: React.ReactNode }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-10 text-center", className)}>
      <div className="grid size-9 place-items-center rounded-lg border border-border bg-raised text-fg-3">{icon ?? <Inbox className="size-4" />}</div>
      <div className="text-[13px] font-medium text-fg-2">{title}</div>
      {body && <p className="max-w-sm text-xs text-fg-3">{body}</p>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const msg = error instanceof Error ? error.message : "Something went wrong";
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-10 text-center", className)} role="alert">
      <div className="grid size-9 place-items-center rounded-lg border border-[#e5484d]/30 bg-[#e5484d]/10 text-[#f2777b]">
        <AlertTriangle className="size-4" />
      </div>
      <div className="text-[13px] font-medium text-fg-2">Couldn&apos;t load this data</div>
      <p className="max-w-sm font-mono text-2xs text-fg-3">{msg}</p>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry} className="mt-1">
          <RotateCw /> Retry
        </Button>
      )}
    </div>
  );
}
