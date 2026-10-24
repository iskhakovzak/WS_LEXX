/**
 * The trade card (/trades?highlight=id). One hierarchy instead of tabs of equal weight:
 *   header   ticker, side, result, date and fill times, J / K navigation;
 *   hero     net P&L and R large in the result colour, setup / event / session chips, the chart (Entry / Exit);
 *   facts    entry, exit, size, hold, MAE / MFE, fees as compact tiles;
 *   actions  edit, «В плейбук», «Картинка», replay — delete last;
 *   sections «Исполнения», «Разбор», «Заметки», «Контекст», «Связанное», collapsible and remembered per user.
 * Phones get a bottom sheet; the header stays and the rest scrolls.
 */
import * as React from "react";
import type { Trade } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Check, ChevronDown, ChevronUp, FileText, Link2, Pencil, Trash2 } from "lucide-react";
import { Pill } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { AddToPlaybookButton } from "@/components/add-to-playbook";
import { EarningsBadge } from "@/components/shared/finviz/earnings";
import { TickerContext } from "@/components/shared/finviz/ticker-context";
import { PlaybookSheetButton } from "@/components/shared/playbook-sheet";
import { ReplayOwnDayButton } from "@/components/shared/replay-own-day";
import { RedactedHint, redactedHint } from "@/components/playbook/setup-bits";
import { ScreenshotDisplay } from "@/components/screenshot-fields";
import { DateHolidayBadge } from "@/components/holiday-badge";
import type { HolidayEvent } from "@/lib/market-intel";
import { links } from "@/lib/links";
import { BASE } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { dayOf, tradePlaybookPayload, horizonOf, isBrokerTrade, isRedactedTrade, netPnl, parseHoldText } from "./trade-utils";
import { notesHasContent, reviewHasContent } from "./sheet-model";
import { HorizonPill, ResultMenu, SidePill } from "./trade-bits";
import { classifyTags, isUnreviewed, type TagKind } from "./review-presets";
import { TradeMarkup } from "./trade-markup";
import { ExecutionsPanel } from "./ExecutionsPanel";
import { TradeRelated, useSourceIdeaTarget } from "./TradeRelated";
import { TradeSocial } from "./TradeSocial";
import { ShareCardButton } from "./share-card/ShareCardButton";
import { AskAssistantButton, useAssistantContext } from "@/components/shared/ask-assistant";
import { KeyFacts, SheetHero } from "./sheet-hero";
import { SheetSection, useSheetSections, type SectionsApi } from "./sheet-section";
import { ContextRow, NOTES_KEYS, REVIEW_TEXT_KEYS, ReviewEditor, type TradePatch } from "./sheet-review";
import { QualityBlock, useAfterExitMinutes, useExcursionFacts } from "@/components/replay/QualityBlock";
import { ET_SESSION_LABEL, etWallToIso, fmtDuration, sessionOfEt, type EtSession } from "@/components/trade-chart-parts/chart-utils";
import { fmtDate } from "@/lib/format";
import { tradesI18n } from "@/i18n/ns/trades";
import { commonI18n } from "@/i18n/ns/common";
import { personName } from "@/i18n";
import { DeskDayLink } from "@/components/shared/desk-day-link";
import { useAuth } from "@/contexts/auth-context";

export type { TradePatch } from "./sheet-review";

type TradeTiming = {
  /** Wall-clock ET «HH:MM:SS» of the first fill / last fill (PropReports contextSnapshot), when known. */
  openedWall: string | null;
  closedWall: string | null;
  holdSeconds: number | null;
  entrySession: EtSession | null;
  exitSession: EtSession | null;
};

/** Exact entry/exit instants of a PropReports trade: contextSnapshot.openedAt/closedAt are ET wall clock («2026-10-15T15:55:35»). */
function tradeTiming(t: Trade): TradeTiming {
  const cs = (t.contextSnapshot ?? {}) as Record<string, unknown>;
  const wall = (v: unknown): { day: string; time: string } | null => {
    if (typeof v !== "string") return null;
    const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)/.exec(v);
    return m ? { day: m[1], time: m[2] } : null;
  };
  const o = wall(cs.openedAt), c = wall(cs.closedAt);
  const openedIso = o ? etWallToIso(o.day, o.time) : null;
  const closedIso = c ? etWallToIso(c.day, c.time) : null;
  const holdSeconds = openedIso && closedIso ? Math.max(0, Math.round((Date.parse(closedIso) - Date.parse(openedIso)) / 1000)) : null;
  return {
    openedWall: o?.time ?? null, closedWall: c?.time ?? null, holdSeconds,
    entrySession: openedIso ? sessionOfEt(openedIso) : null, exitSession: closedIso ? sessionOfEt(closedIso) : null,
  };
}

const LazyNewsFeed = React.lazy(() => import("@/components/news-feed").then((m) => ({ default: m.NewsFeed })));
const LazyAiReviewPanel = React.lazy(() => import("@/components/ai-review-panel").then((m) => ({ default: m.AiReviewPanel })));
const LazyVoiceNotePlayer = React.lazy(() => import("@/components/voice-note-player").then((m) => ({ default: m.VoiceNotePlayer })));

type Props = {
  trade: Trade | null;
  onClose: () => void;
  allTrades: Trade[];
  onOpenTrade: (t: Trade) => void;
  onPrev?: () => void;
  onNext?: () => void;
  position?: { index: number; total: number };
  /** May review / tag / annotate this trade. */
  canEdit: boolean;
  /** Full edit form (manual trades or staff); broker numbers are read-only for traders. */
  canEditForm?: boolean;
  /** Change the result by hand (manual trades or staff). */
  canEditResult?: boolean;
  /** Delete (manual trades or staff). */
  canDelete?: boolean;
  onEdit: (t: Trade) => void;
  onDelete: (t: Trade) => void;
  /** Quick tagging (setup / mistake / emotion). */
  onTag?: (t: Trade, kind: TagKind, value: string | null) => void;
  setupOptions?: readonly string[];
  onPatch: (t: Trade, patch: TradePatch, opts?: { silent?: boolean }) => Promise<boolean>;
  traderName: string | null;
  isCurator: boolean;
  voiceNoteKey: number;
  holidayEvents: HolidayEvent[];
};

/** Copies a link that opens this trade (/trades?highlight=id) — for discussions, notes and messages to the curator. */
function CopyTradeLink({ id, ticker }: { id: number; ticker: string }) {
  const { toast } = useToast();
  const { t } = tradesI18n.useT();
  const [done, setDone] = React.useState(false);
  React.useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => setDone(false), 1600);
    return () => window.clearTimeout(t);
  }, [done]);
  const copy = async () => {
    const url = `${window.location.origin}${BASE}${links.trade(id)}`;
    try {
      await navigator.clipboard.writeText(url);
      setDone(true);
      toast({ title: t("sheet.linkCopied"), description: t("sheet.linkCopiedHint", { ticker }) });
    } catch {
      toast({ title: commonI18n.t("states.copyFailed"), description: url, variant: "destructive" });
    }
  };
  return (
    <Button variant="outline" size="icon" className="h-8 w-8" aria-label={t("sheet.copyLink")} title={t("sheet.copyLink")} onClick={() => void copy()}>
      {done ? <Check className="text-up" /> : <Link2 />}
    </Button>
  );
}

export function TradeDetailSheet(p: Props) {
  const { t: tc } = commonI18n.useT();
  const { t: tt } = tradesI18n.useT();
  const mobile = useIsMobile();
  const t = p.trade;
  return (
    <Sheet open={!!t} onOpenChange={(v) => { if (!v) p.onClose(); }}>
      {/* Phones: a bottom sheet. Everywhere the header stays and the body scrolls (the chart and the review are reachable, ILYA-01). */}
      <SheetContent
        side={mobile ? "bottom" : "right"}
        data-onboarding-seen="trade"
        className={mobile
          ? "flex h-[92dvh] flex-col gap-0 overflow-hidden rounded-t-2xl p-0"
          : "flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl lg:max-w-3xl xl:max-w-4xl"}
      >
        {t ? <SheetBody key={t.id} {...p} trade={t} mobile={mobile} /> : (
          <SheetHeader className="sr-only"><SheetTitle>{tc("trading.trade")}</SheetTitle><SheetDescription>{tt("sheet.noData")}</SheetDescription></SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  );
}

function SheetBody(p: Props & { trade: Trade; mobile: boolean }) {
  const { t: tt } = tradesI18n.useT();
  const { t: tc } = commonI18n.useT();
  const t = p.trade;
  const [reviewCount, setReviewCount] = React.useState(0);
  const [afterExit, setAfterExit] = useAfterExitMinutes();
  const ideaTarget = useSourceIdeaTarget(t);
  const timing = React.useMemo(() => tradeTiming(t), [t]);
  const canEditForm = p.canEditForm ?? p.canEdit;
  const canEditResult = p.canEditResult ?? p.canEdit;
  const canDelete = p.canDelete ?? p.canEdit;
  // Another trader's trade opened from the playbook: $ come back null, and the owner-only blocks (quality, AI
  // review, voice notes, curator reviews) would only answer 403 — they are not shown at all.
  const redacted = isRedactedTrade(t);
  // The viewer's own losing intraday trade: «Переиграть этот день» in the simulator (the button checks the bars).
  const ownLoss = !redacted && !!p.traderName && t.trader === p.traderName && (netPnl(t) ?? 0) < 0 && horizonOf(t) === "intraday";
  // «AI-разбор» is not part of a trainee's loop (ILYA-24): no block for Стажёр.
  const trainee = useAuth().permissions.tier === "trainee";
  const showAi = !redacted && !trainee;
  const mistakes = React.useMemo(() => classifyTags(t.tags).mistakes.length, [t.tags]);
  const awaitingReview = p.canEdit && !redacted && isUnreviewed(t);
  const sections = useSheetSections(p.traderName, t.id, {
    awaitingReview,
    reviewHasContent: reviewHasContent(t, mistakes, reviewCount),
    notesHasContent: notesHasContent(t),
  });
  const showActions = p.canEdit || ownLoss;
  useAssistantContext({ tradeId: t.id, date: dayOf(t), ...(t.trader ? { trader: t.trader } : {}) });
  // Values from other features (chart session labels, quality excursions, the redacted hint) are resolved here.
  const excursions = useExcursionFacts(!redacted && (t.entry != null || t.exit != null) ? t.id : null, afterExit);
  const hold = timing.holdSeconds ?? parseHoldText(t.holdTime);
  const redactedText = redacted ? redactedHint() : undefined;
  const { entrySession: es, exitSession: xs } = timing;
  const exitOutside = xs && xs !== "regular" && xs !== es
    ? xs === "postmarket" ? tt("sheet.exitIn.postmarket") : xs === "premarket" ? tt("sheet.exitIn.premarket") : tt("sheet.exitIn.other", { session: ET_SESSION_LABEL[xs] })
    : null;
  const sessionsText = es && xs && es !== xs ? `${ET_SESSION_LABEL[es]} → ${ET_SESSION_LABEL[xs]}` : null;

  return (
    <>
      <SheetHeader className="shrink-0 space-y-1 px-4 pb-3 pr-14 pt-4 text-left sm:px-5 sm:pr-16">
        {p.mobile && <div aria-hidden="true" className="mx-auto -mt-2 mb-1 h-1 w-10 rounded-full bg-muted-foreground/30" />}
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5">
            <SheetTitle className="text-2xl font-semibold tracking-tight">{t.ticker}</SheetTitle>
            <SidePill side={t.side} />
            <HorizonPill horizon={horizonOf(t)} showIntraday />
            <ResultMenu result={t.result} ticker={t.ticker} disabled={!canEditResult} onChange={(r) => { void p.onPatch(t, { result: r }); }} />
            <EarningsBadge ticker={t.ticker} day={dayOf(t)} />
          </div>
          <div className="flex shrink-0 items-center gap-1 pt-0.5">
            {(p.onPrev || p.onNext) && (
              <>
                {p.position && <span className="mr-1 hidden text-xs tabular-nums text-muted-foreground sm:inline">{p.position.index + 1} / {p.position.total}</span>}
                <Button variant="outline" size="icon" className="h-8 w-8" aria-label={tt("sheet.prev")} title={tt("sheet.prev")} disabled={!p.onPrev} onClick={p.onPrev}><ChevronUp /></Button>
                <Button variant="outline" size="icon" className="h-8 w-8" aria-label={tt("sheet.next")} title={tt("sheet.next")} disabled={!p.onNext} onClick={p.onNext}><ChevronDown /></Button>
              </>
            )}
            <PlaybookSheetButton className="h-8" />
            <CopyTradeLink id={t.id} ticker={t.ticker} />
            <AskAssistantButton compact context={{ tradeId: t.id, date: dayOf(t), ...(t.trader ? { trader: t.trader } : {}) }} />
          </div>
        </div>
        <SheetDescription className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs sm:text-sm">
          <span className="inline-flex items-center gap-1 tabular-nums">
            {fmtDate(dayOf(t), "shortYY")}
            {t.exitDate && horizonOf(t) !== "intraday" && <> → {fmtDate(t.exitDate.substring(0, 10), "shortYY")}</>}
            <DateHolidayBadge events={p.holidayEvents} />
          </span>
          {timing.openedWall && (
            <span className="tabular-nums" title={tt("sheet.fillTimesTitle")}>
              · {timing.openedWall}{timing.closedWall ? ` → ${timing.closedWall}` : ""} ET{timing.holdSeconds != null ? ` · ${fmtDuration(timing.holdSeconds)}` : ""}
            </span>
          )}
          {t.trader && <span>· {personName(t.trader)}</span>}
        </SheetDescription>
      </SheetHeader>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-5">
        <div className="space-y-3">
          <SheetHero trade={t} ideaTarget={ideaTarget} chartHeight={p.mobile ? 240 : 360} exitOutside={exitOutside} redactedText={redactedText} />
          <KeyFacts trade={t} holdText={hold != null ? fmtDuration(hold) : null} excursions={excursions} redactedText={redactedText} />
          {redacted && <RedactedHint />}
          {showActions && (
            <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label={tt("sheet.actions")}>
              {p.canEdit && canEditForm && (
                <Button variant="outline" size="sm" className="gap-1.5" aria-label={tc("actions.edit")} title={tc("actions.edit")} onClick={() => p.onEdit(t)}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> <span className="max-sm:sr-only">{tc("actions.edit")}</span>
                </Button>
              )}
              {p.canEdit && <AddToPlaybookButton payload={tradePlaybookPayload(t)} />}
              <ShareCardButton trade={t} />
              <ReplayOwnDayButton tradeId={t.id} own={ownLoss} />
              {p.canEdit && canDelete && (
                <Button variant="ghost" size="sm" className="ml-auto gap-1.5 text-muted-foreground hover:text-down" aria-label={tc("actions.delete")} title={tc("actions.delete")} onClick={() => p.onDelete(t)}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> <span className="max-sm:sr-only">{tc("actions.delete")}</span>
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="mt-4 divide-y divide-border/70 border-t border-border/70">
          <SheetSection id="executions" title={tt("sheet.sections.executions")} api={sections}>
            {/* Broker fills are the broker's record: no basket, no «Добавить» (read-only on the server too). */}
            <ExecutionsPanel tradeId={t.id} tradeDate={t.date} side={t.side} canEdit={p.canEdit && canEditForm && !isBrokerTrade(t)} fees={t.fees} qty={t.qty} pnl={t.pnl} onOpenTradeId={(id) => { const x = p.allTrades.find((a) => a.id === id); if (x) p.onOpenTrade(x); }} />
          </SheetSection>
          <ReviewSection {...p} sections={sections} awaitingReview={awaitingReview} reviewCount={reviewCount} onReviewCount={setReviewCount} afterExit={afterExit} onAfterExitChange={setAfterExit} showAi={showAi} redacted={redacted} />
          <SheetSection id="notes" title={tt("sheet.sections.notes")} api={sections}>
            <div className="space-y-4">
              <ReviewEditor trade={t} keys={NOTES_KEYS} canEdit={p.canEdit} onPatch={p.onPatch} emptyText={tt("sheet.notesEmpty")} />
              {t.screenshotUrl && (
                <section className="space-y-2">
                  <p className="micro-label">{tc("fields.screenshots")}</p>
                  <ScreenshotDisplay
                    urls={t.screenshotUrl}
                    notes={t.screenshotNotes}
                    onNotesChange={async (newNotes) => { await p.onPatch(t, { screenshotNotes: newNotes }, { silent: true }); }}
                  />
                </section>
              )}
              {t.trader && !redacted && (
                <React.Suspense fallback={null}>
                  <LazyVoiceNotePlayer tradeId={t.id} userId={t.trader} refreshKey={p.voiceNoteKey} />
                </React.Suspense>
              )}
            </div>
          </SheetSection>
          <SheetSection id="context" title={tt("sheet.sections.context")} api={sections}>
            <div className="space-y-5">
              <ContextRow trade={t} sessionsText={sessionsText} />
              <TickerContext ticker={t.ticker} day={dayOf(t)} />
              <TradeRelated trade={t} allTrades={p.allTrades} onOpenTrade={p.onOpenTrade} parts={["ideas", "history"]} />
              <React.Suspense fallback={<Skeleton className="h-32 rounded-2xl" />}>
                <LazyNewsFeed ticker={t.ticker} limit={10} compact cutoffDate={t.createdAt ?? `${dayOf(t)}T23:59:59Z`} />
              </React.Suspense>
            </div>
          </SheetSection>
          <SheetSection id="related" title={tt("sheet.sections.related")} api={sections}>
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-2.5 text-sm">
                <Link href={links.dayReport(dayOf(t), t.trader ?? undefined)} className="inline-flex items-center gap-1 text-primary hover:underline">
                  <FileText className="h-3.5 w-3.5" aria-hidden="true" /> {tt("sheet.dayReportLink")}
                </Link>
                <DeskDayLink ticker={t.ticker} date={t.date} trader={t.trader} />
              </div>
              <TradeRelated trade={t} allTrades={p.allTrades} onOpenTrade={p.onOpenTrade} parts={["playbook"]} />
            </div>
          </SheetSection>
        </div>
      </div>
    </>
  );
}

/** «Разбор»: markup, the review text, curator reviews and likes, execution quality and the AI review (nested, on demand). */
function ReviewSection(p: Props & {
  trade: Trade; sections: SectionsApi; awaitingReview: boolean; reviewCount: number; onReviewCount: (n: number) => void;
  afterExit: number; onAfterExitChange: (n: number) => void; showAi: boolean; redacted: boolean;
}) {
  const { t: tt } = tradesI18n.useT();
  const t = p.trade;
  const badge = p.awaitingReview
    ? <Pill tone="warn" dot className="ml-1">{tt("sheet.awaitingReview")}</Pill>
    : p.reviewCount > 0 ? <Pill tone="purple" className="ml-1" title={tt("sheet.curatorReviews", { count: p.reviewCount })}>{p.reviewCount}</Pill> : null;
  return (
    // Mounted while closed: the curator reviews report their count to the header (and open the section when present).
    <SheetSection id="review" title={tt("sheet.sections.review")} api={p.sections} badge={badge} keepMounted>
      <div className="space-y-5">
        <TradeMarkup trade={t} canEdit={p.canEdit} onTag={p.onTag} onPatch={p.onPatch} />
        <section className="space-y-2" aria-label={tt("sheet.review")}>
          <ReviewEditor trade={t} keys={REVIEW_TEXT_KEYS} canEdit={p.canEdit} onPatch={p.onPatch} emptyText={tt("sheet.reviewEmpty")} />
        </section>
        <TradeSocial tradeId={t.id} showReviews={!p.redacted} traderName={p.traderName} isCurator={p.isCurator} onCount={p.onReviewCount} />
        {(t.entry != null || t.exit != null) && !p.redacted && (
          <section className="space-y-2">
            <p className="micro-label">{tt("sheet.quality")}</p>
            <QualityBlock trade={t} afterExit={p.afterExit} onAfterExitChange={p.onAfterExitChange} />
          </section>
        )}
        {p.showAi && (
          <SheetSection id="ai" title={tt("sheet.sections.ai")} api={p.sections} nested>
            <React.Suspense fallback={<Skeleton className="h-48 rounded-2xl" />}>
              <LazyAiReviewPanel tradeId={t.id} conviction={t.conviction} confidenceGrade={t.confidenceGrade} tradeDate={t.date} trader={t.trader} />
            </React.Suspense>
          </SheetSection>
        )}
      </div>
    </SheetSection>
  );
}
