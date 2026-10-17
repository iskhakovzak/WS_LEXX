import * as React from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Lightbulb, Pencil, RefreshCw, Trash2, Target, Gauge, Link2, Check, ClipboardList, Archive, ArchiveRestore,
  AlertTriangle, History, LineChart, ArrowUpRight, ArrowDownRight, Briefcase,
} from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Pill, Segmented, StatRow, toneOf, toneText } from "@/components/ds";
import { AddToPlaybookButton } from "@/components/add-to-playbook";
import { ScreenshotDisplay } from "@/components/screenshot-fields";
import { gpApi, gpKeys } from "@/components/game-plan/types";
import { BASE } from "@/lib/api";
import { links } from "@/lib/links";
import { netPnl, signedR } from "@/lib/trade-math";
import { nyDate } from "@/lib/trading-date";
import { cn } from "@/lib/utils";
import {
  LISTS, LIST_LABELS, SCORE_LABELS, apiJson, calculatorHref, fmtMoney, fmtPct, fmtPrice, fmtVol, inPlayReasons, keyLevels,
  parseBreakdown, splitTags, timeAgoRu, type ListName, type WatchlistItem,
} from "./lib";
import { ScoreRing } from "./visuals";
import { TickerChart } from "./TickerChart";
import { fmtDay } from "./bits";
import type { RowActions } from "./WatchlistRow";
import type { WlRow } from "./WatchlistTable";

const LazyNewsFeed = React.lazy(() => import("@/components/news-feed").then((m) => ({ default: m.NewsFeed })));

type IdeaLite = { id: number; ticker: string; side: string | null; setup: string | null; status: string; createdAt: string; trader: string | null };

function Section({ title, icon: Icon, children, actions, className }: { title: React.ReactNode; icon: React.ElementType; children: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <section className={cn("glass-panel rounded-2xl p-[var(--panel-p)]", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />{title}
        </h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

function ScoreBreakdown({ raw, scoredAt }: { raw: string | null; scoredAt: string | null }) {
  const parsed = parseBreakdown(raw);
  if (!parsed) return null;
  return (
    <div className="space-y-2.5">
      {Object.entries(parsed.components).map(([key, c]) => {
        const pct = c.weight > 0 ? Math.min(100, Math.max(0, (c.weighted / c.weight) * 100)) : 0;
        return (
          <div key={key}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="text-foreground">{SCORE_LABELS[key] ?? key}</span>
              <span className="tabular-nums text-muted-foreground"><span className="font-medium text-foreground">{c.weighted}</span>/{c.weight}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--glass-bg)]">
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(3, pct)}%` }} />
            </div>
            {c.reason && <p className="mt-0.5 text-xs text-muted-foreground">{c.reason}</p>}
          </div>
        );
      })}
      {scoredAt && <p className="pt-1 text-xs text-muted-foreground">Рассчитан {new Date(scoredAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>}
    </div>
  );
}

function NotesEditor({ item, canEdit, onSave }: { item: WatchlistItem; canEdit: boolean; onSave: (notes: string) => void }) {
  const [draft, setDraft] = React.useState(item.notes ?? "");
  React.useEffect(() => setDraft(item.notes ?? ""), [item.id, item.notes]);
  const dirty = draft.trim() !== (item.notes ?? "").trim();
  if (!canEdit) {
    return item.notes ? <p className="whitespace-pre-wrap text-sm text-foreground">{item.notes}</p> : <p className="text-sm text-muted-foreground">Заметки нет.</p>;
  }
  return (
    <div className="space-y-2">
      <Textarea
        aria-label={`Сценарий и заметки по ${item.ticker}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && dirty) { e.preventDefault(); onSave(draft.trim()); } }}
        placeholder="Уровень: 182.40 (PDH). Сценарий: пробой и ретест → лонг. Триггер: объём > 2× на 5м. Стоп под 181.60."
        className="min-h-[88px] text-sm"
      />
      {dirty && (
        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto text-xs text-muted-foreground">Ctrl+Enter — сохранить</span>
          <Button variant="ghost" size="sm" onClick={() => setDraft(item.notes ?? "")}>Отменить</Button>
          <Button size="sm" className="bg-primary-solid" onClick={() => onSave(draft.trim())}><Check className="h-4 w-4" />Сохранить</Button>
        </div>
      )}
    </div>
  );
}

const sideLabel = (s: string | null | undefined) => {
  const v = (s ?? "").toLowerCase();
  if (v.startsWith("s")) return { text: "Short", Icon: ArrowDownRight };
  if (v.startsWith("l") || v.startsWith("b")) return { text: "Long", Icon: ArrowUpRight };
  return { text: s || "—", Icon: null };
};

export function WatchlistDetailSheet({
  row, me, canEdit, scoring, actions, onClose, planBusy,
}: {
  row: WlRow | null;
  me: string | null;
  canEdit: boolean;
  scoring: boolean;
  actions: RowActions;
  onClose: () => void;
  planBusy: boolean;
}) {
  const item = row?.item ?? null;
  const ticker = item?.ticker ?? "";
  const today = nyDate();
  const ideas = useQuery<IdeaLite[]>({
    queryKey: ["trade-ideas", "by-ticker", ticker],
    queryFn: () => apiJson<IdeaLite[]>(`${BASE}/api/trade-ideas?ticker=${encodeURIComponent(ticker)}`),
    enabled: !!ticker,
    staleTime: 60_000,
  });
  const myPlan = useQuery({
    queryKey: gpKeys.my(today),
    queryFn: () => gpApi.my(today),
    enabled: !!ticker && !!me && canEdit,
    staleTime: 60_000,
    retry: 0,
  });
  const inPlan = !!myPlan.data?.plan?.doc?.inPlay?.some((p) => p.ticker?.toUpperCase() === ticker);

  const q = row?.quote;
  const plan = row?.plan;
  const name = q?.name && q.name !== ticker ? q.name : item?.longName ?? null;
  const tags = splitTags(item?.tags);
  const allLevels = React.useMemo(
    () => (row && item ? keyLevels(q?.price, row.levels, item, q?.atr, false) : []),
    [row, item, q?.price, q?.atr],
  );
  const reasons = row && item && plan ? inPlayReasons(item, q, row.news, row.earnings, plan) : [];
  const h = row?.history;
  const losing = !!h && h.net < 0 && h.n >= 2;

  return (
    <Sheet open={!!row} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-2xl">
        {row && item && plan && (
          <div className="flex flex-col gap-[var(--grid-gap)] p-[var(--panel-p)]">
            <SheetHeader className="space-y-0 pr-10 text-left">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <SheetTitle className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xl">
                    <span>{item.ticker}</span>
                    <span className="text-2xl font-semibold tabular-nums tracking-tight">{fmtPrice(q?.price)}</span>
                    <span className={cn("text-base font-medium tabular-nums", toneText(toneOf(q?.change)))}>{fmtPct(q?.change, 2)}</span>
                  </SheetTitle>
                  <SheetDescription className="mt-0.5 truncate">
                    {[name, item.sector].filter(Boolean).join(" · ") || "Карточка тикера"}
                  </SheetDescription>
                </div>
                {item.score != null && <ScoreRing score={item.score} size={44} pending={scoring} />}
              </div>
            </SheetHeader>

            {/* List switch / archive */}
            <div className="flex flex-wrap items-center gap-2">
              {row.list ? (
                canEdit ? (
                  <Segmented
                    ariaLabel="Список"
                    size="sm"
                    value={row.list}
                    onChange={(l: ListName) => actions.moveTo([item], l)}
                    options={LISTS.map((l) => ({ value: l, label: LIST_LABELS[l] }))}
                  />
                ) : <Pill tone="accent">{LIST_LABELS[row.list]}</Pill>
              ) : (
                <>
                  <Pill tone="neutral">В архиве</Pill>
                  {canEdit && (
                    <Button size="sm" variant="outline" onClick={() => actions.restore(item, "watch")}><ArchiveRestore className="h-4 w-4" />Вернуть в «Наблюдаю»</Button>
                  )}
                </>
              )}
              {(item.openPositions ?? 0) > 0 && (
                <Link href={links.trades({ ticker: item.ticker, ids: item.openTradeIds })} className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Pill tone="accent"><Briefcase className="h-3 w-3" aria-hidden="true" />В позиции{item.openTraders?.length ? ` · ${item.openTraders.slice(0, 2).join(", ")}` : ""}</Pill>
                </Link>
              )}
              {item.status === "traded" && <Pill tone="neutral">торговал</Pill>}
            </div>

            {/* Market strip */}
            <div className="grid grid-cols-3 gap-x-5 whitespace-nowrap rounded-2xl bg-[var(--glass-bg)] px-4 py-2 sm:grid-cols-[repeat(4,auto)_minmax(0,1fr)]">
              <StatRow label="Гэп" value={fmtPct(q?.gapPct)} tone={toneOf(q?.gapPct)} className="flex-col items-start gap-0.5" />
              <StatRow label="rVol" value={q?.relativeVolume != null ? `${q.relativeVolume.toFixed(2)}×` : "—"} tone={q?.relativeVolume != null && q.relativeVolume >= 1.5 ? "accent" : "neutral"} className="flex-col items-start gap-0.5" />
              <StatRow label="ATR 14д" value={q?.atr != null ? `${q.atr.toFixed(2)}${q.price ? ` · ${((q.atr / q.price) * 100).toFixed(1)}%` : ""}` : "—"} className="flex-col items-start gap-0.5" />
              <StatRow label="Объём" value={`${fmtVol(q?.volume)} / ${fmtVol(q?.avgVolume)}`} className="flex-col items-start gap-0.5" />
              <StatRow label="52н" value={q?.low52w != null && q?.high52w != null ? `${fmtPrice(q.low52w)}–${fmtPrice(q.high52w)}` : "—"} className="hidden flex-col items-start gap-0.5 sm:flex" />
            </div>
            {reasons.length > 0 && (
              <div className="-mt-1 flex flex-wrap gap-1.5" aria-label="Что происходит">
                {reasons.map((r) => <Pill key={r.key} tone={r.key === "earn" ? "purple" : r.key === "lvl" ? r.tone : "neutral"}>{r.label}</Pill>)}
              </div>
            )}

            {/* Actions */}
            {canEdit && (
              <div className="flex flex-wrap items-center gap-2">
                <Button className="bg-primary-solid" onClick={() => actions.addToPlan(item)} disabled={planBusy || inPlan} title={inPlan ? "Уже в твоём плане на сегодня" : "Добавить в «В игре» твоего плана дня"}>
                  {inPlan ? <Check className="h-4 w-4" /> : <ClipboardList className="h-4 w-4" />}
                  {inPlan ? "В плане дня" : planBusy ? "Добавляем…" : "В план дня"}
                </Button>
                <Button variant="outline" onClick={() => actions.createIdea(item)}><Lightbulb className="h-4 w-4" />Создать идею</Button>
                <AddToPlaybookButton
                  size="sm"
                  payload={{
                    name: `${item.ticker}${item.catalyst ? ` — ${item.catalyst}` : ""}`,
                    notes: item.notes ?? undefined,
                    screenshotUrl: item.screenshotUrl ?? undefined,
                    tags: item.tags ?? undefined,
                    sourceType: "watchlist",
                    sourceId: item.id,
                  }}
                />
                <div className="ml-auto flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Пересчитать score" title="Пересчитать score" disabled={scoring} onClick={() => actions.rescore(item)}>
                    <RefreshCw className={cn("h-4 w-4", scoring && "animate-spin motion-reduce:animate-none")} />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Катализатор, стоп, цель" title="Катализатор, стоп, цель, теги, скриншоты" onClick={() => actions.edit(item)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  {row.list && (
                    <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="В архив" title="В архив (Del)" onClick={() => actions.archive([item])}>
                      <Archive className="h-4 w-4" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-9 w-9 hover:text-down" aria-label="Удалить" title="Удалить" onClick={() => actions.remove([item])}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            <Section title="График" icon={LineChart}>
              <TickerChart ticker={item.ticker} stop={item.stopPrice} target={item.targetPrice} />
            </Section>

            <Section
              title="Уровни"
              icon={Target}
              actions={canEdit ? <button type="button" className="text-xs text-primary hover:underline" onClick={() => actions.edit(item)}>{plan.stop == null && plan.target == null ? "Задать стоп и цель" : "Изменить стоп и цель"}</button> : undefined}
            >
              {allLevels.length === 0 ? (
                <p className="text-sm text-muted-foreground">{row.levels === undefined ? "Загружаем PDH / PDL / VWAP…" : "Нет данных по уровням."}</p>
              ) : (
                <table className="w-full text-sm tabular-nums">
                  <thead className="sr-only"><tr><th>Уровень</th><th>Цена</th><th>Расстояние</th><th>В ATR</th></tr></thead>
                  <tbody>
                    {allLevels.map((l) => {
                      const close = l.distAtr != null ? l.distAtr <= 0.25 : Math.abs(l.distPct) <= 0.5;
                      return (
                        <tr key={l.key} className="border-b border-border/40 last:border-0">
                          <td className={cn("py-1.5 font-medium", close ? "text-primary" : "text-foreground")}>{l.label}</td>
                          <td className="py-1.5 text-right text-foreground">{fmtPrice(l.price)}</td>
                          <td className={cn("py-1.5 text-right", close ? "text-primary" : "text-muted-foreground")}>{l.distPct >= 0 ? "↑" : "↓"} {Math.abs(l.distPct).toFixed(2)}%</td>
                          <td className="py-1.5 text-right text-muted-foreground">{l.distAtr != null ? `${l.distAtr.toFixed(2)} ATR` : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {plan.rr != null && (
                <p className="mt-2 text-xs text-muted-foreground">
                  R:R от текущей <span className="font-medium text-foreground">{plan.rr.toFixed(2)}</span>
                  {plan.stopAtr != null && <> · стоп {plan.stopAtr.toFixed(2)} ATR</>}
                  {" · "}<Link href={calculatorHref(item, plan.price, q?.atr)} className="text-primary hover:underline">размер позиции</Link>
                </p>
              )}
            </Section>

            <Section title="Сценарий" icon={Pencil}>
              {(row.earnings || item.catalyst || tags.length > 0) && (
                <div className="mb-3 space-y-1.5">
                  {row.earnings && (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Pill tone="purple">{row.earnings.callType}</Pill>
                      <span className="text-foreground">{row.earnings.when === "today" ? "Отчёт сегодня" : "Отчёт вчера после закрытия"}</span>
                      {row.earnings.epsSurprisePct != null && <span className={cn("tabular-nums", toneText(toneOf(row.earnings.epsSurprisePct)))}>EPS {fmtPct(row.earnings.epsSurprisePct)}</span>}
                    </div>
                  )}
                  {!row.earnings && row.upcoming && row.upcoming.date >= today && (
                    <p className="text-sm text-foreground"><Pill tone="purple" className="mr-2">{row.upcoming.callType}</Pill>Отчёт {fmtDay(row.upcoming.date)}</p>
                  )}
                  {item.catalyst && <p className="whitespace-pre-wrap text-sm text-foreground"><span className="text-muted-foreground">Катализатор: </span>{item.catalyst}</p>}
                  {tags.length > 0 && <div className="flex flex-wrap gap-1">{tags.map((t) => <Pill key={t} tone="neutral">{t}</Pill>)}</div>}
                </div>
              )}
              <NotesEditor item={item} canEdit={canEdit} onSave={(n) => actions.saveNote(item, n)} />
            </Section>

            <Section
              title={me ? "Мои сделки по тикеру" : "Сделки по тикеру"}
              icon={History}
              actions={<Link href={links.trades({ ticker: item.ticker, trader: me ?? undefined })} className="text-xs text-primary hover:underline">Все сделки</Link>}
            >
              {!me ? (
                <p className="text-sm text-muted-foreground">Личная история видна трейдеру под своим именем.</p>
              ) : !h || h.n === 0 ? (
                <p className="text-sm text-muted-foreground">Ты ещё не торговал {item.ticker}.</p>
              ) : (
                <>
                  {losing && (
                    <div className="mb-3 flex items-start gap-2 rounded-xl border border-down/30 bg-down/10 px-3 py-2 text-sm" role="note">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-down" aria-hidden="true" />
                      <span className="text-foreground">На этом тикере ты в минусе <span className="font-semibold text-down">{fmtMoney(h.net)}</span> за {h.n} сд. Уменьши размер или торгуй только A-сетап.</span>
                    </div>
                  )}
                  <div className="mb-2 grid grid-cols-2 gap-x-6 whitespace-nowrap">
                    <StatRow label="Net" value={fmtMoney(h.net)} tone={toneOf(h.net)} />
                    <StatRow label="WR" value={h.wr != null ? `${Math.round(h.wr * 100)}%` : "—"} />
                    <StatRow label="Сделок (W/L)" value={`${h.n} (${h.wins}/${h.losses})`} />
                    <StatRow label="Средняя" value={fmtMoney(h.avg)} tone={toneOf(h.avg)} />
                  </div>
                  <ul className="divide-y divide-border/40">
                    {h.trades.slice(0, 8).map((t) => {
                      const n = netPnl(t);
                      const r = signedR(t);
                      const s = sideLabel(t.side);
                      return (
                        <li key={t.id}>
                          <Link href={links.trade(t.id)} className="flex items-center gap-3 rounded-lg px-1 py-1.5 text-sm tabular-nums hover:bg-[var(--glass-hover-bg)]">
                            <span className="w-12 text-muted-foreground">{fmtDay(t.date)}</span>
                            <span className="inline-flex w-16 items-center gap-1 text-muted-foreground">{s.Icon && <s.Icon className="h-3.5 w-3.5" aria-hidden="true" />}{s.text}</span>
                            <span className="min-w-0 flex-1 truncate text-muted-foreground">{t.setup || ""}</span>
                            {r != null && <span className={cn("w-14 text-right", toneText(toneOf(r)))}>{r >= 0 ? "+" : "−"}{Math.abs(r).toFixed(1)}R</span>}
                            <span className={cn("w-20 text-right font-medium", toneText(toneOf(n)))}>{fmtMoney(n)}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </Section>

            <Section
              title="Идеи"
              icon={Link2}
              actions={<Link href={links.newIdea(item.ticker)} className="text-xs text-primary hover:underline">Новая идея</Link>}
            >
              {ideas.isLoading ? (
                <div className="space-y-2"><Skeleton className="h-9 w-full rounded-xl" /><Skeleton className="h-9 w-full rounded-xl" /></div>
              ) : (ideas.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Идей по {item.ticker} ещё нет.</p>
              ) : (
                <ul className="space-y-1.5">
                  {(ideas.data ?? []).slice(0, 5).map((i) => {
                    const s = sideLabel(i.side);
                    return (
                      <li key={i.id}>
                        <Link href={links.idea(i.id)} className="flex items-center gap-2 rounded-xl bg-[var(--glass-bg)] px-3 py-2 text-sm hover:bg-[var(--glass-hover-bg)]">
                          <span className="inline-flex w-16 items-center gap-1 text-muted-foreground">{s.Icon && <s.Icon className="h-3.5 w-3.5" aria-hidden="true" />}{s.text}</span>
                          <span className="min-w-0 flex-1 truncate text-foreground">{i.setup || "Без сетапа"}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{i.trader ? `${i.trader} · ` : ""}{timeAgoRu(i.createdAt)}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                <Link href={links.events(item.ticker)} className="text-primary hover:underline">События</Link>
                <Link href={links.offerings(item.ticker)} className="text-primary hover:underline">Офферинги</Link>
              </div>
            </Section>

            {/* NewsFeed renders its own «Новости TICKER» header */}
            <section className="glass-panel rounded-2xl p-[var(--panel-p)]" aria-label={`Новости ${item.ticker}`}>
              <React.Suspense fallback={<div className="space-y-2"><Skeleton className="h-12 w-full rounded-xl" /><Skeleton className="h-12 w-full rounded-xl" /></div>}>
                <LazyNewsFeed ticker={item.ticker} limit={8} compact />
              </React.Suspense>
            </section>

            {item.score != null && (
              <details className="glass-panel group rounded-2xl p-[var(--panel-p)]">
                <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-foreground">
                  <Gauge className="h-4 w-4 text-muted-foreground" aria-hidden="true" />Score {item.score}/100
                  <span className="ml-auto text-xs font-normal text-muted-foreground group-open:hidden">показать разбор</span>
                </summary>
                <div className="mt-3"><ScoreBreakdown raw={item.scoreBreakdown} scoredAt={item.scoredAt} /></div>
              </details>
            )}

            {item.screenshotUrl && (
              <section className="glass-panel rounded-2xl p-[var(--panel-p)]">
                <ScreenshotDisplay urls={item.screenshotUrl} />
              </section>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
