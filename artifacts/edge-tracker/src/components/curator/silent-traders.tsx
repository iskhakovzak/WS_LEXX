/**
 * «Молчит N дней» — the silence signal in the curator cabinet («Сегодня», on top of the attention list, like the reward
 * requests): traders of the roster without trades for the desk's dayState.pausedDays trading days (not on a stop — that
 * is the risk tile's item), longest first, each with «Написать». The trader_silence notification links here with
 * ?write=<trader>, which opens the message for that trader at once. States: GET /api/state/team (lib/day-state).
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Hourglass, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WriteTraderDialog } from "@/components/shared/write-trader-dialog";
import { isSilent, teamStatesQuery } from "@/lib/day-state";
import { fmtDayMonth } from "@/lib/format";
import { personName } from "@/i18n";
import { dayStateI18n } from "@/i18n/ns/dayState";

export function SilentTraderItems({ roster, onOpenTrader, writeTo = null }: { roster: readonly string[]; onOpenTrader: (trader: string) => void; writeTo?: string | null }) {
  const { t } = dayStateI18n.useT();
  const q = useQuery(teamStatesQuery());
  const [writing, setWriting] = React.useState<string | null>(null);
  const opened = React.useRef(false);
  React.useEffect(() => {
    if (!writeTo || opened.current) return;
    opened.current = true;
    setWriting(writeTo);
  }, [writeTo]);
  const inRoster = React.useMemo(() => new Set(roster), [roster]);
  const list = (q.data?.states ?? [])
    .filter((s) => inRoster.has(s.trader) && isSilent(s))
    .sort((a, b) => (b.silentDays ?? 0) - (a.silentDays ?? 0));
  return (
    <>
      {list.length > 0 && (
        <ul className="flex flex-col gap-1.5 [&:not(:last-child)]:mb-1.5" aria-label={t("silent.aria")}>
          {list.map((s) => (
            <li key={s.trader} className="tile flex min-w-0 flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:gap-3">
              <span className="flex min-w-0 flex-1 items-start gap-2">
                <Hourglass className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
                <span className="min-w-0 text-sm">
                  <button type="button" onClick={() => onOpenTrader(s.trader)} className="font-medium text-foreground hover:text-primary" title={t("silent.open")}>
                    {personName(s.trader)}
                  </button>
                  <span className="text-muted-foreground"> {t("silent.title", { count: s.silentDays ?? 0 })}</span>
                  <span className="block text-xs tabular-nums text-muted-foreground">
                    {[
                      s.lastTrade ? t("silent.last", { date: fmtDayMonth(s.lastTrade.date) }) : null,
                      s.backlog.count > 0 ? t("silent.reviews", { count: s.backlog.count }) : null,
                    ].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </span>
              <Button type="button" size="sm" variant="outline" className="shrink-0 self-end sm:self-auto" onClick={() => setWriting(s.trader)}>
                <MessageCircle aria-hidden="true" /> {t("silent.write")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <WriteTraderDialog trader={writing} onClose={() => setWriting(null)} />
    </>
  );
}
