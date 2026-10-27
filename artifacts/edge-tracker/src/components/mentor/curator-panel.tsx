/**
 * The mentor in the curator's per-trader view: the mentor's signals (escalations: tilt streak, commitment breaks,
 * drawdown near the limit, silence — «Принял» acknowledges), what the mentor knows (notes read-only, the curator's
 * guidance editable — the mentor follows it), the commitments (the curator may add and close). Never the chat itself.
 * Rendered by pages/curator.tsx into the trader profile's slot.
 */
import { BellRing, Check } from "lucide-react";
import { EmptyState, Panel, Pill, QueryState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { fmtDate, fmtUsd } from "@/lib/format";
import { personName } from "@/i18n";
import { mentorI18n } from "@/i18n/ns/mentor";
import { useAckEscalation, useMentor, type Escalation } from "./api";
import { CommitmentsCard } from "./commitments-card";
import { MemoryCard } from "./memory-card";

function escalationText(e: Escalation): string {
  const p = e.params;
  // Counts drive plural forms (a missing one reads as 0); a missing money / percent reads «—», never a fake $0 / 0 %.
  const params = { days: p.days ?? 0, count: p.count ?? 0, pct: p.pct ?? "—", drawdown: p.drawdown != null ? fmtUsd(p.drawdown, { decimals: "auto" }) : "—" };
  return mentorI18n.tryT(`curator.rule.${e.rule}`, params) ?? e.rule;
}

function Signals({ items }: { items: Escalation[] }) {
  const { t } = mentorI18n.useT();
  const ack = useAckEscalation();
  return (
    <Panel title={t("curator.escalations")} icon={BellRing}>
      {items.length ? (
        <ul className="flex flex-col gap-1.5">
          {items.map((e) => (
            <li key={e.id} className="tile flex flex-wrap items-center gap-2 px-3 py-1.5 text-sm">
              <Pill tone={e.rule === "drawdown_near_limit" ? "down" : "warn"} className="shrink-0">{fmtDate(e.day, "dayMonth")}</Pill>
              <span className="min-w-0 flex-1 text-foreground">{escalationText(e)}</span>
              {e.status === "open" ? (
                <Button size="sm" variant="outline" disabled={ack.isPending} onClick={() => ack.mutate(e.id)}><Check aria-hidden="true" />{t("curator.ack")}</Button>
              ) : (
                <span className="text-xs text-muted-foreground">{t("curator.acked", { who: personName(e.ackBy ?? "") })}</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState compact icon={BellRing} title={t("curator.none")} />
      )}
    </Panel>
  );
}

export function MentorCuratorPanel({ trader }: { trader: string }) {
  const q = useMentor(trader);
  return (
    <QueryState query={q} errorCompact>
      {(s) => (
        <div className="flex flex-col gap-4">
          <Signals items={s.escalations} />
          <MemoryCard facts={s.facts} notes={s.notes} curator trader={trader} />
          <CommitmentsCard active={s.commitments.active} closed={s.commitments.closed} canEdit={s.canGuide} trader={trader} />
        </div>
      )}
    </QueryState>
  );
}
