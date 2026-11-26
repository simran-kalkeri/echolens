"use client";
import { createContext, useContext, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Feedback } from "@/lib/types";
import { cn, fmt } from "@/lib/format";
import { HoverCard } from "@/components/ui/primitives";
import { IntentBadge, Rating, SentimentBadge, SourceBadge, UrgencyBadge } from "./badges";
import { SENTIMENT_COLOR } from "@/lib/colors";

export function FeedbackCard({ f, className, compact }: { f: Feedback; className?: string; compact?: boolean }) {
  return (
    <article className={cn("relative rounded-md border border-border bg-raised/60 p-3", className)}>
      <span className="absolute top-3 bottom-3 left-0 w-[2px] rounded-r" style={{ background: SENTIMENT_COLOR[f.sentiment] }} aria-hidden />
      <p className={cn("text-[13px] leading-5 text-fg", compact && "line-clamp-3")}>{f.text}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <SentimentBadge sentiment={f.sentiment} />
        <IntentBadge intent={f.intent} />
        {!compact && <UrgencyBadge urgency={f.urgency} />}
        <span className="ml-auto flex items-center gap-2.5">
          <Rating rating={f.rating} />
          <SourceBadge source={f.source} />
          <span className="font-mono text-2xs text-fg-3">{fmt.date(f.created_at)}</span>
        </span>
      </div>
    </article>
  );
}

/* ---------- citations ---------- */
type CiteCtx = { lookup: Map<string, Feedback>; order: Map<string, number> };
const CitationContext = createContext<CiteCtx>({ lookup: new Map(), order: new Map() });

export function CitationChip({ id }: { id: string }) {
  const { lookup, order } = useContext(CitationContext);
  const f = lookup.get(id);
  const n = order.get(id);
  const chip = (
    <button
      type="button"
      className={cn(
        "mx-0.5 inline-flex h-[18px] min-w-[18px] translate-y-[-1px] items-center justify-center rounded-[4px] border px-1 align-middle font-mono text-[10px] font-medium transition-colors",
        f
          ? "border-accent/30 bg-accent-soft text-[#8db6fa] hover:border-accent/60 hover:text-fg"
          : "border-border bg-raised text-fg-3",
      )}
      aria-label={f ? `Citation ${n}: ${f.text.slice(0, 80)}` : `Citation ${id}`}
    >
      {n ?? "#"}
    </button>
  );
  if (!f) return chip;
  return (
    <HoverCard trigger={chip} className="w-[340px] p-0">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="font-mono text-2xs text-fg-3">{f.id}</span>
        {f.theme_name && <span className="truncate pl-3 text-2xs text-fg-3">{f.theme_name}</span>}
      </div>
      <FeedbackCard f={f} className="border-0 bg-transparent" />
    </HoverCard>
  );
}

const CITE_RE = /\[#([A-Za-z0-9_\-]+)\]/g;

export function citationOrder(text: string) {
  const order = new Map<string, number>();
  for (const m of text.matchAll(CITE_RE)) if (!order.has(m[1])) order.set(m[1], order.size + 1);
  return order;
}

/** Markdown renderer that turns inline [#feedback_id] markers into hoverable evidence chips. */
export function CitedMarkdown({ text, citations, className }: { text: string; citations: Feedback[]; className?: string }) {
  const ctx = useMemo(() => ({ lookup: new Map(citations.map((c) => [c.id, c])), order: citationOrder(text) }), [citations, text]);
  // [#id] → [​](cite:id) so react-markdown hands it to our link renderer
  const md = useMemo(() => text.replace(CITE_RE, (_, id) => `[${id}](#cite-${id})`), [text]);
  return (
    <CitationContext.Provider value={ctx}>
      <div className={cn("prose-el", className)}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children }) => {
              if (href?.startsWith("#cite-")) return <CitationChip id={href.slice(6)} />;
              return (
                <a href={href} className="text-accent underline-offset-2 hover:underline" target="_blank" rel="noreferrer">
                  {children}
                </a>
              );
            },
            p: ({ children }) => <p className="mb-3 text-[13.5px] leading-6 text-fg-2 last:mb-0">{children}</p>,
            strong: ({ children }) => <strong className="font-semibold text-fg">{children}</strong>,
            em: ({ children }) => <em className="text-fg not-italic underline decoration-border-strong underline-offset-2">{children}</em>,
            h3: ({ children }) => <h3 className="mt-5 mb-2 text-[13px] font-semibold text-fg first:mt-0">{children}</h3>,
            h2: ({ children }) => <h2 className="mt-5 mb-2 text-sm font-semibold text-fg first:mt-0">{children}</h2>,
            ul: ({ children }) => <ul className="mb-3 flex flex-col gap-1.5 pl-4">{children}</ul>,
            ol: ({ children }) => <ol className="mb-3 list-decimal pl-5">{children}</ol>,
            li: ({ children }) => <li className="list-disc text-[13.5px] leading-6 text-fg-2 marker:text-fg-3">{children}</li>,
            code: ({ children }) => <code className="rounded bg-raised px-1 font-mono text-xs text-fg">{children}</code>,
          }}
        >
          {md}
        </ReactMarkdown>
      </div>
    </CitationContext.Provider>
  );
}

/** Plain text with citations (insight cards). */
export function CitedText({ text, citations, className }: { text: string; citations: Feedback[]; className?: string }) {
  const ctx = useMemo(() => ({ lookup: new Map(citations.map((c) => [c.id, c])), order: citationOrder(text) }), [citations, text]);
  const parts = text.split(/(\[#[A-Za-z0-9_\-]+\])/g);
  return (
    <CitationContext.Provider value={ctx}>
      <p className={className}>
        {parts.map((p, i) => {
          const m = p.match(/^\[#([A-Za-z0-9_\-]+)\]$/);
          return m ? <CitationChip key={i} id={m[1]} /> : <span key={i}>{p}</span>;
        })}
      </p>
    </CitationContext.Provider>
  );
}
