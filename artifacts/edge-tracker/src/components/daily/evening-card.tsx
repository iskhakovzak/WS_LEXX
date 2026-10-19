import { useId, useState } from "react";
import { Link } from "wouter";
import { Award, Check, CheckCircle2, ChevronRight, CircleSlash, Moon, NotebookPen, SearchCheck, Tags, Users } from "lucide-react";
import { Pill, toneOf, toneText } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { mistakeLabel } from "@/components/shared/mistake-labels";
import { ReplayOwnDayButton } from "@/components/shared/replay-own-day";
import { openTaggingSheet } from "@/components/shared/playbook-sheet";
import { playbookTodayI18n } from "@/i18n/ns/playbookToday";
import type { DailyFocus, EveningCard as Card, FocusVerdict } from "@/lib/daily/types";
import { links } from "@/lib/links";
import { fmtUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { commonI18n } from "@/i18n/ns/common";
import { dailyI18n } from "@/i18n/ns/daily";
import { StatusIcon, ContractVerdictRow } from "./contract-line";
import { TradeChips, dayShort } from "./focus-line";
import { useDailyReview } from "./use-daily";
import { eveningRewards } from "./daily-model";

/** Quests tab of «Рейтинги» (same link as the dashboard quest strip and the quest notifications). */
const QUESTS_HREF = "/ratings?tab=quests";

function FocusVerdictRow({ v }: { v: FocusVerdict }) {
  const { t } = dailyI18n.useT();
  const mistake = mistakeLabel(v.mistake);
  const text =
    v.status === "kept" ? t("evening.focusKept", { mistake })
    : v.status === "broken" ? t("evening.focusBroken", { mistake })
    : v.status === "no_trades" ? t("evening.focusNoTrades", { mistake })
    : t("evening.focusUnknown", { mistake });
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
      <span className="inline-flex min-w-0 items-start gap-2">
        <StatusIcon status={v.status} className="mt-0.5 h-4 w-4" />
        <span className={cn("font-medium [overflow-wrap:anywhere]", v.status === "broken" && "text-down", v.status === "kept" && "text-up")}>{text}</span>
      </span>
      {v.status === "broken" && v.hits.length > 0 && (
        <span className="text-xs text-muted-foreground tabular-nums">
          {dailyI18n.t("focus.times", { count: v.hits.length })}
          {v.costNet != null ? ` · ${fmtUsd(v.costNet, { signed: true, decimals: 0 })}` : ""}
        </span>
      )}
      {v.status === "broken" && <TradeChips trades={v.hits} />}
      {v.disputed && <Pill tone="purple">{t("evening.disputed")}</Pill>}
    </div>
  );
}

/** One trade worth opening + «same ticker, same day» (both links; the desk-day page shows everyone's executions). */
function LinksRow({ card }: { card: Card }) {
  const { t } = dailyI18n.useT();
  const tr = card.tradeToReview;
  const desk = card.deskSameTicker;
  if (!tr && !(desk && desk.traders > 0)) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
      {tr && (
        <Link
          href={links.trade(tr.tradeId)}
          className="group inline-flex min-h-8 min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 self-start rounded-lg text-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <SearchCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="text-muted-foreground">{t("evening.reviewTrade")}</span>
          <span className="font-semibold tabular-nums">{tr.ticker}</span>
          {tr.net != null && <span className={cn("whitespace-nowrap tabular-nums", toneText(toneOf(tr.net)))}>{fmtUsd(tr.net, { signed: true, decimals: 0 })}</span>}
          <span className="whitespace-nowrap text-xs text-muted-foreground">· {t(`evening.reason.${tr.reason}`)}</span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden="true" />
        </Link>
      )}
      {/* A losing trade can be relived in the simulator (own worst days); the button hides when it can't be replayed. */}
      {tr && <ReplayOwnDayButton tradeId={tr.tradeId} own={(tr.net ?? 0) < 0} />}
      {desk && desk.traders > 0 && (
        <Link
          href={links.deskDay(desk.ticker, card.date)}
          aria-label={t("evening.deskAria", { ticker: desk.ticker, date: dayShort(card.date) })}
          className="group inline-flex min-h-8 min-w-0 items-start gap-2 self-start rounded-lg py-1 text-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Users className="mt-0.5 h-4 w-4 shrink-0 text-purple" aria-hidden="true" />
          <span className="min-w-0 text-muted-foreground">
            {t("evening.desk", { ticker: desk.ticker, count: desk.traders })}
          </span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

/** «🏅 Новое достижение: Серия контракта (Бронза) · 1 квест выполнен» — one line, like the Telegram card. */
function RewardsRow({ card }: { card: Card }) {
  const { t } = dailyI18n.useT();
  const line = eveningRewards(card);
  if (!line) return null;
  return (
    <Link
      href={QUESTS_HREF}
      title={t("evening.rewardsLink")}
      className="group inline-flex min-h-8 min-w-0 items-start gap-2 self-start rounded-lg py-1 text-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Award className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
      <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{line.text}</span>
      <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden="true" />
    </Link>
  );
}

/** «Разметь N сделок» — own trades without a setup; opens the playbook tagging UI in a sheet (the evening quest). */
function TagStep({ count, day }: { count: number; day: string }) {
  const { t } = playbookTodayI18n.useT();
  return (
    <button
      type="button"
      onClick={() => openTaggingSheet(day)}
      aria-haspopup="dialog"
      className="group inline-flex min-h-8 min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 self-start rounded-lg text-left text-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Tags className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <span className="font-medium">{t("evening.tag", { count })}</span>
      <span className="text-xs text-muted-foreground">· {t("evening.tagHint")}</span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden="true" />
    </button>
  );
}

/** «Разобрал» (+ one optional line) and «Это не ошибка» when the focus was broken. */
function ReviewActions({ card }: { card: Card }) {
  const { t } = dailyI18n.useT();
  const { toast } = useToast();
  const review = useDailyReview();
  const [note, setNote] = useState("");
  const noteId = useId();
  const canDispute = card.focus?.status === "broken" && !card.focus.disputed;
  const send = (dispute: boolean) =>
    review.mutate(
      { date: card.date, note, dispute },
      { onError: (e) => toast({ title: t("evening.saveFailed"), description: e instanceof Error ? e.message : undefined, variant: "destructive" }) },
    );
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row sm:items-center"
      onSubmit={(e) => {
        e.preventDefault();
        send(false);
      }}
    >
      <label htmlFor={noteId} className="sr-only">
        {t("evening.noteLabel")}
      </label>
      <Input
        id={noteId}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={200}
        placeholder={t("evening.notePlaceholder")}
        className="h-9 sm:max-w-sm sm:flex-1"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={review.isPending}>
          <Check aria-hidden="true" />
          {t("evening.reviewed")}
        </Button>
        {canDispute && (
          <Button type="button" size="sm" variant="ghost" disabled={review.isPending} onClick={() => send(true)} title={t("evening.notMistakeTitle")}>
            <CircleSlash aria-hidden="true" />
            {t("evening.notMistake")}
          </Button>
        )}
      </div>
    </form>
  );
}

/** Closed state after «Разобрал»: one line, plus the next step (tomorrow's focus, the journal if the day is still open). */
function ClosedDay({ card, nextFocus, journalOpen, onReopen, untagged }: { card: Card; nextFocus: DailyFocus | null; journalOpen: boolean; onReopen: () => void; untagged: number }) {
  const { t } = dailyI18n.useT();
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
      <span className="inline-flex min-w-0 items-center gap-2 font-medium">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-up" aria-hidden="true" />
        {t("evening.done", { date: dayShort(card.date) })}
      </span>
      {card.reviewNote && <span className="min-w-0 truncate italic text-muted-foreground" title={card.reviewNote}>{card.reviewNote}</span>}
      {card.focus?.disputed && <Pill tone="purple">{t("evening.doneDisputed")}</Pill>}
      {nextFocus && nextFocus.source !== "none" && (nextFocus.mistake || nextFocus.ownText) && nextFocus.date > card.date && (
        <span className="text-muted-foreground">
          {t("focus.forDate", { date: dayShort(nextFocus.date) })}:{" "}
          <span className="font-medium text-foreground [overflow-wrap:anywhere]">{nextFocus.mistake ? mistakeLabel(nextFocus.mistake) : nextFocus.ownText}</span>
        </span>
      )}
      {journalOpen && (
        <Link href={links.journalDay(card.date)} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          <NotebookPen className="h-3.5 w-3.5" aria-hidden="true" />
          {t("evening.closeJournal")}
        </Link>
      )}
      {untagged > 0 && <TagStep count={untagged} day={card.date} />}
      <button type="button" onClick={onReopen} className="text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {t("evening.reopen")}
      </button>
    </div>
  );
}

/**
 * Evening card for the last finished day: was the focus kept (from the trades), one trade to review, how the desk
 * traded the same ticker, the contract verdict and two actions. Reviewing closes it to one line (closure).
 */
export function EveningCard({
  card,
  nextFocus,
  journalOpen = false,
  onHide,
  untagged: untaggedFallback = 0,
}: {
  card: Card;
  /** The focus the server computed after this day (shown in the closed state). */
  nextFocus?: DailyFocus | null;
  /** The journal day is still open → the closed state offers it as the next step. */
  journalOpen?: boolean;
  /** Morning mode: the card was opened from the «not reviewed» row and can fold back. */
  onHide?: () => void;
  /** Fallback count when the card has no `untagged` (older API): PlaybookToday.untagged. */
  untagged?: number;
}) {
  const { t } = dailyI18n.useT();
  const [reopened, setReopened] = useState(false);
  const untagged = card.untagged ?? untaggedFallback; // the day's own count; older API → the playbook's
  if (card.reviewed && !reopened) return <ClosedDay card={card} nextFocus={nextFocus ?? null} journalOpen={journalOpen} onReopen={() => setReopened(true)} untagged={untagged} />;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-purple/15 text-purple">
            <Moon className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="text-base font-semibold">{t("evening.title", { date: dayShort(card.date) })}</span>
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {commonI18n.t("units.trades", { count: card.trades })}
          {card.netPnl != null && (
            <>
              {" · "}
              <span className={cn("font-medium", toneText(toneOf(card.netPnl)))}>{fmtUsd(card.netPnl, { signed: true })}</span>
            </>
          )}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <Link href={links.journalDay(card.date)} className="text-xs font-medium text-muted-foreground hover:text-foreground">
            {t("evening.journal")}
          </Link>
          {(onHide || reopened) && (
            <button
              type="button"
              onClick={() => (reopened ? setReopened(false) : onHide?.())}
              className="text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("evening.hide")}
            </button>
          )}
        </span>
      </div>
      {card.focus && <FocusVerdictRow v={card.focus} />}
      <LinksRow card={card} />
      {untagged > 0 && <TagStep count={untagged} day={card.date} />}
      {card.contract && <ContractVerdictRow verdict={card.contract} />}
      <RewardsRow card={card} />
      {!card.reviewed && <ReviewActions card={card} />}
    </div>
  );
}
