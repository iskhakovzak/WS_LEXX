import { Link } from "wouter";
import {
  AlertTriangle, ArrowUpRight, CheckCircle2, ListChecks, Lock, LockOpen, MessageSquareText,
} from "lucide-react";
import { Pill } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { links } from "@/lib/links";
import { fmtDeskDateTime } from "@/lib/format";
import { journalI18n } from "@/i18n/ns/journal";
import { personName } from "@/i18n";

/**
 * Day-close pieces of «Дневник дня» (DayJournalEditor): the close / reopen bar, the curator's feedback and the
 * read-only self-review of a day closed without a journal entry. Split out of DayJournalEditor.tsx (size ratchet).
 */

/**
 * What these pieces read of GET /api/eod/day (structurally EodDay / EodDayView of DayJournalEditor). Declared here so
 * the journal feature does not import the eod feature a second time (layers rule no-feature-to-feature).
 */
type EodDayRead = {
  summary: { repeat?: string; stop?: string; tomorrow?: string } | null;
  reviewedBy: string | null; reviewedAt: string | null; curatorComment: string | null; curatorScore: number | null;
};
type EodCloseRead = { status: "open" | "closed" | "reviewed"; closeOpensAt?: string | null; closedVia?: "daily" | "journal" | null; traderNote?: string | null };

// ── Pieces ──────────────────────────────────────────────────────────────────
/** Curator view of a day the trader closed with the day-close form but left the journal empty (OLGA-25). */
export function EodSelfReview({ day, quick, note }: { day: EodDayRead; quick: boolean; note: string | null }) {
  const { t } = journalI18n.useT();
  const s = day.summary ?? {};
  const rows = [
    [t("editor.eodRepeat"), s.repeat],
    [t("editor.eodStop"), s.stop],
    [t("editor.eodTomorrow"), s.tomorrow],
  ].filter((r): r is [string, string] => typeof r[1] === "string" && !!r[1].trim());
  return (
    <section className="space-y-2 rounded-xl bg-[var(--glass-bg)] p-3 text-sm" aria-label={t("editor.closedByEod")}>
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <CheckCircle2 className="h-4 w-4 text-up" aria-hidden="true" />{quick ? t("editor.closedQuickReadOnly") : t("editor.closedByEod")}
      </p>
      {note && <TraderNote note={note} />}
      {rows.map(([label, text]) => (
        <div key={label}>
          <div className="micro-label">{label}</div>
          <p className="whitespace-pre-wrap leading-relaxed">{text}</p>
        </div>
      ))}
    </section>
  );
}

/** The trader's one-line note left with «Разобрал» (dashboard / Telegram). */
function TraderNote({ note }: { note: string }) {
  const { t } = journalI18n.useT();
  return (
    <div>
      <div className="micro-label">{t("editor.traderNote")}</div>
      <p className="whitespace-pre-wrap leading-relaxed">{note}</p>
    </div>
  );
}

export function CuratorFeedback({ day }: { day: EodDayRead }) {
  const { t } = journalI18n.useT();
  return (
    <section className="rounded-xl border border-primary/30 bg-primary/5 p-3" aria-label={t("editor.curatorFeedback")}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <MessageSquareText className="h-4 w-4 text-primary" aria-hidden="true" />
        <span className="font-semibold">{t("editor.curatorFeedbackBy", { name: personName(day.reviewedBy) || "—" })}</span>
        <Pill tone="accent">{t("editor.curatorScore", { score: day.curatorScore ?? "—" })}</Pill>
        {day.reviewedAt && <span className="text-muted-foreground">{fmtDeskDateTime(day.reviewedAt)}</span>}
      </div>
      {day.curatorComment && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{day.curatorComment}</p>}
    </section>
  );
}

export function CloseBar({
  eod, blocking, editable, hasTrades, reviewFilled, progress, untaggedIds, closing, reopening, onClose, onReopen, onOpenTradeReview, showNote,
}: {
  eod: EodCloseRead; blocking: { tradeId: number; ticker: string }[]; editable: boolean; hasTrades: boolean; reviewFilled: boolean; progress: number; untaggedIds: number[];
  closing: boolean; reopening: boolean; onClose: () => void; onReopen: () => void; onOpenTradeReview?: () => void;
  /** The trader's «Разобрал» note (false when the read-only self-review above already shows it). */
  showNote: boolean;
}) {
  const { t } = journalI18n.useT();
  // Closed with «Разобрал»: the form is its extension — the trader sends the summary without reopening the day.
  const quick = eod.status === "closed" && eod.closedVia === "daily";
  const note = showNote && eod.traderNote?.trim() ? <div className="w-full text-sm"><TraderNote note={eod.traderNote.trim()} /></div> : null;
  if (eod.status === "reviewed") {
    return (
      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--glass-border)] pt-3 text-xs text-muted-foreground">
        <CheckCircle2 className="h-4 w-4 text-up" aria-hidden="true" />{t("editor.closedReviewed")}
      </div>
    );
  }
  if (eod.status === "closed" && !(quick && editable)) {
    return (
      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--glass-border)] pt-3 text-xs">
        {note}
        <Lock className="h-4 w-4 text-primary" aria-hidden="true" />
        <span className="text-muted-foreground">{t("editor.closedWaiting")}</span>
        {editable && (
          <Button variant="ghost" size="sm" className="ml-auto" disabled={reopening} onClick={onReopen}>
            <LockOpen aria-hidden="true" />{t("editor.reopen")}
          </Button>
        )}
      </div>
    );
  }
  const opensAt = !quick && eod.status === "open" ? eod.closeOpensAt ?? null : null;
  if (!editable) {
    return (
      <div className="flex items-center gap-2 border-t border-[var(--glass-border)] pt-3 text-xs text-muted-foreground">
        <LockOpen className="h-4 w-4" aria-hidden="true" />{t("editor.traderNotClosed")}
      </div>
    );
  }
  return (
    <div className="space-y-2 border-t border-[var(--glass-border)] pt-3">
      {quick && (
        <>
          {note}
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Lock className="h-4 w-4 text-primary" aria-hidden="true" />{t("editor.closedQuick")}
          </p>
        </>
      )}
      {!quick && blocking.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 text-warn" aria-hidden="true" />
          {t("editor.blocking", { count: blocking.length })}
          {blocking.map((m) => <span key={m.tradeId} className="font-medium">{m.ticker}</span>)}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground tabular-nums">{t("editor.filled", { done: progress })}</span>
        {untaggedIds.length > 0 && (
          <Link href={links.trades({ ids: untaggedIds })} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
            {t("editor.markSetups", { untagged: t("untaggedTrades", { count: untaggedIds.length }) })}<ArrowUpRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {hasTrades && onOpenTradeReview && (
            <Button variant="ghost" size="sm" onClick={onOpenTradeReview}>
              <ListChecks aria-hidden="true" />{t("editor.tradeReview")}
            </Button>
          )}
          {/* Item 1.5: one evening form — the summary fields are optional, closing never waits for them. */}
          <Button
            size="sm"
            className="min-h-11 sm:min-h-8"
            disabled={closing || (!quick && blocking.length > 0) || !!opensAt}
            title={opensAt ? t("editor.closeAfterMarket", { time: opensAt }) : undefined}
            onClick={onClose}
          >
            <Lock aria-hidden="true" />{closing ? t("editor.closing") : quick ? t("editor.sendSummary") : t("editor.closeDay")}
          </Button>
        </span>
      </div>
      {opensAt
        ? <p className="text-2xs text-muted-foreground">{t("editor.closeAfterMarket", { time: opensAt })}</p>
        : !reviewFilled && <p className="text-2xs text-muted-foreground">{t("editor.closeOptional")}</p>}
    </div>
  );
}
