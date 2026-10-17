import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import type { MarketEvent } from "@workspace/api-client-react";
import { Pencil, Trash2, LineChart, History, ArrowLeftRight, Info, Wand2, ExternalLink, Link2, Unlink, BookOpen, MessageSquare } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Pill, StatRow, TermLabel, toneOf, toneText } from "@/components/ds";
import { AddToPlaybookButton } from "@/components/add-to-playbook";
import { ScreenshotDisplay } from "@/components/screenshot-fields";
import { BASE } from "@/lib/api";
import { links } from "@/lib/links";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  dayOf, displayTags, fmtDay, fmtPct, getSession, eventTone, splitTickers, typeMeta,
} from "./event-meta";
import { MoveValue, ReactionPill, SessionPill, TagChips, TypePill } from "./event-pills";

type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };
type ReactionResult =
  | { kind: "ok"; gap: number | null; day: number | null; openToClose: number; range: number; volume: number; close: number; prevClose: number | null }
  | { kind: "none"; reason: string };

async function fetchReaction(ticker: string, date: string): Promise<ReactionResult> {
  const r = await fetch(`${BASE}/api/candles/${encodeURIComponent(ticker)}?date=${encodeURIComponent(date)}&interval=1d`);
  if (r.status === 422) {
    const j = await r.json().catch(() => ({}));
    return { kind: "none", reason: j?.reason === "future" ? "Событие ещё впереди — данных нет" : j?.reason === "weekend" ? "Выходной — торгов не было" : "Нет торгов в этот день" };
  }
  if (r.status === 404 || r.status === 400) return { kind: "none", reason: "Нет рыночных данных по тикеру" };
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = (await r.json()) as { candles: Candle[]; prevClose: number | null };
  const cs = j.candles ?? [];
  if (!cs.length) return { kind: "none", reason: "Нет рыночных данных по тикеру" };
  const o = cs[0].o, c = cs[cs.length - 1].c;
  const h = Math.max(...cs.map((x) => x.h)), l = Math.min(...cs.map((x) => x.l));
  const pc = j.prevClose;
  return {
    kind: "ok",
    gap: pc ? ((o - pc) / pc) * 100 : null,
    day: pc ? ((c - pc) / pc) * 100 : null,
    openToClose: o ? ((c - o) / o) * 100 : 0,
    range: o ? ((h - l) / o) * 100 : 0,
    volume: cs.reduce((s, x) => s + (x.v || 0), 0),
    close: c,
    prevClose: pc,
  };
}

/* `GET /api/events/:id/trades` — candidates (same ticker, event day) + explicitly linked trades; numbers from the shared API math. */
type LinkedTrade = {
  id: number; ticker: string; date: string; exitDate: string | null; closeDate: string; side: string | null; setup: string | null;
  result: string | null; horizon: string | null; pnl: number | null; fees: number | null; netPnl: number | null; rMultiple: number | null; signedR: number | null;
  trader: string | null; source: string | null; brokerAccount: string | null; qty: number | null; linked: boolean;
};
type TradeStats = { n: number; wins: number; losses: number; be: number; open: number; winRate: number | null; sumR: number; grossPnl: number; fees: number; netPnl: number; byAccount: { account: string; n: number; grossPnl: number; fees: number; netPnl: number }[] };
type TradesPayload = { scope: string | null; trades: LinkedTrade[]; stats: TradeStats };

function fmtUsd(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  const s = Math.abs(n).toLocaleString("ru-RU", { maximumFractionDigits: 0 });
  return n < 0 ? `−$${s}` : `$${s}`;
}

function fmtVol(v: number) {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
}

function Section({ icon: Icon, title, actions, children }: { icon: React.ElementType; title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="glass-panel rounded-2xl p-4">
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {actions && <div className="ml-auto flex items-center gap-1">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-xl bg-[var(--glass-bg)] p-3">
      <div className="micro-label">{label}</div>
      <div className={cn("mt-1 text-lg font-semibold tabular-nums", toneText(toneOf(value)))}>{fmtPct(value)}</div>
    </div>
  );
}

function ReactionBlock({ event, onFill, filling }: { event: MarketEvent; onFill: (day: number, gap: number | null) => void; filling: boolean }) {
  const tickers = splitTickers(event.ticker).slice(0, 8);
  const [ticker, setTicker] = React.useState(tickers[0] ?? "");
  React.useEffect(() => setTicker(splitTickers(event.ticker)[0] ?? ""), [event.id, event.ticker]);
  const date = dayOf(event);
  const valid = /^[A-Z][A-Z0-9.-]{0,10}$/.test(ticker);
  const q = useQuery({
    queryKey: ["event-reaction", ticker, date],
    queryFn: () => fetchReaction(ticker, date),
    enabled: valid,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
  const logged = event.percentMove;

  return (
    <Section icon={LineChart} title="Реакция рынка">
      <div className="mb-3 flex flex-wrap items-end gap-4">
        <div>
          <div className="micro-label">Записано</div>
          <MoveValue value={logged} className="text-2xl" />
        </div>
        <ReactionPill reaction={event.reaction} />
        {event.volume && <span className="text-xs text-muted-foreground">Объём: {event.volume}</span>}
      </div>

      {tickers.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1" role="group" aria-label="Тикер для графика">
          {tickers.map((t) => (
            <button key={t} type="button" aria-pressed={t === ticker} onClick={() => setTicker(t)} className="chip min-h-7 px-2.5 text-xs font-medium">{t}</button>
          ))}
        </div>
      )}

      {!valid ? (
        <p className="text-xs text-muted-foreground">Нет тикера для загрузки графика.</p>
      ) : q.isLoading ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
        </div>
      ) : q.isError ? (
        <p className="text-xs text-muted-foreground">Не удалось загрузить котировки. <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => q.refetch()}>Повторить</button></p>
      ) : q.data?.kind === "none" ? (
        <p className="text-xs text-muted-foreground">{q.data.reason}</p>
      ) : q.data?.kind === "ok" ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric label="Гэп" value={q.data.gap} />
            <Metric label="За день" value={q.data.day} />
            <Metric label="Открытие → закрытие" value={q.data.openToClose} />
            <div className="rounded-xl bg-[var(--glass-bg)] p-3">
              <div className="micro-label">Диапазон</div>
              <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">{q.data.range.toFixed(1)}%</div>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="tabular-nums">{ticker} · закрытие {q.data.close.toFixed(2)}{q.data.prevClose ? ` · вчера ${q.data.prevClose.toFixed(2)}` : ""}</span>
            {q.data.volume > 0 && <span className="tabular-nums">объём {fmtVol(q.data.volume)}</span>}
            {logged == null && q.data.day != null && (
              <Button size="sm" variant="outline" className="ml-auto" disabled={filling} onClick={() => { const d = q.data; if (d?.kind === "ok" && d.day != null) onFill(d.day, d.gap); }}>
                <Wand2 /> {filling ? "Сохраняем…" : "Записать итог из котировок"}
              </Button>
            )}
          </div>
        </>
      ) : null}
    </Section>
  );
}

function HistoryBlock({ event, all, onOpen }: { event: MarketEvent; all: MarketEvent[]; onOpen: (e: MarketEvent) => void }) {
  const tickers = new Set(splitTickers(event.ticker));
  const items = all
    .filter((e) => e.id !== event.id && splitTickers(e.ticker).some((t) => tickers.has(t)))
    .sort((a, b) => dayOf(b).localeCompare(dayOf(a)));
  const moves = items.map((e) => e.percentMove).filter((v): v is number => v != null);
  const avgAbs = moves.length ? moves.reduce((s, v) => s + Math.abs(v), 0) / moves.length : null;
  const ups = items.filter((e) => eventTone(e) === "up").length;
  const dirKnown = items.filter((e) => eventTone(e) !== "neutral").length;

  return (
    <Section icon={History} title="История тикера">
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">Других событий по {[...tickers].slice(0, 3).join(", ")} пока нет — это первое.</p>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap gap-1.5">
            <Pill tone="neutral">{items.length} ранее</Pill>
            {avgAbs != null && <Pill tone="accent">средний ход {avgAbs.toFixed(1)}%</Pill>}
            {dirKnown > 0 && <Pill tone={ups / dirKnown >= 0.5 ? "up" : "down"}>вверх {Math.round((ups / dirKnown) * 100)}%</Pill>}
          </div>
          <ul className="flex flex-col">
            {items.slice(0, 8).map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => onOpen(e)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[var(--glass-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="w-16 shrink-0 text-xs tabular-nums text-muted-foreground">{fmtDay(dayOf(e), { day: "numeric", month: "short", year: "2-digit" })}</span>
                  <span className="min-w-0 flex-1 truncate text-foreground/90">{e.headline}</span>
                  <span className="hidden sm:inline"><TypePill type={e.eventType} className="text-2xs" /></span>
                  <MoveValue value={e.percentMove} className="w-14 shrink-0 text-right text-xs" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

function TradesBlock({ event }: { event: MarketEvent }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useQuery({
    queryKey: ["event-trades", event.id],
    queryFn: async (): Promise<TradesPayload | null> => {
      const r = await fetch(`${BASE}/api/events/${event.id}/trades`);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as TradesPayload;
    },
    staleTime: 60 * 1000,
    retry: false,
  });
  const link = useMutation({
    mutationFn: async ({ tradeId, unlink }: { tradeId: number; unlink: boolean }) => {
      const r = await fetch(`${BASE}/api/events/${event.id}/link-trade`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tradeId, unlink }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j?.error ?? `HTTP ${r.status}`); }
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["event-trades", event.id] }); void qc.invalidateQueries({ queryKey: ["events-today"] }); },
    onError: (e) => toast({ title: "Не удалось изменить привязку", description: String((e as Error).message), variant: "destructive" }),
  });
  if (q.data === null) return null; // endpoint not deployed yet
  const day = dayOf(event);
  const ticker = splitTickers(event.ticker)[0];
  const stats = q.data?.stats;
  const linked = (q.data?.trades ?? []).filter((t) => t.linked);
  const candidates = (q.data?.trades ?? []).filter((t) => !t.linked);

  const row = (t: LinkedTrade) => {
    const res = t.result?.toLowerCase();
    const tone = res === "win" ? "up" : res === "loss" ? "down" : "neutral";
    const r = t.signedR ?? t.rMultiple;
    return (
      <li key={t.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--glass-hover-bg)]">
        <Link href={links.trade(t.id)} className="flex min-w-0 flex-1 items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="font-semibold text-foreground">{t.ticker}</span>
          {t.side && <span className="text-xs text-muted-foreground">{t.side}</span>}
          {t.setup ? <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{t.setup}</span> : <span className="flex-1" />}
          {t.trader && <span className="hidden text-xs text-muted-foreground sm:inline">{t.trader}</span>}
          {t.brokerAccount && <span className="hidden text-2xs text-muted-foreground lg:inline">{t.brokerAccount}</span>}
          {r != null && <span className={cn("text-xs font-semibold tabular-nums", toneText(toneOf(r)))}>{r > 0 ? "+" : ""}{r.toFixed(1)}R</span>}
          {t.netPnl != null && <span className={cn("text-xs tabular-nums", toneText(toneOf(t.netPnl)))} title={`брутто ${fmtUsd(t.pnl)} · комиссии ${fmtUsd(t.fees)}`}>{fmtUsd(t.netPnl)}</span>}
          <Pill tone={tone} className="text-2xs">{t.result ?? "open"}</Pill>
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        </Link>
        <button
          type="button"
          aria-label={t.linked ? "Отвязать сделку" : "Привязать сделку к событию"}
          title={t.linked ? "Отвязать" : "Привязать"}
          disabled={link.isPending}
          onClick={() => link.mutate({ tradeId: t.id, unlink: t.linked })}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-[var(--glass-bg)] hover:text-foreground"
        >
          {t.linked ? <Unlink className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
        </button>
      </li>
    );
  };

  return (
    <Section
      icon={ArrowLeftRight}
      title="Сделки по событию"
      actions={
        <>
          {q.data?.scope && <Pill tone="neutral" className="text-2xs">{q.data.scope}</Pill>}
          <Link href={links.trades({ ticker, date: day })} className="text-xs text-primary hover:underline">все сделки</Link>
          <Link href={links.journalDay(day)} className="inline-flex items-center gap-1 text-xs text-primary hover:underline"><BookOpen className="h-3 w-3" aria-hidden="true" />журнал</Link>
          <Link href={links.newThread({ ticker })} className="inline-flex items-center gap-1 text-xs text-primary hover:underline"><MessageSquare className="h-3 w-3" aria-hidden="true" />обсудить</Link>
        </>
      }
    >
      {q.isLoading ? (
        <Skeleton className="h-10 rounded-xl" />
      ) : q.isError ? (
        <p className="text-xs text-muted-foreground">Не удалось загрузить сделки.</p>
      ) : !q.data?.trades.length ? (
        <p className="text-xs text-muted-foreground">Сделок в {splitTickers(event.ticker).slice(0, 3).join(", ")} за {fmtDay(day)} нет.</p>
      ) : (
        <>
          {stats && stats.n > 0 && (
            <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-xl bg-[var(--glass-bg)] p-2.5">
                <div className="micro-label">Сделок</div>
                <div className="mt-0.5 text-base font-semibold tabular-nums">{stats.n}{stats.open ? <span className="text-xs text-muted-foreground"> · {stats.open} откр.</span> : null}</div>
              </div>
              <div className="rounded-xl bg-[var(--glass-bg)] p-2.5">
                <div className="micro-label">Win rate</div>
                <div className="mt-0.5 text-base font-semibold tabular-nums">{stats.winRate != null ? `${Math.round(stats.winRate)}%` : "—"}<span className="text-xs text-muted-foreground"> {stats.wins}/{stats.losses}{stats.be ? ` · BE ${stats.be}` : ""}</span></div>
              </div>
              <div className="rounded-xl bg-[var(--glass-bg)] p-2.5">
                <div className="micro-label">ΣR</div>
                <div className={cn("mt-0.5 text-base font-semibold tabular-nums", toneText(toneOf(stats.sumR)))}>{stats.sumR > 0 ? "+" : ""}{stats.sumR.toFixed(1)}R</div>
              </div>
              <div className="rounded-xl bg-[var(--glass-bg)] p-2.5" title={`брутто ${fmtUsd(stats.grossPnl)} · комиссии ${fmtUsd(stats.fees)}`}>
                <div className="micro-label">P&L нетто</div>
                <div className={cn("mt-0.5 text-base font-semibold tabular-nums", toneText(toneOf(stats.netPnl)))}>{fmtUsd(stats.netPnl)}</div>
                <div className="text-2xs text-muted-foreground">брутто {fmtUsd(stats.grossPnl)}</div>
              </div>
            </div>
          )}
          {stats && stats.byAccount.length > 1 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {stats.byAccount.map((a) => (
                <Pill key={a.account} tone={toneOf(a.netPnl)} className="text-2xs">{a.account}: {fmtUsd(a.netPnl)} · {a.n}</Pill>
              ))}
            </div>
          )}
          {linked.length > 0 && (
            <>
              <div className="micro-label mb-1">Привязаны</div>
              <ul className="flex flex-col">{linked.map(row)}</ul>
            </>
          )}
          {candidates.length > 0 && (
            <>
              <div className="micro-label mb-1 mt-2">В тот же день по тикеру</div>
              <ul className="flex flex-col">{candidates.map(row)}</ul>
            </>
          )}
        </>
      )}
    </Section>
  );
}

export function EventDetailSheet({
  event, all, open, onOpenChange, onEdit, onDelete, onOpenEvent, onPatch, patching,
}: {
  event: MarketEvent | null;
  all: MarketEvent[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onEdit: (e: MarketEvent) => void;
  onDelete: (e: MarketEvent) => void;
  onOpenEvent: (e: MarketEvent) => void;
  onPatch: (id: number, body: Record<string, unknown>) => Promise<void>;
  patching?: boolean;
}) {
  const e = event;
  const fundamentals = e ? ([
    ["Компания", e.longName],
    ["Сектор", e.sector],
    ["Капитализация", e.marketCap],
    ["Float", e.float],
    ["Ср. дневной объём", e.adv],
    ["ATR", e.atr != null ? e.atr.toFixed(2) : null],
    ["RVOL", e.relativeVolume != null ? `${e.relativeVolume.toFixed(2)}×` : null],
    ["Beta", e.beta != null ? e.beta.toFixed(2) : null],
    ["Short interest", e.shortInterest != null ? `${e.shortInterest.toFixed(1)}%` : null],
  ] as const).filter(([, v]) => v != null && v !== "") : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl">
        {e && (
          <>
            <SheetHeader className="space-y-2 p-5 pb-3 pr-14 text-left">
              <div className="flex flex-wrap items-center gap-1.5">
                <TypePill type={e.eventType} />
                <SessionPill session={getSession(e)} />
                <span className="text-xs tabular-nums text-muted-foreground">{fmtDay(dayOf(e), { weekday: "short", day: "numeric", month: "long", year: "numeric" })}</span>
              </div>
              <SheetTitle className="text-2xl font-semibold tracking-tight">{e.ticker}</SheetTitle>
              <SheetDescription className="text-sm text-foreground/90">{e.headline}</SheetDescription>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={() => onEdit(e)}><Pencil /> Редактировать</Button>
                <AddToPlaybookButton
                  payload={{
                    name: `${e.ticker} ${typeMeta(e.eventType).label} (${dayOf(e)})`,
                    setupType: /earn/i.test(e.eventType) ? "Earnings Gap Up" : /momentum/i.test(e.eventType) ? "Intraday Momentum" : /ipo/i.test(e.eventType) ? "IPO Day Trade" : undefined,
                    conditions: e.headline || undefined,
                    notes: [e.summary, e.reaction ? `Реакция: ${e.reaction}` : "", e.percentMove != null ? `Движение: ${fmtPct(e.percentMove)}` : "", e.volume ? `Объём: ${e.volume}` : ""].filter(Boolean).join("\n") || undefined,
                    screenshotUrl: e.screenshotUrl || undefined,
                    screenshotNotes: e.screenshotNotes || undefined,
                    tags: displayTags(e.tags).join(", ") || undefined,
                    ticker: splitTickers(e.ticker)[0],
                    marketCap: e.marketCap, float: e.float, adv: e.adv, atr: e.atr, relativeVolume: e.relativeVolume,
                    beta: e.beta, shortInterest: e.shortInterest, sector: e.sector, longName: e.longName,
                    sourceType: "event",
                    sourceId: e.id,
                  }}
                />
                <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-down" onClick={() => onDelete(e)}><Trash2 /> Удалить</Button>
              </div>
            </SheetHeader>

            <div className="flex flex-col gap-3 px-5 pb-6">
              <ReactionBlock
                event={e}
                filling={!!patching}
                onFill={(day, gap) => {
                  const body: Record<string, unknown> = { percentMove: Math.round(day * 100) / 100 };
                  if (!e.reaction && gap != null && Math.abs(gap) >= 1) body.reaction = gap > 0 ? "gap_up" : "gap_down";
                  void onPatch(e.id, body);
                }}
              />

              {e.summary && (
                <Section icon={Info} title="Заметки">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{e.summary}</p>
                </Section>
              )}

              {displayTags(e.tags).length > 0 && <TagChips tags={e.tags} />}

              {e.screenshotUrl && (
                <section className="glass-panel rounded-2xl p-4">
                  <ScreenshotDisplay
                    urls={e.screenshotUrl}
                    notes={e.screenshotNotes}
                    onNotesChange={(notes) => { void onPatch(e.id, { screenshotNotes: notes }); }}
                  />
                </section>
              )}

              <TradesBlock event={e} />
              <HistoryBlock event={e} all={all} onOpen={onOpenEvent} />

              {fundamentals.length > 0 && (
                <Section icon={Info} title="Профиль тикера">
                  <div className="divide-y divide-border/60">
                    {fundamentals.map(([k, v]) => <StatRow key={k} label={<TermLabel text={k} />} value={v} />)}
                  </div>
                </Section>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
