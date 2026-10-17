import { useMemo } from "react";
import { CheckCheck, Lock, LockOpen, NotebookPen, Users } from "lucide-react";
import { EmptyState, Panel, Pill, toneOf, toneText } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useEodStatus, type EodStatus } from "@/components/eod/eod-api";
import { MOOD_LABELS } from "./DayJournalEditor";
import { type JournalEntry, hasReview } from "./use-journal-days";
import { netPnl, type Trade } from "./utils";
import { fmtDate, fmtUsd } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";

type TradeLike = Trade;

type Row = {
  trader: string; trades: number; net: number | null; status: EodStatus | null; score: number | null;
  entry: JournalEntry | null;
};

const STATUS_ICON = { open: LockOpen, closed: Lock, reviewed: CheckCheck } as const;
const STATUS_TEXT: Record<EodStatus, string> = { open: "не закрыт", closed: "ждёт проверки", reviewed: "проверен" };

/**
 * Curator «Вся команда» for one day: per trader — result, journal reflection, day closed / reviewed.
 * Click a row to open that trader's day.
 */
export function TeamDay({
  date, today, trades, entries, isLoading, onPick,
}: {
  date: string;
  today: string;
  trades: TradeLike[];
  entries: JournalEntry[];
  isLoading: boolean;
  onPick: (trader: string) => void;
}) {
  const statusQ = useEodStatus(date, "", date <= today);

  const rows = useMemo<Row[]>(() => {
    const m = new Map<string, Row>();
    const get = (t: string) => {
      let r = m.get(t);
      if (!r) { r = { trader: t, trades: 0, net: null, status: null, score: null, entry: null }; m.set(t, r); }
      return r;
    };
    for (const t of trades) {
      if (!t.trader) continue;
      const r = get(t.trader);
      r.trades++;
      const n = netPnl(t);
      if (n != null) r.net = (r.net ?? 0) + n;
    }
    for (const s of statusQ.data?.traders ?? []) {
      if (!s.trades && !m.has(s.trader) && s.status === "open") continue;
      const r = get(s.trader);
      r.status = s.status;
      r.score = s.curatorScore;
    }
    for (const e of entries) get(e.trader).entry = e;
    const rank = (r: Row) => (r.trades > 0 && r.status !== "closed" && r.status !== "reviewed" ? 0 : r.status === "closed" ? 1 : 2);
    return Array.from(m.values()).sort((a, b) => rank(a) - rank(b) || a.trader.localeCompare(b.trader, "ru"));
  }, [trades, statusQ.data, entries]);

  const notClosed = rows.filter((r) => r.trades > 0 && (r.status === "open" || r.status == null)).length;
  const reviewed = rows.filter((r) => hasReview(r.entry)).length;

  return (
    <Panel
      title="Команда за день"
      icon={Users}
      description={
        rows.length
          ? `${fmtDate(date, "dayMonth")} · разборов ${reviewed}/${rows.length}${notClosed ? ` · не закрыли день: ${notClosed}` : ""}`
          : fmtDate(date, "dayMonth")
      }
    >
      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={Users} title="В этот день никто не торговал" compact />
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => {
            const Icon = r.status ? STATUS_ICON[r.status] : LockOpen;
            const filled = hasReview(r.entry);
            return (
              <li key={r.trader}>
                <button
                  type="button"
                  onClick={() => onPick(r.trader)}
                  className="tile tile-interactive grid w-full grid-cols-[minmax(0,9rem)_minmax(0,6rem)_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="truncate text-sm font-semibold">{r.trader}</span>
                  <span className="tabular-nums">
                    {r.trades > 0 ? (
                      <>
                        <span className={cn("font-semibold", toneText(toneOf(r.net)))}>{fmtUsd(r.net, { signed: true, decimals: "auto" })}</span>
                        <span className="block text-muted-foreground">{commonI18n.t("units.trades", { count: r.trades })}</span>
                      </>
                    ) : <span className="text-muted-foreground">без сделок</span>}
                  </span>
                  <span className="min-w-0">
                    {filled ? (
                      <span className="flex min-w-0 items-center gap-1.5">
                        <NotebookPen className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                        {r.entry?.mood != null && <span className="shrink-0 text-muted-foreground">{MOOD_LABELS[r.entry.mood - 1]} ·</span>}
                        <span className="truncate text-foreground/90">{r.entry?.lessons || r.entry?.mistakes || r.entry?.well || "разбор заполнен"}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{r.trades > 0 ? "разбор не заполнен" : r.entry?.plan.trim() ? "есть план" : "—"}</span>
                    )}
                  </span>
                  <span className="flex items-center gap-1.5">
                    {r.status && (
                      <Pill tone={r.status === "reviewed" ? "up" : r.status === "closed" ? "accent" : r.trades > 0 ? "warn" : "neutral"}>
                        <Icon className="h-3 w-3" aria-hidden="true" />{STATUS_TEXT[r.status]}{r.status === "reviewed" && r.score != null ? ` · ${r.score}/5` : ""}
                      </Pill>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
