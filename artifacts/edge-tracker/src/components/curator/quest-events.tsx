import { CheckCircle2, CircleSlash, X } from "lucide-react";
import { usePersistentState } from "@/components/ds";
import { fmtDate } from "@/lib/format";
import { personName } from "@/i18n";
import { questsI18n } from "@/i18n/ns/quests";
import { curatorI18n } from "@/i18n/ns/curator";
import type { QuestEvent } from "./api";

/** Hidden («Понятно») quest events are remembered per browser; the list is trimmed so it never grows without bound. */
const SEEN_MAX = 200;

/**
 * «Сегодня» queue: one small chip per curator quest a newcomer recently finished or failed (no separate list). Each chip
 * carries the day it ended and the curator's note (OLGA-23), so two chips of the same quest type read apart; the name
 * opens the trader's profile (the quests block), «×» closes the chip in place.
 */
export function QuestEventChips({ events, onOpenTrader }: { events: readonly QuestEvent[] | undefined; onOpenTrader: (trader: string) => void }) {
  const { t, tryT } = questsI18n.useT();
  const tc = curatorI18n.useT().t;
  const [seen, setSeen] = usePersistentState<number[]>("curator.questEventsSeen", []);
  const hidden = new Set(seen);
  const shown = (events ?? []).filter((e) => !hidden.has(e.questId));
  if (!shown.length) return null;
  const close = (id: number) => setSeen([id, ...seen.filter((x) => x !== id)].slice(0, SEEN_MAX));
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5" role="group" aria-label={t("today.aria")}>
      {shown.map((e) => {
        const title = tryT(`quest.${e.template}.title`) ?? e.template;
        const text = t(`today.${e.status}`, { name: personName(e.trader), title });
        const day = e.at ? fmtDate(e.at.slice(0, 10), "dayMonth") : null;
        const note = e.note?.trim() || null;
        const full = [text, day, note].filter(Boolean).join(" · ");
        return (
          <span key={e.questId} className="chip inline-flex min-h-7 max-w-full items-center gap-1 pl-2.5 pr-1 text-xs font-medium">
            <button type="button" title={full} onClick={() => onOpenTrader(e.trader)} className="inline-flex min-w-0 items-center gap-1.5">
              {e.status === "done"
                ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-up" aria-hidden="true" />
                : <CircleSlash className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
              <span className="min-w-0 truncate">{text}</span>
              {day && <span className="shrink-0 tabular-nums text-muted-foreground">· {day}</span>}
              {note && <span className="min-w-0 max-w-[12rem] truncate font-normal text-muted-foreground">· {note}</span>}
            </button>
            <button
              type="button"
              onClick={() => close(e.questId)}
              className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground"
              aria-label={tc("questEvents.close", { text })}
              title={tc("questEvents.closeTitle")}
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </span>
        );
      })}
    </div>
  );
}
