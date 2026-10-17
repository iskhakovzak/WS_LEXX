import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Sunrise,
  RefreshCw,
  Zap,
  Brain,
  Copy,
  Check,
  Globe2,
  TrendingUp,
  TrendingDown,
  CalendarDays,
  Newspaper,
  Activity,
  ChevronRight,
} from "lucide-react";
import { useMarketBrief, type MarketBrief } from "@/lib/market-intel";
import { ApiError, http } from "@/lib/api/http";
import { Segmented, Pill, EmptyState, type Tone } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  WidgetShell,
  IconAction,
  WidgetError,
  SkeletonTiles,
  relTime,
  nySession,
  useNow,
  useStoredState,
  num,
} from "@/components/widgets/widget-kit";
import { fmtDate, fmtPct, fmtPrice } from "@/lib/format";

/** 9:25–10:30 ET weekdays: the brief opens itself automatically. */
function isMarketOpenWindow(now = new Date()): boolean {
  const s = nySession(now);
  if (s.key === "weekend") return false;
  const [h, m] = s.hhmm.split(":").map(Number);
  const t = h * 60 + m;
  return t >= 9 * 60 + 25 && t <= 10 * 60 + 30;
}

/** Premarket = 4:00–9:35 ET weekdays (live quotes auto-refresh). */
function isPremarketWindow(now = new Date()): boolean {
  const s = nySession(now);
  if (s.key === "weekend") return false;
  const [h, m] = s.hhmm.split(":").map(Number);
  const t = h * 60 + m;
  return t >= 4 * 60 && t <= 9 * 60 + 35;
}

type Quotes = Pick<MarketBrief, "futures" | "overnight" | "macro" | "premarketMovers" | "gapLeaders"> & { quotesAt: string };

type Tab = "markets" | "movers" | "calendar" | "news";
const TABS = ["markets", "movers", "calendar", "news"] as const;

const pctTone = (v: unknown): Tone => {
  const n = num(v);
  return n == null || n === 0 ? "neutral" : n > 0 ? "up" : "down";
};
const pctClass = (v: unknown) => {
  const t = pctTone(v);
  return t === "up" ? "text-up" : t === "down" ? "text-down" : "text-muted-foreground";
};

/** Rule-based risk-on/off read from futures, VIX, DXY and overnight markets. */
function riskSentiment(b: MarketBrief, premarket: boolean): { tone: Tone; label: string; factors: string[] } {
  const factors: string[] = [];
  let score = 0;
  const fut = b.futures
    .map((f) => num(premarket && f.preMarketChangePct != null ? f.preMarketChangePct : f.changePct))
    .filter((x): x is number => x != null);
  if (fut.length) {
    const avg = fut.reduce((a, c) => a + c, 0) / fut.length;
    if (avg > 0.2) { score++; factors.push(`Фьючерсы растут (${fmtPct(avg)})`); }
    else if (avg < -0.2) { score--; factors.push(`Фьючерсы падают (${fmtPct(avg)})`); }
  }
  const vix = b.macro?.find((m) => m.name === "VIX");
  const vixCh = num(vix?.changePct);
  if (vixCh != null) {
    if (vixCh > 3) { score--; factors.push(`VIX растёт (${fmtPct(vixCh, 1)})`); }
    else if (vixCh < -3) { score++; factors.push(`VIX снижается (${fmtPct(vixCh, 1)})`); }
  }
  const dxy = num(b.macro?.find((m) => m.name === "DXY")?.changePct);
  if (dxy != null) {
    if (dxy > 0.3) { score--; factors.push(`Доллар крепнет (${fmtPct(dxy)})`); }
    else if (dxy < -0.3) { score++; factors.push(`Доллар слабеет (${fmtPct(dxy)})`); }
  }
  const ov = (b.overnight ?? []).map((o) => num(o.changePct)).filter((x): x is number => x != null);
  if (ov.length) {
    const avg = ov.reduce((a, c) => a + c, 0) / ov.length;
    if (avg > 0.3) { score++; factors.push(`Азия/Европа в плюсе (${fmtPct(avg)})`); }
    else if (avg < -0.3) { score--; factors.push(`Азия/Европа в минусе (${fmtPct(avg)})`); }
  }
  if (score >= 2) return { tone: "up", label: "Risk-on", factors };
  if (score <= -2) return { tone: "down", label: "Risk-off", factors };
  return { tone: "neutral", label: "Нейтрально", factors: factors.length ? factors : ["Сильных сигналов нет"] };
}

function Section({ title, icon: Icon, meta, children, className }: { title: string; icon?: typeof Globe2; meta?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
          {title}
        </h3>
        {meta && <span className="text-2xs text-muted-foreground tabular-nums">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

function QuoteTile({ name, main, mainClass, sub, sub2, highlight }: { name: string; main: string; mainClass?: string; sub?: React.ReactNode; sub2?: React.ReactNode; highlight?: boolean }) {
  return (
    <div className={cn("min-w-0 rounded-xl bg-foreground/[0.04] px-3 py-2", highlight && "ring-1 ring-[hsl(var(--chart-3)/0.45)]")}>
      <div className="truncate text-2xs text-muted-foreground">{name}</div>
      <div className={cn("text-base font-semibold tabular-nums leading-tight", mainClass)}>{main}</div>
      {sub && <div className="truncate text-2xs tabular-nums">{sub}</div>}
      {sub2 && <div className="truncate text-2xs tabular-nums text-muted-foreground">{sub2}</div>}
    </div>
  );
}

function MoverRow({ ticker, pct, sector, catalyst, price }: { ticker: string; pct: number | null; sector?: string | null; catalyst?: string | null; price?: number | null }) {
  const up = (pct ?? 0) >= 0;
  return (
    <li className="flex items-center gap-2 py-1.5">
      <span
        className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full", up ? "bg-up/15 text-up" : "bg-down/15 text-down")}
        aria-hidden="true"
      >
        {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
      </span>
      <span className="w-14 shrink-0 text-sm font-semibold">{ticker}</span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={catalyst ?? undefined}>
        {[sector, catalyst].filter(Boolean).join(" · ") || "—"}
      </span>
      {price != null && <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">{fmtPrice(price)}</span>}
      <span className={cn("w-16 shrink-0 text-right text-sm font-semibold tabular-nums", pctClass(pct))}>{fmtPct(pct)}</span>
    </li>
  );
}

const EVENT_TYPE_RU: Record<string, string> = {
  holiday: "Праздник",
  early_close: "Сокр. день",
  fomc: "FOMC",
  cpi: "CPI",
  ppi: "PPI",
  nfp: "NFP",
  opex: "OPEX",
  gdp: "GDP",
  macro: "Макро",
  earnings: "Отчёты",
};

function CopyButton({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <IconAction
      icon={ok ? Check : Copy}
      label={ok ? "Скопировано" : "Скопировать сводку"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setOk(true);
          setTimeout(() => setOk(false), 1500);
        } catch {
          /* clipboard blocked */
        }
      }}
    />
  );
}

export function MarketOpenBrief({ alwaysShow = false }: { alwaysShow?: boolean }) {
  const now = useNow(30_000);
  const [forceShow, setForceShow] = useState<boolean>(alwaysShow);
  const [tab, setTab] = useStoredState<Tab>("market_brief_tab", "markets", TABS);

  const visible = alwaysShow || forceShow || isMarketOpenWindow(new Date(now));
  const { data, isLoading, isError, refetch, isFetching } = useMarketBrief({ enabled: visible });

  const [quotes, setQuotes] = useState<Quotes | null>(null);
  const [quotesFetching, setQuotesFetching] = useState(false);
  const [quotesError, setQuotesError] = useState<string | null>(null);
  const [nextRefresh, setNextRefresh] = useState(60);
  const premarket = isPremarketWindow(new Date(now));
  const session = nySession(new Date(now));

  // Live quotes only (no AI rebuild) — the old "now" button forced a full brief + AI summary.
  const fetchQuotes = useCallback(async () => {
    setQuotesFetching(true);
    setNextRefresh(60);
    try {
      setQuotes(await http.get<Quotes>("/api/market-brief/quotes"));
      setQuotesError(null);
    } catch (e) {
      setQuotesError(e instanceof ApiError && !e.isNetwork ? `Котировки недоступны (HTTP ${e.status})` : "Котировки недоступны — ошибка сети");
    } finally {
      setQuotesFetching(false);
    }
  }, []);

  // Auto-refresh quotes every 60s during premarket.
  useEffect(() => {
    if (!visible || !premarket) return;
    fetchQuotes();
    const interval = setInterval(fetchQuotes, 60_000);
    return () => clearInterval(interval);
  }, [visible, premarket, fetchQuotes]);

  // Countdown to the next auto-refresh.
  useEffect(() => {
    if (!quotes || !premarket) return;
    const t = setInterval(() => setNextRefresh((n) => (n > 0 ? n - 1 : 60)), 1_000);
    return () => clearInterval(t);
  }, [quotes, premarket]);

  const brief: MarketBrief | null = useMemo(() => {
    if (!data) return null;
    return quotes ? { ...data, ...quotes } : data;
  }, [data, quotes]);

  const sentiment = useMemo(() => (brief ? riskSentiment(brief, premarket) : null), [brief, premarket]);

  /* ───────── Outside the open window: compact teaser ───────── */
  if (!visible) {
    return (
      <div className="glass-panel flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/12 text-primary">
          <Sunrise className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 basis-56">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            Бриф открытия
            <Pill tone={session.tone} dot>
              {session.label} · NY {session.hhmm}
            </Pill>
          </div>
          <div className="text-xs text-muted-foreground">Откроется сам в 9:25–10:30 NY: фьючерсы, макро, движения вотчлиста, календарь и новости.</div>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setForceShow(true)}>
          Показать сейчас
        </Button>
      </div>
    );
  }

  const counts = {
    movers: (brief?.premarketMovers?.length ?? 0) + (brief?.gapLeaders?.length ?? 0),
    calendar: (brief?.earningsToday?.length ?? 0) + (brief?.economicEvents?.length ?? 0),
    news: brief?.topNews?.length ?? 0,
  };
  const builtAt = brief?.fetchedAt ?? brief?.generatedAt ?? null;
  const stale = !!(brief as (MarketBrief & { stale?: boolean }) | null)?.stale;

  return (
    <WidgetShell
      icon={Sunrise}
      title="Бриф открытия"
      meta={brief?.date ? fmtDate(brief.date.slice(0, 10), "weekdayDayMonth") : undefined}
      actions={
        <>
          <IconAction
            icon={Zap}
            label="Обновить котировки сейчас"
            active={!!quotes}
            disabled={quotesFetching}
            onClick={fetchQuotes}
            className={quotesFetching ? "motion-safe:animate-pulse" : undefined}
          />
          <IconAction
            icon={RefreshCw}
            label="Обновить бриф"
            spinning={isFetching}
            disabled={isFetching}
            onClick={() => {
              setQuotes(null);
              setQuotesError(null);
              refetch();
            }}
          />
          {!alwaysShow && !isMarketOpenWindow(new Date(now)) && (
            <Button size="sm" variant="ghost" onClick={() => setForceShow(false)}>
              Скрыть
            </Button>
          )}
        </>
      }
    >
      {/* Status line: session, timestamps, live */}
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        <Pill tone={session.tone} dot>
          {session.label} · NY {session.hhmm}
        </Pill>
        {builtAt && (
          <span className="tabular-nums" title={fmtDate(builtAt, "shortDateTime")}>
            Бриф собран {fmtDate(builtAt, "time")} · {relTime(builtAt, now)}
          </span>
        )}
        {stale && <Pill tone="warn">Устаревшие данные</Pill>}
        {quotes && (
          <span className="flex items-center gap-1 tabular-nums text-up">
            <Activity className="h-3 w-3 motion-safe:animate-pulse" aria-hidden="true" />
            Котировки {fmtDate(quotes.quotesAt, "time")}
            {premarket && <span className="text-muted-foreground">· обновление через {nextRefresh} с</span>}
          </span>
        )}
      </div>

      {quotesError && <WidgetError message={quotesError} className="mb-3" />}

      {isLoading && !brief ? (
        <div className="space-y-3" aria-busy="true" aria-label="Собираем бриф">
          <Skeleton className="h-16 w-full rounded-xl" />
          <SkeletonTiles count={4} />
        </div>
      ) : isError && !brief ? (
        <WidgetError message="Не удалось собрать бриф открытия" onRetry={() => refetch()} />
      ) : brief ? (
        <div className="space-y-4">
          {/* Headline: sentiment + AI summary */}
          <div className="grid gap-3 lg:grid-cols-[13rem_minmax(0,1fr)]">
            {sentiment && (
              <div className="rounded-xl bg-foreground/[0.04] px-3 py-2.5">
                <div className="text-2xs text-muted-foreground">Настроение рынка</div>
                <div className={cn("text-lg font-semibold", sentiment.tone === "up" ? "text-up" : sentiment.tone === "down" ? "text-down" : "text-foreground")}>
                  {sentiment.label}
                </div>
                <ul className="mt-1 space-y-0.5 text-2xs text-muted-foreground">
                  {sentiment.factors.slice(0, 4).map((f) => (
                    <li key={f}>· {f}</li>
                  ))}
                </ul>
              </div>
            )}
            {brief.aiSummary ? (
              <div className="relative rounded-xl bg-primary/[0.07] px-3 py-2.5">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-primary">
                    <Brain className="h-3.5 w-3.5" aria-hidden="true" /> Коротко главное за ночь
                  </span>
                  <CopyButton text={brief.aiSummary} />
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{brief.aiSummary}</p>
              </div>
            ) : (
              <div className="flex items-center rounded-xl bg-foreground/[0.04] px-3 py-2.5 text-sm text-muted-foreground">
                AI-сводка пока не готова — данные ниже актуальны.
              </div>
            )}
          </div>

          <Segmented<Tab>
            ariaLabel="Раздел брифа"
            size="sm"
            value={tab}
            onChange={setTab}
            options={[
              { value: "markets", label: "Рынки" },
              { value: "movers", label: "Движения", count: counts.movers || undefined },
              { value: "calendar", label: "Календарь", count: counts.calendar || undefined },
              { value: "news", label: "Новости", count: counts.news || undefined },
            ]}
          />

          {tab === "markets" && (
            <div className="space-y-4">
              {brief.futures?.length > 0 && (
                <Section title="Фьючерсы США" meta={premarket ? "день · премаркет к закрытию" : "изменение за сессию"}>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {brief.futures.map((f) => {
                      const pm = premarket ? f.preMarketChangePct : null;
                      return (
                        <QuoteTile
                          key={f.symbol}
                          name={f.name}
                          main={fmtPct(f.changePct)}
                          mainClass={pctClass(f.changePct)}
                          sub={pm != null ? <span className={pctClass(pm)}>Премаркет {fmtPct(pm)}</span> : undefined}
                          sub2={fmtPrice(premarket && f.preMarketPrice != null ? f.preMarketPrice : f.price)}
                          highlight={pm != null}
                        />
                      );
                    })}
                  </div>
                </Section>
              )}
              {(brief.macro?.length ?? 0) > 0 && (
                <Section title="Макро · волатильность, доллар, ставки, сырьё">
                  <div className="grid grid-cols-3 gap-2 lg:grid-cols-6">
                    {brief.macro!.map((m) => (
                      <QuoteTile
                        key={m.symbol}
                        name={m.name}
                        main={fmtPrice(m.price)}
                        sub={<span className={pctClass(m.changePct)}>{fmtPct(m.changePct)}</span>}
                      />
                    ))}
                  </div>
                </Section>
              )}
              {(brief.overnight?.length ?? 0) > 0 && (
                <Section title="Ночная сессия · Азия и Европа" icon={Globe2}>
                  <ul className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                    {brief.overnight!.map((o) => (
                      <li key={o.symbol} className="flex items-center justify-between gap-2 border-b border-border/40 py-1.5 text-sm last:border-0">
                        <span className="min-w-0 truncate">
                          {o.name} <span className="text-2xs text-muted-foreground">{o.region === "Asia" ? "Азия" : o.region === "Europe" ? "Европа" : o.region}</span>
                        </span>
                        <span className={cn("font-medium tabular-nums", pctClass(o.changePct))}>{fmtPct(o.changePct)}</span>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
              {(brief.sectorRotation?.length ?? 0) > 0 && (
                <Section title="Ротация секторов">
                  <div className="flex flex-wrap gap-1.5">
                    {brief.sectorRotation.slice(0, 3).map((s) => (
                      <Pill key={s.symbol} tone="up">{s.symbol} {fmtPct(s.changePct, 1)}</Pill>
                    ))}
                    {brief.sectorRotation.length > 3 &&
                      brief.sectorRotation.slice(-3).map((s) => (
                        <Pill key={s.symbol} tone="down">{s.symbol} {fmtPct(s.changePct, 1)}</Pill>
                      ))}
                  </div>
                </Section>
              )}
            </div>
          )}

          {tab === "movers" && (
            <div className="space-y-4">
              <Section title="Премаркет · вотчлист" meta={brief.premarketMovers?.length ? `${brief.premarketMovers.length} тикеров` : undefined}>
                {brief.premarketMovers?.length ? (
                  <ul className="divide-y divide-border/40">
                    {brief.premarketMovers.map((p) => (
                      <MoverRow key={p.ticker} ticker={p.ticker} pct={p.preMarketPct} sector={p.sector} catalyst={p.catalyst} price={p.preMarketPrice} />
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">Нет движений больше 0.5% в премаркете.</p>
                )}
              </Section>
              <Section title="Гэпы · вотчлист" meta={brief.gapLeaders?.length ? `${brief.gapLeaders.length} тикеров` : undefined}>
                {brief.gapLeaders?.length ? (
                  <ul className="divide-y divide-border/40">
                    {brief.gapLeaders.map((g) => (
                      <MoverRow key={g.ticker} ticker={g.ticker} pct={g.gapPct} sector={g.sector} catalyst={g.catalyst} price={g.price} />
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">Гэпов больше 1% в вотчлисте нет.</p>
                )}
              </Section>
              <Link href="/watchlist" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                Открыть вотчлист <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
          )}

          {tab === "calendar" && (
            <div className="space-y-4">
              <Section title="Отчёты сегодня" meta={brief.earningsToday?.length ? `${brief.earningsToday.length}` : undefined}>
                {brief.earningsToday?.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {brief.earningsToday.map((e, i) => (
                      <span key={`${e.ticker}-${i}`} title={e.headline ?? undefined}>
                        <Pill tone="accent">{e.ticker}</Pill>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Отчётов на сегодня нет.</p>
                )}
              </Section>
              <Section title="Макрособытия · 7 дней" icon={CalendarDays}>
                {brief.economicEvents?.length ? (
                  <ul className="divide-y divide-border/40">
                    {brief.economicEvents.slice(0, 10).map((e) => {
                      const isToday = e.date?.slice(0, 10) === brief.date;
                      return (
                        <li key={e.id} className="flex items-center gap-2 py-1.5 text-sm">
                          <span className={cn("w-24 shrink-0 text-xs tabular-nums", isToday ? "font-semibold text-primary" : "text-muted-foreground")}>
                            {isToday ? "Сегодня" : fmtDate(e.date.slice(0, 10), "weekdayDayMonth")}
                          </span>
                          <span className="min-w-0 flex-1 truncate" title={e.description ?? undefined}>{e.name}</span>
                          <Pill tone={e.importance === "high" ? "down" : e.importance === "medium" ? "warn" : "neutral"}>
                            {EVENT_TYPE_RU[e.type] ?? e.type}
                          </Pill>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">Значимых событий на неделе нет.</p>
                )}
              </Section>
              <Link href="/events" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                Все события <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
          )}

          {tab === "news" && (
            <div className="space-y-4">
              <Section title={`Что важно · ${(brief.lookback?.label || "за последний день").replace(/^За/, "за")}`} icon={Newspaper}>
                {brief.topNews?.length ? (
                  <ul className="divide-y divide-border/40">
                    {brief.topNews.map((n, i) => {
                      const mv = num(n.percent_move);
                      return (
                        <li key={i} className="flex items-start gap-2 py-1.5">
                          <span className="w-14 shrink-0 text-sm font-semibold">{n.ticker}</span>
                          <span className="min-w-0 flex-1 text-sm leading-snug text-foreground/90">{n.headline}</span>
                          <span className="shrink-0 text-right">
                            {mv != null && <span className={cn("block text-sm font-semibold tabular-nums", pctClass(mv))}>{fmtPct(mv)}</span>}
                            <span className="block text-2xs tabular-nums text-muted-foreground">{(n.date || "").slice(5, 10).split("-").reverse().join(".")}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">Новостей за период нет.</p>
                )}
              </Section>
              {brief.yesterdayThemes?.what_works_now && (
                <Section title={`Что работало · ${(brief.lookback?.label || "вчера").replace(/^За/, "за")}`}>
                  <p className="text-sm leading-relaxed text-foreground/90">{brief.yesterdayThemes.what_works_now}</p>
                  {brief.yesterdayThemes.best_tickers && (
                    <div className="flex flex-wrap gap-1.5">
                      {brief.yesterdayThemes.best_tickers
                        .split(/[,\s]+/)
                        .filter(Boolean)
                        .slice(0, 12)
                        .map((t) => (
                          <Pill key={t} tone="up">{t}</Pill>
                        ))}
                    </div>
                  )}
                </Section>
              )}
            </div>
          )}
        </div>
      ) : (
        <EmptyState icon={Sunrise} title="Бриф пока пуст" description="Данные появятся после первой сборки брифа." className="py-6" />
      )}
    </WidgetShell>
  );
}
