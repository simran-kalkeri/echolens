import type { Intent, Sentiment, Source, Urgency } from "@/lib/types";
import { SENTIMENT_COLOR, URGENCY_COLOR } from "@/lib/colors";
import { cn, fmt } from "@/lib/format";
import { Badge } from "@/components/ui/primitives";
import { MessageSquareText, Star, Ticket, ClipboardList } from "lucide-react";

export function SentimentDot({ sentiment, className }: { sentiment: Sentiment; className?: string }) {
  return <span className={cn("inline-block size-1.5 shrink-0 rounded-full", className)} style={{ background: SENTIMENT_COLOR[sentiment] }} />;
}

export function SentimentBadge({ sentiment, className }: { sentiment: Sentiment; className?: string }) {
  const c = SENTIMENT_COLOR[sentiment];
  return (
    <Badge className={cn("border-transparent", className)} style={{ background: `${c}1f`, color: c }}>
      <SentimentDot sentiment={sentiment} />
      {fmt.label(sentiment)}
    </Badge>
  );
}

const URG_BARS: Record<Urgency, number> = { low: 1, medium: 2, high: 3, critical: 4 };
export function UrgencyBadge({ urgency, className }: { urgency: Urgency; className?: string }) {
  const c = URGENCY_COLOR[urgency];
  return (
    <Badge className={cn("gap-1.5", className)}>
      <span className="flex items-end gap-[2px]" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className="w-[2px] rounded-[1px]" style={{ height: 3 + i * 2, background: i <= URG_BARS[urgency] ? c : "#2c2f36" }} />
        ))}
      </span>
      <span style={{ color: urgency === "low" ? undefined : c }}>{fmt.label(urgency)}</span>
    </Badge>
  );
}

export function IntentBadge({ intent, className }: { intent: Intent; className?: string }) {
  return <Badge className={className}>{fmt.label(intent)}</Badge>;
}

const SOURCE_ICON = { review: MessageSquareText, ticket: Ticket, survey: ClipboardList };
export function SourceBadge({ source, className }: { source: Source; className?: string }) {
  const Icon = SOURCE_ICON[source];
  return (
    <Badge className={cn("border-transparent bg-transparent px-0 text-fg-3", className)}>
      <Icon className="size-3" />
      {fmt.label(source)}
    </Badge>
  );
}

export function Rating({ rating }: { rating: number | null }) {
  if (rating == null) return null;
  return (
    <span className="inline-flex items-center gap-0.5 text-2xs text-fg-3 tnum" aria-label={`${rating} out of 5 stars`}>
      <Star className="size-3 fill-current text-[#c99a2e]" />
      {rating}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: Urgency }) {
  const c = URGENCY_COLOR[severity];
  return (
    <Badge className="border-transparent uppercase tracking-wide" style={{ background: `${c}22`, color: severity === "low" ? "#a1a4ad" : c }}>
      {severity}
    </Badge>
  );
}
