/**
 * «AI review» in the trade sheet (Review section, lazy chunk): the shared review card (components/shared/ai-review-card)
 * for one trade. The review reads the fills, the chart, the edge map, patterns, rules and the playbook setup on the
 * server; opening a stored review costs nothing.
 */
import { AiReviewCard } from "@/components/shared/ai-review-card";

export function AiReviewPanel({ tradeId, className }: {
  tradeId: number;
  /** Older call sites pass these; the server reads the trade itself now. */
  conviction?: number | null;
  confidenceGrade?: string | null;
  tradeDate?: string | null;
  trader?: string | null;
  className?: string;
}) {
  return <AiReviewCard subject={{ kind: "trade", tradeId }} className={className} />;
}
