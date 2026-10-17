import * as React from "react";
import { Check, X } from "lucide-react";
import { Pill } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { Proposal, Tier } from "./use-scaling";
import { useDecideProposal } from "./use-scaling";
import { ACTION_META, PROPOSAL_STATUS, fmtDateTime, tierName } from "./format";

/** Curator decision with an optional comment, in a popover (no page-level forms). */
function DecisionPopover({
  decision,
  proposal,
  onDone,
}: {
  decision: "approve" | "reject";
  proposal: Proposal;
  onDone?: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [comment, setComment] = React.useState("");
  const { toast } = useToast();
  const decide = useDecideProposal();
  const approve = decision === "approve";
  const submit = async () => {
    try {
      await decide.mutateAsync({ id: proposal.id, decision, comment: comment.trim() || undefined });
      toast({ title: approve ? `Одобрено: ${proposal.trader} → ${proposal.toTier}` : `Отклонено: ${proposal.trader}`, description: approve ? "Лимиты тира записаны в риск-лимиты трейдера" : undefined });
      setOpen(false);
      setComment("");
      onDone?.();
    } catch (e) {
      toast({ title: "Не удалось сохранить решение", description: (e as Error).message, variant: "destructive" });
    }
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant={approve ? "default" : "outline"} aria-label={approve ? "Одобрить предложение" : "Отклонить предложение"}>
          {approve ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <X className="h-3.5 w-3.5" aria-hidden="true" />}
          {approve ? "Одобрить" : "Отклонить"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">{approve ? "Одобрить" : "Отклонить"} {ACTION_META[proposal.action].label.toLowerCase()}</p>
            <p className="text-xs text-muted-foreground">
              {proposal.trader}: {proposal.fromTier ?? "без тира"} → {proposal.toTier}
              {approve && ". Лимиты нового тира будут записаны в риск-лимиты."}
            </p>
          </div>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Комментарий {approve ? "(необязательно)" : "(причина)"}
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={2000} placeholder={approve ? "Например: стабильные 4 недели, размер можно увеличить" : "Например: ждём ещё одну зелёную неделю"} />
          </label>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Отмена</Button>
            <Button size="sm" variant={approve ? "default" : "secondary"} onClick={submit} disabled={decide.isPending}>
              {decide.isPending ? "Сохраняем…" : approve ? "Да, одобрить" : "Да, отклонить"}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ProposalCard({
  proposal,
  tiers,
  canDecide,
  onOpenTrader,
  className,
}: {
  proposal: Proposal;
  tiers: Tier[];
  canDecide: boolean;
  onOpenTrader?: (trader: string) => void;
  className?: string;
}) {
  const a = ACTION_META[proposal.action];
  const st = PROPOSAL_STATUS[proposal.status] ?? PROPOSAL_STATUS.pending;
  const pending = proposal.status === "pending";
  return (
    <article className={cn("glass-panel flex flex-col gap-2 rounded-xl p-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {onOpenTrader ? (
            <button type="button" className="text-sm font-semibold text-foreground hover:underline" onClick={() => onOpenTrader(proposal.trader)}>
              {proposal.trader}
            </button>
          ) : (
            <span className="text-sm font-semibold text-foreground">{proposal.trader}</span>
          )}
          <Pill tone={a.tone} dot>{a.label}</Pill>
          <span className="text-xs text-muted-foreground">{tierName(tiers, proposal.fromTier)}</span>
          <span className="text-xs text-muted-foreground" aria-hidden="true">→</span>
          <Pill tone="purple">{tierName(tiers, proposal.toTier)}</Pill>
          {!pending && <Pill tone={st.tone}>{st.label}</Pill>}
        </div>
        {pending && canDecide && (
          <div className="flex items-center gap-1.5">
            <DecisionPopover decision="reject" proposal={proposal} />
            <DecisionPopover decision="approve" proposal={proposal} />
          </div>
        )}
        {pending && !canDecide && <Pill tone="warn">{st.label}</Pill>}
      </div>
      {proposal.reasons.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {proposal.reasons.slice(0, 6).map((r, i) => <li key={i} className="truncate">• {r}</li>)}
          {proposal.reasons.length > 6 && <li>… ещё {proposal.reasons.length - 6}</li>}
        </ul>
      )}
      <div className="flex flex-wrap gap-x-3 text-2xs text-muted-foreground">
        <span>{proposal.source === "auto" ? "по правилам" : "вручную"} · {proposal.createdBy} · {fmtDateTime(proposal.createdAt)}</span>
        {proposal.decidedBy && <span>решение: {proposal.decidedBy} · {fmtDateTime(proposal.decidedAt)}</span>}
        {proposal.decisionComment && <span className="basis-full text-foreground/80">«{proposal.decisionComment}»</span>}
      </div>
    </article>
  );
}
