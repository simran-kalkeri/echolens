"use client";
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/format";

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay fixed inset-0 z-40 bg-black/55" />
        <Dialog.Content
          className={cn(
            "sheet-content fixed inset-y-0 right-0 z-50 flex w-full max-w-[540px] flex-col border-l border-border bg-panel shadow-2xl shadow-black/60 outline-none",
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="text-[15px] font-semibold text-balance text-fg">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description asChild>
                  <div className="mt-1.5 text-xs text-fg-3">{description}</div>
                </Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">Details panel</Dialog.Description>
              )}
            </div>
            <Dialog.Close className="grid size-8 shrink-0 place-items-center rounded-md text-fg-3 hover:bg-hover hover:text-fg" aria-label="Close panel">
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
