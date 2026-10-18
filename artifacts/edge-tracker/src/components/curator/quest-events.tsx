import { CheckCircle2, CircleSlash } from "lucide-react";
import { personName } from "@/i18n";
import { questsI18n } from "@/i18n/ns/quests";
import type { QuestEvent } from "./api";

/**
 * «Сегодня» queue: one small chip per curator quest a trainee recently finished or failed (no separate list); a click
 * opens the trader's profile, where the quests block lives.
 */
export function QuestEventChips({ events, onOpenTrader }: { events: readonly QuestEvent[] | undefined; onOpenTrader: (trader: string) => void }) {
  const { t, tryT } = questsI18n.useT();
  if (!events?.length) return null;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5" role="group" aria-label={t("today.aria")}>
      {events.map((e) => {
        const title = tryT(`quest.${e.template}.title`) ?? e.template;
        const text = t(`today.${e.status}`, { name: personName(e.trader), title });
        return (
          <button key={e.questId} type="button" title={text} onClick={() => onOpenTrader(e.trader)} className="chip inline-flex min-h-7 max-w-full items-center gap-1.5 px-2.5 text-xs font-medium">
            {e.status === "done"
              ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-up" aria-hidden="true" />
              : <CircleSlash className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
            <span className="min-w-0 truncate">{text}</span>
          </button>
        );
      })}
    </div>
  );
}
