"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Search, Sparkles, X } from "lucide-react";
import type { AspectId, Feedback, Intent, Sentiment, Source, Urgency } from "@/lib/types";
import { useFeedback, useThemes } from "@/lib/queries";
import { ASPECT_LABEL, INTENTS, SENTIMENTS, SOURCES, URGENCIES } from "@/lib/labels";
import { cn, fmt } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Badge, Input, Skeleton } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { ALL, Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { IntentBadge, Rating, SentimentBadge, SentimentDot, SourceBadge, UrgencyBadge } from "@/components/common/badges";
import { FeedbackCard } from "@/components/common/feedback";
import { EmptyState, ErrorState, PageContainer, PageHeader } from "@/components/common/states";

const PAGE_SIZE = 25;

function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

function highlight(text: string, q: string) {
  const terms = q.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  if (!terms.length) return text;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text.split(re).map((p, i) =>
    i % 2 ? (
      <mark key={i} className="rounded-[2px] bg-accent/20 px-0.5 text-fg">
        {p}
      </mark>
    ) : (
      p
    ),
  );
}

function ExplorerInner() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const theme = params.get("theme") ?? undefined;
  const [q, setQ] = useState(params.get("q") ?? "");
  const dq = useDebounced(q);
  const [f, setF] = useState<{ source?: Source; sentiment?: Sentiment; intent?: Intent; urgency?: Urgency; aspect?: AspectId }>({});
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Feedback | null>(null);
  useEffect(() => setPage(1), [dq, f, theme]);

  const { data, isLoading, isFetching, error, refetch } = useFeedback({ q: dq || undefined, theme, page, page_size: PAGE_SIZE, ...f });
  const themes = useThemes();
  const themeName = useMemo(() => themes.data?.aspects.flatMap((a) => a.themes).find((t) => t.id === theme)?.name, [themes.data, theme]);
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const activeFilters = Object.values(f).filter(Boolean).length + (theme ? 1 : 0);

  const set = <K extends keyof typeof f>(k: K) => (v: string) => setF((s) => ({ ...s, [k]: v === ALL ? undefined : (v as (typeof f)[K]) }));
  const opts = (vals: string[], label: (v: string) => string, allLabel: string) => [{ value: ALL, label: allLabel }, ...vals.map((v) => ({ value: v, label: label(v) }))];
  const clearTheme = () => {
    const sp = new URLSearchParams(params.toString());
    sp.delete("theme");
    router.replace(`${pathname}${sp.size ? `?${sp}` : ""}`, { scroll: false });
  };

  return (
    <PageContainer>
      <PageHeader
        title="Feedback explorer"
        description="Every piece of feedback with its predicted sentiment, intent, urgency and aspects. Search the feedback text, then narrow the results with filters."
      />
      <Card className="mb-3 p-3">
        <div className="relative">
          <Sparkles className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-accent" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder='Search by meaning, e.g. "music stops when the screen turns off"'
            className="h-10 pr-10 pl-9 text-sm"
            aria-label="Semantic search"
          />
          {q ? (
            <button onClick={() => setQ("")} className="absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded text-fg-3 hover:text-fg" aria-label="Clear search">
              <X className="size-4" />
            </button>
          ) : (
            <Search className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-fg-3" />
          )}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Select aria-label="Source" value={f.source ?? ALL} onChange={set("source")} options={opts(SOURCES, fmt.label, "All sources")} />
          <Select aria-label="Sentiment" value={f.sentiment ?? ALL} onChange={set("sentiment")} options={opts(SENTIMENTS, fmt.label, "All sentiment")} />
          <Select aria-label="Intent" value={f.intent ?? ALL} onChange={set("intent")} options={opts(INTENTS, fmt.label, "All intents")} />
          <Select aria-label="Urgency" value={f.urgency ?? ALL} onChange={set("urgency")} options={opts(URGENCIES, fmt.label, "All urgency")} />
          <Select
            aria-label="Aspect"
            className="col-span-2 sm:col-span-1"
            value={f.aspect ?? ALL}
            onChange={set("aspect")}
            options={opts(Object.keys(ASPECT_LABEL), (v) => ASPECT_LABEL[v as AspectId], "All aspects")}
          />
        </div>
        {activeFilters > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {theme && (
              <Badge className="h-6 gap-1.5 pr-1">
                Theme: <span className="text-fg">{themeName ?? theme}</span>
                <button onClick={clearTheme} aria-label="Remove theme filter" className="grid size-4 place-items-center rounded-sm hover:bg-hover">
                  <X className="size-3" />
                </button>
              </Badge>
            )}
            <button onClick={() => { setF({}); if (theme) clearTheme(); }} className="text-xs text-fg-3 hover:text-fg">
              Clear all filters
            </button>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5 text-xs text-fg-3">
          <span className="tnum">
            {data ? (
              <>
                <span className="text-fg-2">{fmt.int(data.total)}</span> results{dq && <> for &ldquo;{dq}&rdquo;, ranked by relevance</>}
              </>
            ) : (
              "Loading…"
            )}
          </span>
          {isFetching && !isLoading && <span className="size-1.5 animate-pulse-dot rounded-full bg-accent" aria-label="Updating" />}
        </div>
        {error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading || !data ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : data.items.length === 0 ? (
          <EmptyState title="No feedback matches" body="Loosen a filter or rephrase the search." />
        ) : (
          <>
            {/* desktop table */}
            <div className={cn("hidden overflow-x-auto md:block", isFetching && "opacity-70 transition-opacity")}>
              <table className="w-full border-collapse text-[13px]">
                <thead className="border-b border-border">
                  <tr className="text-left text-2xs tracking-wide text-fg-3 uppercase">
                    <th className="h-9 px-4 font-medium">Feedback</th>
                    <th className="h-9 px-3 font-medium">Sentiment</th>
                    <th className="h-9 px-3 font-medium">Intent</th>
                    <th className="h-9 px-3 font-medium">Urgency</th>
                    <th className="hidden h-9 px-3 font-medium xl:table-cell">Theme</th>
                    <th className="h-9 px-3 font-medium">Source</th>
                    <th className="h-9 px-4 text-right font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((it) => (
                    <tr key={it.id} onClick={() => setOpen(it)} className="cursor-pointer border-b border-border/70 align-top transition-colors last:border-b-0 hover:bg-hover/50">
                      <td className="max-w-[520px] px-4 py-3">
                        <p className="line-clamp-2 leading-5 text-fg">{highlight(it.text, dq)}</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {it.aspects.map((a) => (
                            <span key={a.aspect} className="inline-flex items-center gap-1 text-2xs text-fg-3">
                              <SentimentDot sentiment={a.sentiment} />
                              {ASPECT_LABEL[a.aspect]}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-3"><SentimentBadge sentiment={it.sentiment} /></td>
                      <td className="px-3 py-3"><IntentBadge intent={it.intent} /></td>
                      <td className="px-3 py-3"><UrgencyBadge urgency={it.urgency} /></td>
                      <td className="hidden max-w-[200px] truncate px-3 py-3 text-xs text-fg-2 xl:table-cell">{it.theme_name ?? "—"}</td>
                      <td className="px-3 py-3"><SourceBadge source={it.source} /></td>
                      <td className="px-4 py-3 text-right font-mono text-2xs whitespace-nowrap text-fg-3">{fmt.date(it.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* mobile cards */}
            <div className="flex flex-col gap-2 p-3 md:hidden">
              {data.items.map((it) => (
                <button key={it.id} onClick={() => setOpen(it)} className="text-left">
                  <FeedbackCard f={it} compact />
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
              <span className="text-xs text-fg-3 tnum">
                Page {page} of {pages}
              </span>
              <div className="flex gap-1.5">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                  <ChevronLeft /> Prev
                </Button>
                <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                  Next <ChevronRight />
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)} title="Feedback" description={open ? <span className="font-mono">{open.id}</span> : undefined}>
        {open && (
          <div className="flex flex-col gap-5 p-5">
            <FeedbackCard f={open} />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
              {[
                ["Theme", open.theme_name ?? "Unclustered"],
                ["Sentiment score", fmt.signed(open.sentiment_score, 2)],
                ["Created", fmt.dateLong(open.created_at)],
                ["Workspace", open.ws],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-fg-3">{k}</dt>
                  <dd className="mt-0.5 text-fg tnum">{v}</dd>
                </div>
              ))}
              <div>
                <dt className="text-fg-3">Rating</dt>
                <dd className="mt-0.5">{open.rating != null ? <Rating rating={open.rating} /> : <span className="text-fg-3">—</span>}</dd>
              </div>
            </dl>
            <div>
              <div className="mb-2 text-2xs font-medium tracking-wide text-fg-3 uppercase">Aspect sentiment</div>
              <ul className="flex flex-col gap-1.5">
                {open.aspects.map((a) => (
                  <li key={a.aspect} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-[13px]">
                    <span className="text-fg-2">{ASPECT_LABEL[a.aspect]}</span>
                    <SentimentBadge sentiment={a.sentiment} />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </Sheet>
    </PageContainer>
  );
}

export function ExplorerPage() {
  return (
    <Suspense>
      <ExplorerInner />
    </Suspense>
  );
}
