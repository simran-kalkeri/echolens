"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { ArrowUp, Check, ChevronRight, CircleStop, Database, LineChart, Search, Share2, Sparkles, X, Wrench, RotateCcw } from "lucide-react";
import type { AnalystEvent, Feedback } from "@/lib/types";
import { askAnalyst } from "@/lib/api";
import { useApp } from "@/lib/store";
import { useWorkspaces } from "@/lib/queries";
import { SENTIMENT_COLOR } from "@/lib/colors";
import { cn } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CitedMarkdown, FeedbackCard, citationOrder } from "@/components/common/feedback";
import { PageContainer } from "@/components/common/states";

type FinalEvent = Extract<AnalystEvent, { type: "final" }>;
type Step = Extract<AnalystEvent, { type: "tool" } | { type: "status" }>;
interface Turn {
  id: number;
  question: string;
  steps: Step[];
  answer: string;
  final: FinalEvent | null;
  error: string | null;
  done: boolean;
  startedAt: number;
  endedAt: number | null;
}

const SUGGESTED: Record<string, string[]> = {
  spotify: [
    "Why are users complaining about shuffle?",
    "What happened with Android 12 crashes in March?",
    "How did users react to the Premium price increase?",
    "Is the offline downloads issue getting worse?",
    "What do users love most about Spotify?",
    "What should the team fix first this quarter?",
  ],
  default: [
    "What is the biggest source of negative feedback?",
    "Which issues are trending up right now?",
    "What do customers praise most?",
    "What should the team fix first?",
  ],
};

const TOOL_ICON: Record<string, typeof Search> = {
  search_feedback: Search,
  get_theme_stats: Database,
  detect_anomalies: LineChart,
  get_related_themes: Share2,
};

function Steps({ steps, done, seconds }: { steps: Step[]; done: boolean; seconds: number | null }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (done) setOpen(false);
  }, [done]);
  const tools = steps.filter((s) => s.type === "tool").length;
  const lastStatus = [...steps].reverse().find((s) => s.type === "status");
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="rounded-lg border border-border bg-panel/60">
      <Collapsible.Trigger className="flex h-9 w-full items-center gap-2 px-3 text-left text-xs text-fg-3 hover:text-fg-2">
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        {done ? (
          <span>
            Worked for {seconds?.toFixed(1)}s · {tools} tool call{tools === 1 ? "" : "s"}
          </span>
        ) : (
          <span className="flex min-w-0 items-center gap-2">
            <span className="size-1.5 shrink-0 animate-pulse-dot rounded-full bg-accent" />
            <span className="truncate">{lastStatus?.type === "status" ? lastStatus.text : "Thinking"}</span>
          </span>
        )}
      </Collapsible.Trigger>
      <Collapsible.Content>
        <ol className="flex flex-col gap-0 border-t border-border px-3 py-2">
          {steps.map((s, i) => {
            if (s.type === "status")
              return (
                <li key={i} className="flex items-start gap-2.5 py-1.5 text-xs text-fg-3">
                  <Sparkles className="mt-0.5 size-3.5 shrink-0 text-accent/70" />
                  {s.text}
                </li>
              );
            const Icon = TOOL_ICON[s.name] ?? Wrench;
            return (
              <li key={i} className="flex items-start gap-2.5 py-1.5">
                <Icon className="mt-0.5 size-3.5 shrink-0 text-fg-3" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-xs text-fg">{s.name}</span>
                    <span className="truncate font-mono text-2xs text-fg-3">
                      {Object.entries(s.args)
                        .map(([k, v]) => `${k}=${typeof v === "string" ? JSON.stringify(v.length > 40 ? v.slice(0, 40) + "…" : v) : v}`)
                        .join(" ")}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-fg-2">{s.summary}</div>
                </div>
                <Check className="mt-0.5 size-3.5 shrink-0 text-pos" />
              </li>
            );
          })}
        </ol>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

function Groundedness({ final }: { final: FinalEvent }) {
  const pct = Math.round(final.groundedness * 100);
  const supported = final.claims.filter((c) => c.supported).length;
  const order = citationOrder(final.answer);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-fg-3">Groundedness</span>
          <span className="text-2xs text-fg-3 tnum">
            {supported}/{final.claims.length} claims supported
          </span>
        </div>
        <div className="mt-1 text-[28px] leading-none font-semibold tracking-[-0.02em] text-fg tnum">{pct}%</div>
        <div className="mt-3 flex h-1.5 gap-[3px]">
          {final.claims.map((c, i) => (
            <span key={i} className="flex-1 rounded-full" style={{ background: c.supported ? SENTIMENT_COLOR.positive : SENTIMENT_COLOR.negative }} />
          ))}
        </div>
      </div>
      <ul className="flex flex-col gap-1.5">
        {final.claims.map((c, i) => (
          <li key={i} className="flex items-start gap-2 rounded-md border border-border bg-raised/50 px-2.5 py-2 text-xs">
            {c.supported ? (
              <span className="mt-px grid size-4 shrink-0 place-items-center rounded-full bg-pos/20"><Check className="size-2.5 text-pos" strokeWidth={3} /></span>
            ) : (
              <span className="mt-px grid size-4 shrink-0 place-items-center rounded-full bg-neg/20"><X className="size-2.5 text-neg" strokeWidth={3} /></span>
            )}
            <span className="flex-1 leading-4 text-fg-2">{c.text}</span>
            {c.citation_ids.length > 0 && (
              <span className="shrink-0 font-mono text-2xs text-fg-3">
                {c.citation_ids.map((id) => `[${order.get(id) ?? "·"}]`).join("")}
              </span>
            )}
            {c.supported && c.citation_ids.length === 0 && <span className="shrink-0 text-2xs text-fg-3">metric</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Sources({ final }: { final: FinalEvent }) {
  const order = citationOrder(final.answer);
  const cited = [...final.citations].sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
  return (
    <div className="flex flex-col gap-2">
      {cited.map((f: Feedback) => (
        <div key={f.id} className="flex gap-2">
          <span className="mt-2.5 w-5 shrink-0 text-right font-mono text-2xs text-fg-3">{order.get(f.id) ?? "–"}</span>
          <FeedbackCard f={f} compact className="flex-1" />
        </div>
      ))}
    </div>
  );
}

export function AnalystPage() {
  const ws = useApp((s) => s.ws);
  const { data: workspaces } = useWorkspaces();
  const wsName = workspaces?.find((w) => w.id === ws)?.name ?? "this workspace";
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const streaming = turns.some((t) => !t.done);
  const latestFinal = [...turns].reverse().find((t) => t.final)?.final ?? null;
  const suggestions = SUGGESTED[ws] ?? SUGGESTED.default;

  useEffect(() => {
    setTurns([]);
    abort.current?.abort();
  }, [ws]);

  const update = (id: number, fn: (t: Turn) => Turn) => setTurns((ts) => ts.map((t) => (t.id === id ? fn(t) : t)));

  const ask = useCallback(
    async (q: string) => {
      const question = q.trim();
      if (!question || streaming) return;
      setInput("");
      const id = Date.now();
      setTurns((ts) => [...ts, { id, question, steps: [], answer: "", final: null, error: null, done: false, startedAt: performance.now(), endedAt: null }]);
      const ctrl = new AbortController();
      abort.current = ctrl;
      try {
        for await (const ev of askAnalyst(ws, question, ctrl.signal)) {
          if (ev.type === "status" || ev.type === "tool") update(id, (t) => ({ ...t, steps: [...t.steps, ev] }));
          else if (ev.type === "token") update(id, (t) => ({ ...t, answer: t.answer + ev.text }));
          else if (ev.type === "final") update(id, (t) => ({ ...t, answer: ev.answer, final: ev }));
          else if (ev.type === "error") update(id, (t) => ({ ...t, error: ev.text }));
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") update(id, (t) => ({ ...t, error: (e as Error).message }));
        else update(id, (t) => ({ ...t, error: t.answer ? null : "Stopped." }));
      } finally {
        update(id, (t) => ({ ...t, done: true, endedAt: performance.now() }));
      }
    },
    [streaming, ws],
  );

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns]);

  const composer = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void ask(input);
      }}
      className="rounded-xl border border-border-strong bg-panel p-2 shadow-[0_8px_32px_rgba(0,0,0,0.35)] focus-within:border-accent/60"
    >
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void ask(input);
          }
        }}
        rows={2}
        placeholder={`Ask anything about ${wsName} feedback…`}
        className="block w-full resize-none bg-transparent px-2 py-1.5 text-sm text-fg placeholder:text-fg-3 focus:outline-none"
        aria-label="Question for the analyst"
      />
      <div className="flex items-center justify-between px-1">
        <span className="text-2xs text-fg-3">Answers cite the feedback they rely on. Enter to send.</span>
        {streaming ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => abort.current?.abort()}>
            <CircleStop /> Stop
          </Button>
        ) : (
          <Button type="submit" size="icon" variant="default" disabled={!input.trim()} aria-label="Send question" className="size-8 rounded-lg">
            <ArrowUp className="!size-4" />
          </Button>
        )}
      </div>
    </form>
  );

  return (
    <PageContainer className="pb-0">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-h-[calc(100dvh-140px)] min-w-0 flex-col">
          {turns.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center py-10">
              <div className="mb-5 grid size-11 place-items-center rounded-xl border border-border bg-panel">
                <Sparkles className="size-5 text-accent" />
              </div>
              <h1 className="text-center text-xl font-semibold tracking-[-0.015em] text-fg sm:text-2xl">Ask the analyst</h1>
              <p className="mt-2 max-w-md text-center text-[13px] leading-5 text-fg-3">
                An agent that searches {wsName} feedback, pulls theme metrics and anomaly scores, then writes an answer where every claim is checked against cited evidence.
              </p>
              <div className="mt-8 w-full max-w-2xl">{composer}</div>
              <div className="mt-4 grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => void ask(s)}
                    className="rounded-lg border border-border bg-panel/50 px-3 py-2.5 text-left text-[13px] text-fg-2 transition-[border-color,color,transform] hover:-translate-y-px hover:border-border-strong hover:text-fg"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between pb-4">
                <h1 className="text-lg font-semibold tracking-[-0.01em] text-fg">AI analyst</h1>
                <Button size="sm" variant="ghost" onClick={() => setTurns([])} disabled={streaming}>
                  <RotateCcw /> New conversation
                </Button>
              </div>
              <div className="flex flex-1 flex-col gap-8 pb-6">
                {turns.map((t) => (
                  <div key={t.id} className="flex flex-col gap-3">
                    <div className="self-end rounded-xl rounded-br-sm border border-border bg-raised px-3.5 py-2 text-[13.5px] text-fg sm:max-w-[80%]">{t.question}</div>
                    {t.steps.length > 0 && <Steps steps={t.steps} done={t.done || !!t.answer} seconds={t.endedAt ? (t.endedAt - t.startedAt) / 1000 : null} />}
                    {t.answer && (
                      <div className="relative">
                        <CitedMarkdown text={t.answer} citations={t.final?.citations ?? []} />
                        {!t.done && <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse-dot bg-accent" aria-hidden />}
                      </div>
                    )}
                    {t.final && (
                      <div className="flex flex-wrap items-center gap-2 text-2xs text-fg-3 xl:hidden">
                        <span className="rounded-sm bg-pos/15 px-1.5 py-0.5 text-pos tnum">{Math.round(t.final.groundedness * 100)}% grounded</span>
                        <span>{t.final.citations.length} sources</span>
                      </div>
                    )}
                    {t.error && <div className="rounded-md border border-neg/30 bg-neg/10 px-3 py-2 text-xs text-[#f2777b]">{t.error}</div>}
                  </div>
                ))}
                {!streaming && turns.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {suggestions
                      .filter((s) => !turns.some((t) => t.question === s))
                      .slice(0, 3)
                      .map((s) => (
                        <button key={s} onClick={() => void ask(s)} className="rounded-full border border-border px-3 py-1 text-xs text-fg-3 hover:border-border-strong hover:text-fg">
                          {s}
                        </button>
                      ))}
                  </div>
                )}
                <div ref={bottom} />
              </div>
              <div className="sticky bottom-0 bg-gradient-to-t from-bg via-bg to-transparent pt-4 pb-4">{composer}</div>
            </>
          )}
        </div>

        <aside className="min-w-0 xl:sticky xl:top-[72px] xl:max-h-[calc(100dvh-96px)] xl:self-start xl:overflow-y-auto">
          {latestFinal ? (
            <div className="flex flex-col gap-4 pb-6">
              <Card className="p-4">
                <Groundedness final={latestFinal} />
              </Card>
              <Card className="p-4">
                <div className="mb-3 flex items-baseline justify-between">
                  <span className="text-xs font-medium text-fg">Sources</span>
                  <span className="text-2xs text-fg-3">{latestFinal.citations.length} cited</span>
                </div>
                <Sources final={latestFinal} />
              </Card>
            </div>
          ) : (
            <Card className="hidden p-4 xl:block">
              <div className="text-xs font-medium text-fg">How answers are checked</div>
              <ol className="mt-3 flex flex-col gap-3 text-xs leading-5 text-fg-3">
                {[
                  "Hybrid retrieval (BM25 + dense, reranked) pulls the most relevant feedback.",
                  "Tools add theme volumes, trends and anomaly scores from the analytics store.",
                  "The answer cites feedback inline as numbered chips; hover one to read it.",
                  "Each claim is verified against its citations with an NLI model; the share supported is the groundedness score.",
                ].map((s, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="grid size-5 shrink-0 place-items-center rounded-full border border-border text-2xs text-fg-2 tnum">{i + 1}</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            </Card>
          )}
        </aside>
      </div>
    </PageContainer>
  );
}

export default AnalystPage;
