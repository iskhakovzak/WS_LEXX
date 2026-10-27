/**
 * «Вмешательства» in the trader profile (roadmap R9a): the logged curator actions, newest first, each with its trigger
 * and the effect badge. Effects are estimated in Wave 2 (R9b), so every badge says «нет данных» for now.
 */
import * as React from "react";
import { History } from "lucide-react";
import { EmptyState, Panel, Pill, QueryState } from "@/components/ds";
import { fmtDate } from "@/lib/format";
import { personName } from "@/i18n";
import { coachI18n } from "@/i18n/ns/coach";
import { useInterventions, type Intervention } from "./coach-api";

const VISIBLE = 6;

export function InterventionsPanel({ trader }: { trader: string }) {
  const { t } = coachI18n.useT();
  const q = useInterventions(trader);
  const [all, setAll] = React.useState(false);
  return (
    <Panel title={t("interventions.title")} icon={History} description={t("interventions.description")}>
      <QueryState
        query={q}
        isEmpty={(d) => d.interventions.length === 0}
        empty={<EmptyState compact icon={History} title={t("interventions.empty")} />}
      >
        {(d) => (
          <ul className="flex flex-col gap-1.5">
            {(all ? d.interventions : d.interventions.slice(0, VISIBLE)).map((x) => <Row key={x.id} x={x} />)}
            {d.interventions.length > VISIBLE && !all && (
              <li>
                <button type="button" onClick={() => setAll(true)} className="inline-flex min-h-8 items-center px-1 text-xs text-primary hover:underline">
                  {t("interventions.showAll", { count: d.interventions.length })}
                </button>
              </li>
            )}
          </ul>
        )}
      </QueryState>
    </Panel>
  );
}

function Row({ x }: { x: Intervention }) {
  const { t } = coachI18n.useT();
  const who = !x.author || x.author === "system" ? t("interventions.system") : personName(x.author);
  return (
    <li className="tile flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-1.5 text-sm">
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{t(`interventions.kind.${x.kind}`)}</span>
      <Pill tone="neutral" className="shrink-0">{t(`interventions.trigger.${x.trigger}`)}</Pill>
      <span className="basis-full text-xs text-muted-foreground">
        {t("interventions.by", { who, date: fmtDate(x.startedOn, "dayMonth") })} · {t("interventions.effectPending")}
      </span>
    </li>
  );
}
