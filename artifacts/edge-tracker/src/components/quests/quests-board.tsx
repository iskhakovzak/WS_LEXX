import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, Swords } from "lucide-react";
import { EmptyState } from "@/components/ds";
import { cn } from "@/lib/utils";
import { questsI18n } from "@/i18n/ns/quests";
import type { Quest } from "@/lib/quests/types";
import { activeByScope, questHistory } from "./model";
import { QuestRow } from "./quest-row";

/**
 * Active quests by scope (first steps, from the curator, today, week, month) with deadline, progress, reward and
 * «Перейти»; finished ones (done / failed / expired) in a collapsed history. `action` — a per-quest control (curator
 * «Отменить»). `historyOpen` opens the history (deep link to a finished quest).
 */
export function QuestsBoard({
  quests,
  today,
  action,
  historyOpen = false,
  emptyHint,
  links = true,
  highlight = null,
}: {
  quests: readonly Quest[];
  today: string;
  action?: (q: Quest) => ReactNode;
  historyOpen?: boolean;
  emptyHint?: string;
  /** «Перейти» links (the trader's own pages) — off in the curator view. */
  links?: boolean;
  /** A deep-linked quest id (?quest=): outlined. */
  highlight?: number | null;
}) {
  const { t } = questsI18n.useT();
  const [showHistory, setShowHistory] = useState(historyOpen);
  // A deep link that arrives while the tab is already open (a notification click) opens the history too.
  useEffect(() => { if (historyOpen) setShowHistory(true); }, [historyOpen, highlight]);
  const groups = activeByScope(quests);
  const history = questHistory(quests);
  return (
    <div className="flex flex-col gap-4">
      {groups.length === 0 ? (
        <EmptyState compact icon={Swords} title={t("board.empty")} description={emptyHint ?? t("board.emptyHint")} />
      ) : (
        groups.map((g) => (
          <section key={g.scope} className="flex flex-col gap-1.5" aria-label={t(`scope.${g.scope}`)}>
            <h3 className="micro-label">{t(`scope.${g.scope}`)}</h3>
            <ul className="flex flex-col gap-1.5">
              {g.quests.map((q) => <QuestRow key={q.id} q={q} today={today} action={action?.(q)} links={links} highlight={q.id === highlight} />)}
            </ul>
          </section>
        ))
      )}
      {history.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            aria-expanded={showHistory}
            className="inline-flex min-h-8 items-center gap-1 self-start rounded-lg px-1 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {showHistory ? t("board.hideHistory") : t("board.history", { count: history.length })}
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform motion-reduce:transition-none", showHistory && "rotate-180")} aria-hidden="true" />
          </button>
          {showHistory && (
            <ul className="flex flex-col gap-1.5">
              {history.map((q) => <QuestRow key={q.id} q={q} today={today} showStatus highlight={q.id === highlight} />)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
