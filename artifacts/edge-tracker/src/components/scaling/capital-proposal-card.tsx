/** A capital allocation proposal (scaling_proposals kind 'limits') in the scaling queue: limits before → after + the «почему». */
import { Check, X } from "lucide-react";
import { Pill } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { PendingIcon } from "@/components/ui/pending-icon";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { fmtDate, fmtUsd } from "@/lib/format";
import { capitalI18n } from "@/i18n/ns/capital";
import { scalingI18n } from "@/i18n/ns/scaling";
import { personName } from "@/i18n";
import type { Proposal } from "./use-scaling";
import { useDecideProposal } from "./use-scaling";
import type { CapitalPayload } from "./capital-api";
import { DecisionPill } from "./capital-parts";
import { proposalStatusMeta } from "./format";

const usd = (v: number | null | undefined) => (v == null ? "—" : fmtUsd(v, { decimals: 0 }));

export function CapitalProposalCard({ proposal, canDecide, onOpenTrader, className }: {
  proposal: Proposal;
  canDecide: boolean;
  onOpenTrader?: (trader: string) => void;
  className?: string;
}) {
  const { t } = capitalI18n.useT();
  const { t: ts } = scalingI18n.useT();
  const { toast } = useToast();
  const decide = useDecideProposal();
  const p = (proposal.limits ?? null) as CapitalPayload | null;
  const pending = proposal.status === "pending";
  const st = proposalStatusMeta(proposal.status);
  const run = async (decision: "approve" | "reject") => {
    try {
      await decide.mutateAsync({ id: proposal.id, decision });
      toast({ title: t(decision === "approve" ? "card.approved" : "card.rejected", { trader: personName(proposal.trader) }) });
    } catch (e) {
      toast({ title: t("card.failed"), description: (e as Error).message, variant: "destructive" });
    }
  };
  const [verdict, ...why] = proposal.reasons;
  return (
    <article className={cn("glass-panel flex flex-col gap-2 rounded-xl p-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button type="button" className="text-sm font-semibold text-foreground hover:underline" onClick={() => onOpenTrader?.(proposal.trader)}>
            {personName(proposal.trader)}
          </button>
          <Pill tone="accent">{t("card.kind")}</Pill>
          {p && <DecisionPill row={{ direction: p.direction, stepPct: p.stepPct }} />}
          {!pending && <Pill tone={st.tone}>{st.label}</Pill>}
        </div>
        {pending && canDecide && (
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" onClick={() => run("reject")} disabled={decide.isPending}>
              <PendingIcon pending={decide.isPending && decide.variables?.decision === "reject"} icon={X} className="h-3.5 w-3.5" /> {t("card.reject")}
            </Button>
            <Button size="sm" onClick={() => run("approve")} disabled={decide.isPending}>
              <PendingIcon pending={decide.isPending && decide.variables?.decision === "approve"} icon={Check} className="h-3.5 w-3.5" /> {t("card.approve")}
            </Button>
          </div>
        )}
      </div>
      {p && (
        <p className="text-xs text-foreground">
          {t("card.limit", { from: usd(p.before.dailyLossLimit), to: usd(p.after.dailyLossLimit) })}
          {p.before.buyingPower != null && p.after.buyingPower !== p.before.buyingPower && <> · {t("card.bp", { from: usd(p.before.buyingPower), to: usd(p.after.buyingPower) })}</>}
        </p>
      )}
      {verdict && <p className="sr-only">{verdict}</p>}
      {why.length > 0 && <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">{why.map((r, i) => <li key={i} className="break-words">• {r}</li>)}</ul>}
      <div className="flex flex-wrap gap-x-3 text-2xs text-muted-foreground">
        <span>{ts("proposal.byRules")} · {ts("proposal.system")} · {fmtDate(proposal.createdAt, "dateTime")}</span>
        {proposal.decidedBy && <span>{ts("proposal.decidedBy", { name: personName(proposal.decidedBy) })} · {fmtDate(proposal.decidedAt, "dateTime")}</span>}
        {proposal.decisionComment && <span className="basis-full break-words text-foreground/80">{ts("proposal.quoted", { text: proposal.decisionComment })}</span>}
      </div>
    </article>
  );
}
