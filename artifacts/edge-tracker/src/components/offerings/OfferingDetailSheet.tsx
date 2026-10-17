import { lazy, Suspense, useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import {
  AlertTriangle, CalendarPlus, Check, ExternalLink, FileText, History, Lightbulb, LineChart, Star, UserCheck, Wallet,
} from "lucide-react";
import { Pill, TermTooltip, toneText } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/contexts/auth-context";
import { links } from "@/lib/links";
import { isDecided, netPnl, resultOf } from "@/lib/trade-math";
import { safeHttpUrl } from "@/lib/url";
import { cn } from "@/lib/utils";
import { DealTypePill, ExposureBadge, OfferGauge, ScoreBreakdown, SignedPct, pctTone } from "./bits";
import { BuySellBar } from "./InsiderPanel";
import {
  DEAL_TYPE_HINT, SCORE_LEVEL_LABEL, SCORE_LEVEL_TONE, advMultiple, cleanUnderwriter, dealTypeOf, dilutionScore, discountOf, pctOfFloat,
} from "./score";
import { isMissingEndpoint, useMyTickerTrades, useTickerDetail, useTickerHistory } from "./use-offerings-data";
import {
  HORIZON_LABEL, fmtDay, fmtM, fmtPctCap, pctOfMcap,
  type Exposure, type HistoryEvent, type InsiderTxn, type Offering, type TimelineKind,
} from "./types";
import { fmtCompact, fmtPrice, fmtUsd, pluralRu } from "@/lib/format";

// The chart engine is heavy (lightweight-charts + primitives): load it only when a sheet opens.
const WsChart = lazy(() => import("@/components/chart-engine").then((m) => ({ default: m.WsChart })));

const TXN_LABEL: Record<string, string> = { P: "Покупка", S: "Продажа", A: "Грант", M: "Исполнение опц.", F: "Налог", G: "Подарок" };

const TXNS_COLLAPSED = 6;

function InsiderTxns({ txns }: { txns: InsiderTxn[] }) {
  const [all, setAll] = useState(false);
  const rows = all ? txns : txns.slice(0, TXNS_COLLAPSED);
  return (
    <>
      <ul className="divide-y divide-border/50 rounded-xl bg-[var(--glass-bg)]">
        {rows.map((t, i) => (
          <li key={`${t.url}-${i}`} className="flex items-center gap-3 px-3 py-1.5 text-sm">
            <span className="w-14 shrink-0 tabular-nums text-muted-foreground">{fmtDay(t.date)}</span>
            <Pill tone={t.code === "P" ? "up" : t.code === "S" ? "down" : "neutral"} className="px-1.5 text-2xs">{TXN_LABEL[t.code] ?? t.code}</Pill>
            <span className="min-w-0 flex-1 truncate" title={t.title ? `${t.owner} · ${t.title}` : t.owner}>{t.owner}{t.title && <span className="text-muted-foreground"> · {t.title}</span>}</span>
            <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">{t.usd != null ? fmtUsd(t.usd, { compact: true }) : fmtCompact(t.shares)}</span>
          </li>
        ))}
      </ul>
      {txns.length > TXNS_COLLAPSED && (
        <button type="button" className="self-start text-xs text-primary hover:underline" onClick={() => setAll((v) => !v)}>
          {all ? "Свернуть" : `Показать все ${txns.length}`}
        </button>
      )}
    </>
  );
}
const KIND_TEXT: Record<TimelineKind, string> = { priced: "Сделка", atm: "ATM", shelf: "Шелф", s1: "S-1", effect: "EFFECT" };
const KIND_TONE: Record<TimelineKind, "purple" | "warn" | "neutral" | "accent"> = { priced: "purple", atm: "warn", shelf: "neutral", s1: "accent", effect: "neutral" };
const SESSION_SHORT = { pre: "до рынка", rth: "в сессию", post: "после закр." } as const;

function Section({ title, icon: Icon, children, aside }: { title: string; icon?: typeof FileText; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {aside && <div className="ml-auto text-xs text-muted-foreground">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

function Num({ label, value, tone, title }: { label: ReactNode; value: ReactNode; tone?: string; title?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-[var(--glass-bg)] px-3 py-2" title={title}>
      <div className="truncate text-2xs text-muted-foreground">{label}</div>
      <div className={cn("truncate text-sm font-semibold tabular-nums text-foreground", tone)}>{value}</div>
    </div>
  );
}

function ReactionTable({ events }: { events: HistoryEvent[] }) {
  const [all, setAll] = useState(false);
  const rows = all ? events : events.slice(0, 10);
  return (
    <>
      <div className="overflow-x-auto rounded-xl bg-[var(--glass-bg)]">
        <table className="w-full min-w-[520px] text-xs tabular-nums">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">Дата</th>
              <th className="px-2 py-2 font-medium">Событие</th>
              <th className="px-2 py-2 text-right font-medium" title="Открытие к закрытию предыдущего дня">Гэп</th>
              <th className="px-2 py-2 text-right font-medium" title="Открытие → закрытие">О→З</th>
              <th className="px-2 py-2 text-right font-medium" title="Минимум дня от открытия">Мин.</th>
              <th className="px-2 py-2 text-right font-medium" title="Следующий день, закрытие к закрытию">След.</th>
              <th className="px-2 py-2"><span className="sr-only">Ссылка</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {rows.map((e, i) => {
              const u = safeHttpUrl(e.url);
              const r = e.reaction;
              return (
                <tr key={`${e.form}-${e.filingDate}-${i}`} className={cn(!r && e.kind !== "priced" && "text-muted-foreground")}>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    {fmtDay(e.reactionDay ?? e.filingDate, { day: "numeric", month: "short", year: "2-digit" })}
                    {e.session && <span className="ml-1 text-2xs text-muted-foreground">{SESSION_SHORT[e.session]}</span>}
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="inline-flex items-center gap-1.5">
                      <Pill tone={KIND_TONE[e.kind]} className="px-1.5 text-2xs">{KIND_TEXT[e.kind]}</Pill>
                      <span className="text-2xs text-muted-foreground">{e.form}</span>
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right">{r ? <SignedPct value={r.gapPct} /> : ""}</td>
                  <td className="px-2 py-1.5 text-right">{r ? <SignedPct value={r.o2cPct} /> : ""}</td>
                  <td className="px-2 py-1.5 text-right">{r ? <SignedPct value={r.lowFromOpenPct} /> : ""}</td>
                  <td className="px-2 py-1.5 text-right">{r ? <SignedPct value={r.nextDayPct} /> : ""}</td>
                  <td className="px-2 py-1.5 text-right">
                    {u && (
                      <a href={u} target="_blank" rel="noreferrer noopener" className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-[var(--glass-hover-bg)] hover:text-foreground" aria-label={`Открыть ${e.form} от ${e.filingDate}`}>
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {events.length > 10 && (
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setAll((v) => !v)}>
          {all ? "Свернуть" : `Показать все ${events.length}`}
        </Button>
      )}
    </>
  );
}

export function OfferingDetailSheet({
  offering,
  exposure,
  onClose,
  onAddWatch,
  watchPending,
  onAddPlan,
  planPending,
  planDate,
}: {
  offering: Offering | null;
  exposure: Exposure | undefined;
  onClose: () => void;
  onAddWatch: (o: Offering) => void;
  watchPending: boolean;
  onAddPlan: (o: Offering) => void;
  planPending: boolean;
  planDate: string;
}) {
  const o = offering;
  const { user } = useAuth();
  const ticker = o?.ticker ?? null;
  const history = useTickerHistory(ticker);
  const detail = useTickerDetail(ticker);
  const myTrades = useMyTickerTrades(ticker, user?.traderName ?? null);
  const h = history.data;
  const d = detail.data;
  const ins = d?.insiders ?? null;
  const fund = h?.fundamentals ?? null;
  const merged: Offering | null = useMemo(() => {
    if (!o) return null;
    if (!fund) return o;
    // History brings fundamentals for names the day payload did not enrich.
    return {
      ...o,
      floatShares: o.floatShares ?? fund.floatShares,
      cashM: o.cashM ?? fund.cashM,
      burnM: o.burnM ?? fund.burnM,
      runwayMonths: o.runwayMonths ?? fund.runwayMonths,
      shortPctFloat: o.shortPctFloat ?? fund.shortPctFloat,
      priorOfferings12m: o.priorOfferings12m ?? (h ? Math.max(0, h.stats.priced12m - (dealTypeOf(o) === "spo" || dealTypeOf(o) === "direct" ? 1 : 0)) : null),
    };
  }, [o, fund, h]);
  const s = merged && !merged.stub ? dilutionScore(merged) : null;
  const sec = safeHttpUrl(o?.filingUrl ?? null);
  const edgar = safeHttpUrl(d?.edgarUrl ?? null);
  const watched = !!exposure?.watched;
  const chartDay = o ? (o.reactionDate ?? o.date) : null;

  // Timeline: new endpoint, else the older 12-month filings list.
  const events: HistoryEvent[] = useMemo(() => {
    if (h) return h.events;
    if (!d) return [];
    return d.filings.map((f) => ({
      form: f.form,
      kind: (/^424B/i.test(f.form) ? "priced" : /^(S-3|F-3)/i.test(f.form) ? "shelf" : /^(S-1|F-1)/i.test(f.form) ? "s1" : "effect") as TimelineKind,
      filingDate: f.date, acceptedAt: null, session: null, reactionDay: null, url: f.url, description: f.description, reaction: null,
    }));
  }, [h, d]);
  const offeringDays = useMemo(() => new Set(events.filter((e) => e.kind === "priced" && e.reactionDay).map((e) => e.reactionDay!)), [events]);

  const mine = useMemo(() => {
    const rows = myTrades.data ?? [];
    let net = 0, wins = 0, decided = 0, onDays = 0, onNet = 0;
    for (const t of rows) {
      const n = netPnl(t);
      if (n != null) net += n;
      if (isDecided(t)) { decided++; if (resultOf(t) === "win") wins++; }
      if (offeringDays.has(t.date)) { onDays++; if (n != null) onNet += n; }
    }
    return { rows, net, wr: decided ? Math.round((wins / decided) * 100) : null, onDays, onNet };
  }, [myTrades.data, offeringDays]);

  if (!o || !merged) return null;
  const pct = pctOfMcap(merged);
  const disc = discountOf(merged);
  const fl = pctOfFloat(merged);
  const adv = advMultiple(merged);
  const uw = cleanUnderwriter(o.underwriter);
  const type = dealTypeOf(o);

  return (
    <Sheet open={!!o} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl lg:max-w-3xl">
        <SheetHeader className="space-y-3 border-b border-border px-5 pb-4 pt-5 text-left">
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <SheetTitle className="text-2xl font-semibold tracking-tight">{o.ticker}</SheetTitle>
            {!o.stub && <DealTypePill o={o} />}
            {s && (
              <span className="inline-flex items-center gap-1">
                <Pill tone={SCORE_LEVEL_TONE[s.level]} dot>
                  {s.score} · {SCORE_LEVEL_LABEL[s.level].toLowerCase()}
                </Pill>
                <TermTooltip term="dilutionScore" icon />
              </span>
            )}
            <ExposureBadge e={exposure} />
          </div>
          <SheetDescription className="text-sm">
            {o.stub
              ? (h?.company ?? d?.company ?? "Профиль SEC: на выбранный день заявок нет")
              : <>
                  {o.company} · {o.form ?? type.toUpperCase()}
                  {o.acceptedAt ? ` · подана ${fmtDay(o.acceptedAt.slice(0, 10))} ${o.acceptedAt.slice(11, 16)} ET` : ` · ${fmtDay(o.date, "dayMonthLong")}`}
                  {o.reactionDate && o.reactionDate !== o.date ? ` · торгуется ${fmtDay(o.reactionDate, "weekdayDayMonth")}` : ""}
                </>}
          </SheetDescription>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={watched || watchPending} onClick={() => onAddWatch(o)}>
              {watched ? <Check aria-hidden="true" /> : <Star aria-hidden="true" />}
              {watched ? "В вотчлисте" : "В «Сегодня»"}
            </Button>
            <Button size="sm" variant="outline" disabled={planPending} onClick={() => onAddPlan(o)} title={`Мой план на ${fmtDay(planDate, "dayMonthLong")}`}>
              <CalendarPlus aria-hidden="true" /> В план дня
            </Button>
            <Button size="sm" asChild>
              <Link href={links.newIdea(o.ticker)}><Lightbulb aria-hidden="true" /> Создать идею</Link>
            </Button>
            {sec && (
              <Button size="sm" variant="ghost" asChild>
                <a href={sec} target="_blank" rel="noreferrer noopener"><FileText aria-hidden="true" /> {o.form && o.form !== "IPO" ? o.form : "Заявка"}</a>
              </Button>
            )}
            {edgar && (
              <Button size="sm" variant="ghost" asChild>
                <a href={edgar} target="_blank" rel="noreferrer noopener"><ExternalLink aria-hidden="true" /> EDGAR</a>
              </Button>
            )}
          </div>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {exposure && exposure.held.length > 0 && (
            <div role="alert" className="flex gap-3 rounded-xl bg-down/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-down" aria-hidden="true" />
              <div>
                <p className="font-medium text-foreground">Открытая позиция по {o.ticker}</p>
                <p className="text-muted-foreground">
                  {exposure.held.map((t) => [t.trader, t.side, HORIZON_LABEL[t.horizon ?? "intraday"], t.entry != null ? `вход ${fmtPrice(t.entry, { dollar: true })}` : null].filter(Boolean).join(" · ")).join("; ")}.
                  {" "}Оффер{o.offerPrice != null ? ` ${fmtPrice(o.offerPrice, { dollar: true })}` : ""} — вероятная цель гэпа: держите стоп и размер под это.
                </p>
              </div>
            </div>
          )}

          {!o.stub && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Num label={type === "shelf" ? <TermTooltip term="shelf">Ёмкость</TermTooltip> : "Размер"} value={fmtM(o.dealSizeM ?? o.shelfCapacityM)} />
              <Num label="% мкап" value={fmtPctCap(pct)} tone={pctTone(pct) === "down" ? "text-down" : undefined}
                title={pct != null && pct > 1000 ? "Больше 1000% — скорее всего устаревшее число акций" : undefined} />
              <Num label={fl != null ? "% флоута" : "К ср. объёму"} value={fl != null ? fmtPctCap(fl) : adv != null ? `${adv.toFixed(1)}×` : "—"} />
              <Num label={<TermTooltip term="offerDiscount" />} value={disc != null ? `${disc.toFixed(1)}%` : type === "atm" ? "по рынку" : "—"} tone={disc != null && disc <= -15 ? "text-down" : undefined} />
              <Num label="Оффер" value={fmtPrice(o.offerPrice, { dollar: true })} />
              <Num label="Закрытие до" value={fmtPrice(o.prevClose, { dollar: true })} />
              <Num label="Мкап" value={fmtM(o.marketCapM)} />
              <Num label="Флоут" value={fmtCompact(merged.floatShares)} />
              <Num label="Кэш" value={merged.cashM != null ? fmtM(merged.cashM) : "—"} />
              <Num label={<TermTooltip term="runway" />} value={merged.burnM === 0 ? "CF > 0" : merged.runwayMonths != null ? `${merged.runwayMonths.toFixed(merged.runwayMonths < 10 ? 1 : 0)} мес` : "—"}
                tone={merged.runwayMonths != null && merged.runwayMonths < 6 ? "text-down" : undefined} />
              <Num label="Шорт % флоута" value={merged.shortPctFloat != null ? `${merged.shortPctFloat.toFixed(1)}%` : "—"} />
              <Num label="Андеррайтер" value={<span title={uw ?? undefined}>{uw ?? "—"}</span>} />
            </div>
          )}

          {o.reaction && (
            <Section title={o.reaction.live ? "Реакция сегодня (день идёт)" : "Реакция в день сделки"} icon={LineChart}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Num label="Гэп" value={<SignedPct value={o.reaction.gapPct} />} />
                <Num label="Открытие → закрытие" value={<SignedPct value={o.reaction.o2cPct} />} />
                <Num label="Мин. от открытия" value={<SignedPct value={o.reaction.lowFromOpenPct} />} />
                <Num label="RelVol" value={o.reaction.relVol != null ? `${o.reaction.relVol.toFixed(1)}×` : "—"} />
              </div>
            </Section>
          )}

          {o.offerPrice != null && o.currentPrice != null && <OfferGauge o={o} />}

          {s && (
            <Section title="Из чего скор" icon={AlertTriangle} aside={<span className={toneText(SCORE_LEVEL_TONE[s.level])}>{s.score}/100</span>}>
              <p className="text-xs text-muted-foreground">{DEAL_TYPE_HINT[type]}</p>
              <ScoreBreakdown s={s} className="rounded-xl bg-[var(--glass-bg)] p-3" />
            </Section>
          )}

          {chartDay && (
            <Section title="График вокруг даты" icon={LineChart} aside={fmtDay(chartDay, "dayMonthLong")}>
              <div className="min-h-[340px] min-w-0">
                <Suspense fallback={<Skeleton className="h-[340px] w-full rounded-xl" />}>
                  <WsChart key={`${o.ticker}-${chartDay}`} trade={{ id: 0, ticker: o.ticker, date: chartDay }} executions={[]} initialTimeframe="5m" contextDays={1} height={340} />
                </Suspense>
              </div>
            </Section>
          )}

          <Section
            title="Размещения компании и реакция"
            icon={History}
            aside={h ? `3 года · SEC + дневные свечи` : d ? "12 мес · SEC" : undefined}
          >
            {history.isLoading || (isMissingEndpoint(history.error) && detail.isLoading) ? (
              <div className="space-y-2"><Skeleton className="h-8 w-full rounded-xl" /><Skeleton className="h-40 w-full rounded-xl" /></div>
            ) : events.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {(history.error && !isMissingEndpoint(history.error)) || detail.error
                  ? "SEC не ответил или тикера ещё нет в базе (до листинга)."
                  : "Заявок на выпуск акций за период нет."}
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {h ? (
                    <>
                      <Pill tone={h.stats.priced12m >= 3 ? "down" : h.stats.priced12m > 0 ? "warn" : "up"}>{h.stats.priced12m} {pluralRu(h.stats.priced12m, "сделка", "сделки", "сделок")} за 12 мес · {h.stats.priced36m} за 3 года</Pill>
                      {h.stats.atm12m > 0 && <Pill tone="warn"><TermTooltip term="atm" />: {h.stats.atm12m}</Pill>}
                      {h.stats.activeShelf && <Pill tone="warn">активный <TermTooltip term="shelf">шелф</TermTooltip> с {fmtDay(h.stats.lastShelfDate, { month: "short", year: "numeric" })}</Pill>}
                      {h.stats.wksi && <Pill tone="neutral" title="Крупный эмитент с автоматическим шелфом: 424B5 часто — облигации">WKSI</Pill>}
                    </>
                  ) : d && (
                    <>
                      <Pill tone={d.stats.offerings12m >= 3 ? "down" : d.stats.offerings12m > 0 ? "warn" : "up"}>{d.stats.offerings12m} размещ. за 12 мес</Pill>
                      {d.stats.activeShelf && <Pill tone="warn">активный <TermTooltip term="shelf">шелф</TermTooltip></Pill>}
                    </>
                  )}
                </div>
                {h && h.summary.n > 0 && (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Num label={`Средний гэп (${h.summary.n})`} value={<SignedPct value={h.summary.avgGap} />} />
                    <Num label="Среднее О→З" value={<SignedPct value={h.summary.avgO2c} />} />
                    <Num label="Закрылись ниже открытия" value={h.summary.redShare != null ? `${Math.round(h.summary.redShare * 100)}%` : "—"} />
                    <Num label="Следующий день" value={<SignedPct value={h.summary.avgNextDay} />} />
                  </div>
                )}
                {h && !h.barsOk && <p className="text-xs text-muted-foreground">Дневные свечи сейчас недоступны — реакция не посчитана.</p>}
                {!h && <p className="text-xs text-muted-foreground">Реакция по свечам появится после обновления сервера.</p>}
                <ReactionTable events={events} />
              </>
            )}
          </Section>

          <Section title="Мои сделки по тикеру" icon={Wallet} aside={mine.rows.length ? `${mine.rows.length} посл.` : undefined}>
            {myTrades.isLoading ? <Skeleton className="h-16 w-full rounded-xl" /> : myTrades.error ? (
              <p className="text-sm text-muted-foreground">Не удалось загрузить сделки.</p>
            ) : mine.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Сделок по {o.ticker} нет.</p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <Num label="Net" value={fmtUsd(mine.net, { signed: true, compact: true })} tone={mine.net > 0 ? "text-up" : mine.net < 0 ? "text-down" : undefined} />
                  <Num label="Win rate" value={mine.wr != null ? `${mine.wr}%` : "—"} />
                  <Num label="В дни размещений" value={mine.onDays ? `${mine.onDays} · ${fmtUsd(mine.onNet, { signed: true, compact: true })}` : "0"} />
                </div>
                <ul className="divide-y divide-border/50 rounded-xl bg-[var(--glass-bg)] text-sm">
                  {mine.rows.slice(0, 8).map((t) => {
                    const n = netPnl(t);
                    return (
                      <li key={t.id}>
                        <Link href={links.trade(t.id)} className="flex items-center gap-3 px-3 py-1.5 hover:bg-[var(--glass-hover-bg)]">
                          <span className="w-20 shrink-0 tabular-nums text-muted-foreground">{fmtDay(t.date, { day: "numeric", month: "short", year: "2-digit" })}</span>
                          <span className="text-xs text-muted-foreground">{t.side ?? ""}</span>
                          {offeringDays.has(t.date) && <Pill tone="purple" className="px-1.5 text-2xs">день сделки</Pill>}
                          <span className={cn("ml-auto tabular-nums", n == null ? "text-muted-foreground" : n >= 0 ? "text-up" : "text-down")}>{fmtUsd(n, { signed: true, compact: true })}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                {mine.rows.length > 8 && (
                  <Link href={links.trades({ ticker: o.ticker })} className="text-xs text-primary hover:underline">Все сделки по {o.ticker} →</Link>
                )}
              </>
            )}
          </Section>

          <Section title="Инсайдеры, 90 дней" icon={UserCheck} aside={ins && <span className={cn("text-sm font-semibold tabular-nums", ins.netUsd > 0 ? "text-up" : ins.netUsd < 0 ? "text-down" : "text-muted-foreground")}>{fmtUsd(ins.netUsd, { signed: true, compact: true })}</span>}>
            {detail.isLoading ? <Skeleton className="h-16 w-full rounded-xl" /> : !ins ? (
              <p className="text-sm text-muted-foreground">Нет данных Form 4.</p>
            ) : (
              <>
                <BuySellBar s={ins} />
                <div className="flex flex-wrap gap-x-4 text-xs tabular-nums text-muted-foreground">
                  <span className="text-up">Покупки: {ins.buys.count} · {fmtUsd(ins.buys.usd, { compact: true })} · {ins.buyers} чел.</span>
                  <span className="text-down">Продажи: {ins.sells.count} · {fmtUsd(ins.sells.usd, { compact: true })}</span>
                  {ins.planSellPct != null && <span>по плану 10b5-1: {ins.planSellPct}%</span>}
                </div>
                {ins.txns.length > 0 && <InsiderTxns txns={ins.txns} />}
              </>
            )}
          </Section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
