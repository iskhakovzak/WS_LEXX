import * as React from "react";
import type { Trade } from "@workspace/api-client-react";
import { Link } from "wouter";
import { ChevronDown, ChevronUp, FileText, Pencil, Trash2 } from "lucide-react";
import { Pill, toneOf, toneText } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { AddToPlaybookButton } from "@/components/add-to-playbook";
import { REDACTED_HINT, RedactedHint } from "@/components/playbook/setup-bits";
import { ScreenshotDisplay } from "@/components/screenshot-fields";
import { DateHolidayBadge } from "@/components/holiday-badge";
import type { HolidayEvent } from "@/lib/market-intel";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import {
  EVENT_LABEL,
  SESSION_LABEL,
  dayOf,
  daysHeld,
  effectiveR,
  fmtDay,
  fmtMoney,
  fmtPrice,
  fmtR,
  horizonOf,
  isBrokerTrade,
  isRedactedTrade,
  netPnl,
  resultKey,
} from "./trade-utils";
import { ConvictionDots, HorizonPill, ResultMenu, SidePill } from "./trade-bits";
import type { TagKind } from "./review-presets";
import { ReviewChips, type PickerTarget } from "./review-tagging";
import { ExecutionsPanel } from "./ExecutionsPanel";
import { ChecklistStatus, TradeRelated, useSourceIdeaTarget } from "./TradeRelated";
import { TradeSocial } from "./TradeSocial";
import { QualityBlock, useAfterExitMinutes } from "@/components/replay/QualityBlock";
import { ET_SESSION_LABEL, etWallToIso, fmtDuration, sessionOfEt, type EtSession } from "@/components/trade-chart-parts/chart-utils";

/** Session names as the DB stores them (PropReports sync writes «postmarket»; the shared map only knows «afterhours»). */
const SESSION_LABEL_LOCAL: Record<string, string> = { ...SESSION_LABEL, postmarket: "Постмаркет", afterhours: "Постмаркет", regular: "Основная сессия" };

type TradeTiming = {
  /** Wall-clock ET «HH:MM:SS» of the first fill / last fill (PropReports contextSnapshot), when known. */
  openedWall: string | null;
  closedWall: string | null;
  openedIso: string | null;
  closedIso: string | null;
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
    openedWall: o?.time ?? null, closedWall: c?.time ?? null, openedIso, closedIso, holdSeconds,
    entrySession: openedIso ? sessionOfEt(openedIso) : null, exitSession: closedIso ? sessionOfEt(closedIso) : null,
  };
}

const LazyTradeChart = React.lazy(() => import("@/components/trade-chart").then((m) => ({ default: m.TradeChart })));
const LazyReplayChart = React.lazy(() => import("@/components/chart-engine").then((m) => ({ default: m.WsChart })));
const LazyNewsFeed = React.lazy(() => import("@/components/news-feed").then((m) => ({ default: m.NewsFeed })));
const LazyAiReviewPanel = React.lazy(() => import("@/components/ai-review-panel").then((m) => ({ default: m.AiReviewPanel })));
const LazyVoiceNotePlayer = React.lazy(() => import("@/components/voice-note-player").then((m) => ({ default: m.VoiceNotePlayer })));

export type TradePatch = Partial<Pick<Trade, "result" | "notes" | "whatWorked" | "whatFailed" | "conclusion" | "tags" | "screenshotNotes" | "setup">>;

/** Idea targets are free text («125 / 130», «$12.50») — the replay draws the first price it finds. */
function parseTargetPrice(target: string | null): number | null {
  if (!target) return null;
  const m = /\d+(?:[.,]\d+)?/.exec(target);
  if (!m) return null;
  const n = Number(m[0].replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

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
  userKey: string;
  voiceNoteKey: number;
  holidayEvents: HolidayEvent[];
};

function Kpi({ label, value, className, hint }: { label: string; value: React.ReactNode; className?: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-[var(--glass-bg)] px-3 py-2" title={hint}>
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className={cn("truncate text-base font-semibold tabular-nums", className)}>{value}</p>
    </div>
  );
}

const REVIEW_FIELDS = [
  ["notes", "Заметки"],
  ["whatWorked", "Что сработало"],
  ["whatFailed", "Что не сработало"],
  ["conclusion", "Вывод / урок"],
] as const;
type ReviewKey = (typeof REVIEW_FIELDS)[number][0];

/** Inline editor for the four review text fields; saves only changed fields. */
function ReviewEditor({ trade, canEdit, onPatch }: { trade: Trade; canEdit: boolean; onPatch: Props["onPatch"] }) {
  const initial = React.useMemo(
    () => Object.fromEntries(REVIEW_FIELDS.map(([k]) => [k, trade[k] ?? ""])) as Record<ReviewKey, string>,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trade.id, trade.notes, trade.whatWorked, trade.whatFailed, trade.conclusion],
  );
  const [draft, setDraft] = React.useState(initial);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => setDraft(initial), [initial]);
  const dirtyKeys = REVIEW_FIELDS.map(([k]) => k).filter((k) => draft[k] !== initial[k]);

  if (!canEdit) {
    const filled = REVIEW_FIELDS.filter(([k]) => trade[k]);
    if (!filled.length) return <p className="text-sm text-muted-foreground">Разбор не заполнен.</p>;
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {filled.map(([k, label]) => (
          <div key={k} className="rounded-xl bg-[var(--glass-bg)] p-3">
            <p className="mb-1 text-xs text-muted-foreground">{label}</p>
            <p className="whitespace-pre-wrap text-sm">{trade[k]}</p>
          </div>
        ))}
      </div>
    );
  }

  async function save() {
    if (!dirtyKeys.length) return;
    setSaving(true);
    const patch: TradePatch = {};
    for (const k of dirtyKeys) patch[k] = draft[k].trim() ? draft[k] : null;
    await onPatch(trade, patch);
    setSaving(false);
  }

  return (
    <div
      className="space-y-3"
      onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {REVIEW_FIELDS.map(([k, label]) => (
          <div key={k} className="space-y-1.5">
            <Label htmlFor={`rv-${trade.id}-${k}`} className="text-xs text-muted-foreground">{label}</Label>
            <Textarea
              id={`rv-${trade.id}-${k}`}
              value={draft[k]}
              onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
              rows={3}
              placeholder={k === "conclusion" ? "Главный урок одной фразой" : undefined}
              className={cn("resize-y rounded-xl text-sm", draft[k] !== initial[k] && "border-primary/60")}
            />
          </div>
        ))}
      </div>
      {dirtyKeys.length > 0 && (
        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto text-xs text-muted-foreground">Не сохранено · Ctrl+Enter</span>
          <Button variant="ghost" size="sm" onClick={() => setDraft(initial)} disabled={saving}>Отменить</Button>
          <Button size="sm" onClick={save} disabled={saving}>{saving ? "Сохраняем…" : "Сохранить разбор"}</Button>
        </div>
      )}
    </div>
  );
}

export function TradeDetailSheet(p: Props) {
  const t = p.trade;
  const [tab, setTab] = React.useState("overview");
  const [reviewCount, setReviewCount] = React.useState<number | null>(null);
  const [afterExit, setAfterExit] = useAfterExitMinutes();
  const ideaTarget = useSourceIdeaTarget(t);
  const timing = React.useMemo(() => (t ? tradeTiming(t) : null), [t]);
  const [picker, setPicker] = React.useState<PickerTarget>(null);
  React.useEffect(() => { setReviewCount(null); setPicker(null); }, [t?.id]);
  const canEditForm = p.canEditForm ?? p.canEdit;
  const canEditResult = p.canEditResult ?? p.canEdit;
  const canDelete = p.canDelete ?? p.canEdit;
  // Another trader's trade opened from the playbook: $ come back null, and the owner-only blocks (quality, AI
  // review, checklist, voice notes, curator reviews) would only answer 403 — they are not shown at all.
  const redacted = t ? isRedactedTrade(t) : false;
  React.useEffect(() => { if (redacted && tab === "ai") setTab("overview"); }, [redacted, tab]);

  return (
    <Sheet open={!!t} onOpenChange={(v) => { if (!v) p.onClose(); }}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl lg:max-w-3xl">
        {t ? (
          <>
            <SheetHeader className="space-y-3 border-b border-border/70 px-5 pb-4 pt-5 text-left">
              <div className="flex items-start gap-3 pr-10">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <SheetTitle className="text-2xl font-semibold tracking-tight">{t.ticker}</SheetTitle>
                    <SidePill side={t.side} />
                    <HorizonPill horizon={horizonOf(t)} showIntraday />
                    <ResultMenu result={t.result} ticker={t.ticker} disabled={!canEditResult} onChange={(r) => { void p.onPatch(t, { result: r }); }} />
                  </div>
                  <SheetDescription className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      {fmtDay(dayOf(t))}
                      {t.exitDate && horizonOf(t) !== "intraday" && <> → {fmtDay(t.exitDate.substring(0, 10))}</>}
                      <DateHolidayBadge events={p.holidayEvents} />
                    </span>
                    {timing?.openedWall && (
                      <span className="tabular-nums" title="Время первого и последнего исполнения, Нью-Йорк (ET)">
                        · {timing.openedWall}{timing.closedWall ? ` → ${timing.closedWall}` : ""} ET{timing.holdSeconds != null ? ` · ${fmtDuration(timing.holdSeconds)}` : ""}
                      </span>
                    )}
                    {t.trader && <span>· {t.trader}</span>}
                    {(t.setup || t.eventType) && <span>· {t.setup || EVENT_LABEL[t.eventType ?? ""] || t.eventType}</span>}
                    {t.session && <span>· {SESSION_LABEL_LOCAL[t.session] ?? t.session}</span>}
                    {timing?.exitSession && timing.exitSession !== "regular" && timing.exitSession !== timing.entrySession && (
                      <span className="text-muted-foreground" title="Позиция закрыта вне основной сессии">· выход в {timing.exitSession === "postmarket" ? "постмаркете" : timing.exitSession === "premarket" ? "премаркете" : ET_SESSION_LABEL[timing.exitSession]}</span>
                    )}
                    <Link href={links.dayReport(dayOf(t), t.trader ?? undefined)} className="inline-flex items-center gap-1 text-primary hover:underline">
                      · <FileText className="h-3.5 w-3.5" aria-hidden="true" /> отчёт дня
                    </Link>
                  </SheetDescription>
                </div>
                {(p.onPrev || p.onNext) && (
                  <div className="flex shrink-0 items-center gap-1">
                    {p.position && <span className="mr-1 hidden text-xs tabular-nums text-muted-foreground sm:inline">{p.position.index + 1} / {p.position.total}</span>}
                    <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Предыдущая сделка (K)" disabled={!p.onPrev} onClick={p.onPrev}><ChevronUp /></Button>
                    <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Следующая сделка (J)" disabled={!p.onNext} onClick={p.onNext}><ChevronDown /></Button>
                  </div>
                )}
              </div>
              <KpiRow trade={t} holdSeconds={timing?.holdSeconds ?? null} />
              {redacted && <RedactedHint />}
              {p.canEdit && (
                <div className="flex flex-wrap items-center gap-2">
                  {canEditForm && <Button variant="outline" size="sm" className="gap-1.5" onClick={() => p.onEdit(t)}><Pencil className="h-3.5 w-3.5" /> Редактировать</Button>}
                  <AddToPlaybookButton
                    payload={{
                      name: `${t.ticker} ${t.setup || t.eventType || ""} (${dayOf(t)})`.trim(),
                      setupType: t.setup || t.eventType || undefined,
                      conditions: t.notes || undefined,
                      notes: [t.whatWorked ? `Что сработало: ${t.whatWorked}` : "", t.whatFailed ? `Что не сработало: ${t.whatFailed}` : "", t.conclusion ? `Вывод: ${t.conclusion}` : ""].filter(Boolean).join("\n") || undefined,
                      screenshotUrl: t.screenshotUrl || undefined,
                      screenshotNotes: t.screenshotNotes || undefined,
                      tags: t.tags || undefined,
                      sourceType: "trade",
                      sourceId: t.id,
                    }}
                  />
                  {canDelete && (
                    <Button variant="ghost" size="sm" className="ml-auto gap-1.5 text-muted-foreground hover:text-down" onClick={() => p.onDelete(t)}>
                      <Trash2 className="h-3.5 w-3.5" /> Удалить
                    </Button>
                  )}
                </div>
              )}
            </SheetHeader>

            <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
              <div className="px-5 pt-3">
                <TabsList className="w-full justify-start overflow-x-auto">
                  <TabsTrigger value="overview">Обзор</TabsTrigger>
                  <TabsTrigger value="chart">График</TabsTrigger>
                  <TabsTrigger value="replay">Реплей</TabsTrigger>
                  <TabsTrigger value="executions">Исполнения</TabsTrigger>
                  {!redacted && <TabsTrigger value="ai">AI-разбор</TabsTrigger>}
                  <TabsTrigger value="social">Обсуждение{reviewCount ? ` · ${reviewCount}` : ""}</TabsTrigger>
                </TabsList>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-2">
                <TabsContent value="overview" className="space-y-5">
                  <section className="space-y-2">
                    <p className="micro-label">Разметка</p>
                    {/* data-active keeps the "+" buttons visible here (they are hover-only in the list rows). */}
                    <div className="group" data-active="true">
                      <ReviewChips
                        trade={t}
                        canTag={p.canEdit && !!p.onTag}
                        picker={picker}
                        setPicker={setPicker}
                        onPick={(tr, kind, value) => p.onTag?.(tr, kind, value)}
                        setupOptions={p.setupOptions ?? []}
                      />
                    </div>
                  </section>
                  {!isBrokerTrade(t) && !redacted && <ChecklistStatus tradeId={t.id} />}
                  {(t.entry != null || t.exit != null) && !redacted && (
                    <section className="space-y-2">
                      <p className="micro-label">Качество исполнения</p>
                      <QualityBlock trade={t} afterExit={afterExit} onAfterExitChange={setAfterExit} />
                    </section>
                  )}
                  <section className="space-y-2">
                    <p className="micro-label">Разбор</p>
                    <ReviewEditor trade={t} canEdit={p.canEdit} onPatch={p.onPatch} />
                  </section>
                  <ContextRow trade={t} timing={timing} />
                  {t.screenshotUrl && (
                    <section className="space-y-2">
                      <p className="micro-label">Скриншоты</p>
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
                  <section className="space-y-2 border-t border-border/70 pt-4">
                    <TradeRelated trade={t} allTrades={p.allTrades} onOpenTrade={p.onOpenTrade} />
                  </section>
                </TabsContent>
                <TabsContent value="chart" className="space-y-4">
                  <React.Suspense fallback={<Skeleton className="h-[360px] rounded-2xl" />}>
                    <LazyTradeChart tradeId={t.id} ticker={t.ticker} date={t.date} side={t.side} entry={t.entry} exit={t.exit} stop={t.stop} rMultiple={t.rMultiple} target={ideaTarget} />
                  </React.Suspense>
                  <React.Suspense fallback={<Skeleton className="h-32 rounded-2xl" />}>
                    <LazyNewsFeed ticker={t.ticker} limit={10} compact cutoffDate={t.createdAt ?? `${dayOf(t)}T23:59:59Z`} />
                  </React.Suspense>
                </TabsContent>
                <TabsContent value="replay" className="space-y-4">
                  {tab === "replay" && (
                    <React.Suspense fallback={<Skeleton className="h-[504px] rounded-2xl" />}>
                      <LazyReplayChart key={t.id} trade={t} target={parseTargetPrice(ideaTarget)} height={460} />
                    </React.Suspense>
                  )}
                  {!redacted && (
                      <section className="space-y-2">
                        <p className="micro-label">Качество исполнения</p>
                        <QualityBlock trade={t} afterExit={afterExit} onAfterExitChange={setAfterExit} />
                      </section>
                    )}
                  </TabsContent>
                  <TabsContent value="executions">
                    <ExecutionsPanel tradeId={t.id} tradeDate={t.date} side={t.side} canEdit={p.canEdit} fees={t.fees} qty={t.qty} pnl={t.pnl} />
                  </TabsContent>
                  {!redacted && (
                  <TabsContent value="ai">
                    <React.Suspense fallback={<Skeleton className="h-48 rounded-2xl" />}>
                      <LazyAiReviewPanel
                        tradeId={t.id}
                        userKey={p.userKey}
                        conviction={t.conviction}
                        confidenceGrade={t.confidenceGrade}
                        tradeDate={t.date}
                        trader={t.trader}
                      />
                    </React.Suspense>
                  </TabsContent>
                )}
                <TabsContent value="social" forceMount className="data-[state=inactive]:hidden">
                  <TradeSocial key={t.id} tradeId={t.id} showReviews={!redacted} traderName={p.traderName} isCurator={p.isCurator} onCount={setReviewCount} />
                </TabsContent>
              </div>
            </Tabs>
          </>
        ) : (
          <SheetHeader className="sr-only"><SheetTitle>Сделка</SheetTitle><SheetDescription>Нет данных</SheetDescription></SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** One row of five: net (gross / fees in the tooltip), entry -> exit, hold, R or $ per share, size. */
function KpiRow({ trade: t, holdSeconds }: { trade: Trade; holdSeconds: number | null }) {
  const r = effectiveR(t);
  const net = netPnl(t);
  const open = resultKey(t.result) === "open";
  const held = daysHeld(t);
  const perShare = t.pnl != null && t.qty ? t.pnl / t.qty : null;
  const useR = r.value != null;
  const redacted = isRedactedTrade(t);
  return (
    <div className="grid grid-cols-5 gap-2">
      <Kpi
        label={t.fees ? "Нетто" : "P&L"}
        value={fmtMoney(net)}
        className={net == null ? "text-muted-foreground" : toneText(toneOf(net))}
        hint={redacted ? REDACTED_HINT : t.fees && t.pnl != null ? `Брутто ${fmtMoney(t.pnl)} · комиссии ${fmtMoney(-Math.abs(t.fees))}` : undefined}
      />
      <Kpi label="Вход → выход" value={`${fmtPrice(t.entry)} → ${open && t.exit == null ? "…" : fmtPrice(t.exit)}`} />
      {open && t.exit == null
        ? <Kpi label="В позиции" value={held != null ? `${held} дн.` : "—"} className="text-primary" />
        : <Kpi label="Удержание" value={holdSeconds != null ? fmtDuration(holdSeconds) : t.holdTime || "—"} className={holdSeconds == null && !t.holdTime ? "text-muted-foreground" : undefined} />}
      {useR
        ? <Kpi label={r.derived ? "R (по ценам)" : "R"} value={fmtR(r.value)} className={toneText(toneOf(r.value))} />
        : <Kpi label="На акцию" value={perShare != null ? `${perShare >= 0 ? "+" : "−"}$${Math.abs(perShare).toFixed(2)}` : "—"} className={perShare == null ? "text-muted-foreground" : toneText(toneOf(perShare))} hint={redacted ? REDACTED_HINT : "Брутто на акцию: стоп не задан, R не считается"} />}
      <Kpi label="Объём" value={t.qty != null ? `${t.qty.toLocaleString("en-US")} шт.` : "—"} className={t.qty == null ? "text-muted-foreground" : undefined} hint={redacted ? REDACTED_HINT : undefined} />
    </div>
  );
}

function ContextRow({ trade: t, timing }: { trade: Trade; timing: TradeTiming | null }) {
  const items: [string, React.ReactNode][] = [];
  // Size, gross/fees and hold are in the KPI row; the data source is not the trader's concern.
  if (t.stop != null && Number(t.stop) > 0) items.push(["Стоп", fmtPrice(t.stop)]);
  if (t.riskUsd != null) items.push(["Риск", `$${t.riskUsd.toLocaleString("en-US")}`]);
  if (timing?.entrySession && timing.exitSession && timing.entrySession !== timing.exitSession) items.push(["Сессии", `${ET_SESSION_LABEL[timing.entrySession]} → ${ET_SESSION_LABEL[timing.exitSession]}`]);
  const held = daysHeld(t);
  if (held != null && horizonOf(t) !== "intraday") items.push(["Дней", held]);
  if (t.relativeVolume != null) items.push(["RVOL", `${t.relativeVolume}x`]);
  if (t.float) items.push(["Float", t.float]);
  if (t.marketCap) items.push(["Капитализация", t.marketCap]);
  if (t.sector) items.push(["Сектор", t.sector]);
  if (t.atr != null) items.push(["ATR", t.atr]);
  if (t.slippage != null) items.push(["Проскальз.", t.slippage]);
  if (t.eventType) items.push(["Событие", EVENT_LABEL[t.eventType] ?? t.eventType]);
  const hasPsy = t.conviction != null || t.confidenceGrade;
  if (!items.length && !hasPsy) return null;
  return (
    <section className="space-y-2">
      <p className="micro-label">Контекст</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-1 rounded-full bg-[var(--glass-bg)] px-2.5 py-1 text-xs">
            <span className="text-muted-foreground">{k}</span>
            <span className="font-medium tabular-nums">{v}</span>
          </span>
        ))}
      </div>
      {hasPsy && (
        <div className="flex flex-wrap items-center gap-4 text-sm">
          {t.conviction != null && <span className="inline-flex items-center gap-2 text-muted-foreground">Убеждённость <ConvictionDots value={t.conviction} /></span>}
          {t.confidenceGrade && (
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              Грейд <Pill tone={t.confidenceGrade === "A+" ? "up" : t.confidenceGrade === "A" ? "accent" : t.confidenceGrade === "B" ? "warn" : "down"}>{t.confidenceGrade}</Pill>
            </span>
          )}
        </div>
      )}
    </section>
  );
}
