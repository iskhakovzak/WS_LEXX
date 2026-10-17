/**
 * Read-only memo sections of «Отчёт недели»: KPI bento with deltas, Mon–Fri bars,
 * horizon / setup breakdown, best & worst trades, mistakes & violations with $ cost,
 * discipline, risk events and the book carried into the weekend.
 */
import * as React from "react";
import type { CSSProperties } from "react";
import { Link } from "wouter";
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AlertTriangle, ArrowUpRight, BookMarked, CandlestickChart, CheckCircle2, ListChecks, MoonStar, NotebookPen, ShieldAlert, Trophy,
} from "lucide-react";
import { EmptyState, Panel, Pill, ProgressRing, StatCard, toneOf, type Tone } from "@/components/ds";
import { KPI_FORMULAS, type Horizon } from "@/lib/trade-math";
import { cn } from "@/lib/utils";
import {
  HORIZON_LABEL, fmtDay, fmtValue, weekdayShort,
  type GroupKpi, type Mistake, type OpenPosition, type RiskEvent, type TradeLite, type Violation, type WeeklyReview,
} from "./api";
import { fmtNum, fmtR, fmtRate, fmtUsd } from "@/lib/format";

const TOOLTIP_STYLE: CSSProperties = {
  backgroundColor: "hsl(var(--popover) / 0.92)",
  border: "1px solid hsl(var(--border))",
  color: "hsl(var(--popover-foreground))",
  borderRadius: 12,
  fontSize: 12,
  boxShadow: "0 8px 32px rgb(0 0 0 / 0.3)",
  backdropFilter: "blur(24px)",
  fontVariantNumeric: "tabular-nums",
};

const HORIZON_TONE: Record<Horizon, Tone> = { intraday: "neutral", overnight: "accent", swing: "purple" };

function tradeHref(id: number) {
  return `/trades?highlight=${id}`;
}

// ── KPI bento ────────────────────────────────────────────────────────────────
function deltaText(cur: number | null, prev: number | null, fmt: (d: number) => string): { text: string; tone: Tone } | null {
  if (cur == null || prev == null) return null;
  const d = cur - prev;
  return { text: `${d > 0 ? "+" : d < 0 ? "−" : ""}${fmt(Math.abs(d))}`, tone: toneOf(d) };
}

export function KpiBento({ kpis }: { kpis: WeeklyReview["kpis"] }) {
  const { current: k, previous: p, avg4, avg4Weeks } = kpis;
  const u = k.unit;
  const money = u === "usd";
  const avgHint = (v: string) => (avg4Weeks ? `4 нед: ${v}` : "4 нед: —");
  const pnlDelta = deltaText(k.netPnl, p.netPnl, (d) => fmtUsd(d, { decimals: "auto", compact: 10_000 }));
  const rDelta = deltaText(k.totalR, p.totalR, (d) => fmtR(d, { signed: false }));
  const wrDelta = deltaText(k.winRate, p.winRate, (d) => `${Math.round(d * 100)} п.п.`);
  const trDelta = deltaText(k.trades, p.trades, (d) => String(d));
  const expDelta = deltaText(k.expectancyR, p.expectancyR, (d) => fmtR(d, { signed: false }));
  const pfDelta = deltaText(k.profitFactorR, p.profitFactorR, (d) => d.toFixed(2));
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
      <StatCard
        className="col-span-2"
        label={money ? "P&L нетто" : "Результат, R"}
        value={money ? fmtUsd(k.netPnl, { signed: true, decimals: "auto" }) : fmtR(k.totalR)}
        tone={toneOf(money ? k.netPnl : k.totalR)}
        delta={money ? pnlDelta?.text : rDelta?.text}
        deltaTone={money ? pnlDelta?.tone : rDelta?.tone}
        hint={money ? avgHint(fmtUsd(avg4.netPnl, { signed: true, decimals: "auto", compact: 10_000 })) : avgHint(fmtR(avg4.totalR))}
      />
      <StatCard
        label={money ? "Сумма R" : "Ожидание"}
        value={money ? fmtR(k.totalR) : fmtR(k.expectancyR)}
        tone={toneOf(money ? k.totalR : k.expectancyR)}
        delta={money ? rDelta?.text : expDelta?.text}
        deltaTone={money ? rDelta?.tone : expDelta?.tone}
        hint={money ? avgHint(fmtR(avg4.totalR)) : avgHint(fmtR(avg4.expectancyR))}
      />
      <StatCard
        label="Win rate"
        value={fmtRate(k.winRate)}
        tone={k.winRate == null ? "neutral" : k.winRate >= 0.5 ? "up" : "down"}
        delta={wrDelta?.text}
        deltaTone={wrDelta?.tone}
        hint={<span title={KPI_FORMULAS.winRate}>{avgHint(fmtRate(avg4.winRate))}</span>}
      />
      <StatCard
        label="Profit factor"
        value={fmtNum(k.profitFactorR, { suffix: "×" })}
        tone={k.profitFactorR == null ? "neutral" : k.profitFactorR >= 1 ? "up" : "down"}
        delta={pfDelta?.text}
        deltaTone={pfDelta?.tone}
        hint={<span title={KPI_FORMULAS.profitFactorR}>{avgHint(fmtNum(avg4.profitFactorR, { suffix: "×" }))}</span>}
      />
      <StatCard
        label="Ожидание"
        value={money ? fmtR(k.expectancyR) : fmtR(k.expectancyR)}
        tone={toneOf(k.expectancyR)}
        delta={expDelta?.text}
        deltaTone={expDelta?.tone}
        hint={<span title={KPI_FORMULAS.expectancyR}>{money && k.expectancyUsd != null ? `${fmtUsd(k.expectancyUsd, { signed: true, decimals: "auto" })} / сделка` : avgHint(fmtR(avg4.expectancyR))}</span>}
      />
      <StatCard
        label="Сделки"
        value={String(k.trades)}
        delta={trDelta?.text}
        deltaTone="neutral"
        hint={`${k.wins}W · ${k.losses}L${k.be ? ` · ${k.be}BE` : ""}${k.open ? ` · ${k.open} откр.` : ""}`}
      />
      <StatCard
        label="Комиссии"
        value={fmtUsd(k.fees, { decimals: "auto" })}
        tone="neutral"
        hint={k.grossPnl != null ? `брутто ${fmtUsd(k.grossPnl, { signed: true, decimals: "auto", compact: 10_000 })}` : avgHint(fmtUsd(avg4.fees, { decimals: "auto" }))}
      />
      <StatCard
        label="Лучший / худший день"
        value={
          <span className="flex flex-wrap items-baseline gap-x-2 text-lg">
            <span className="text-up">{k.bestDay ? fmtValue(k.bestDay.value, u) : "—"}</span>
            <span className="text-down">{k.worstDay ? fmtValue(k.worstDay.value, u) : "—"}</span>
          </span>
        }
        hint={k.bestDay || k.worstDay ? `${k.bestDay ? weekdayShort(k.bestDay.date) : "—"} / ${k.worstDay ? weekdayShort(k.worstDay.date) : "—"} · ${k.greenDays} в плюс, ${k.redDays} в минус` : `торговых дней: ${k.tradingDays}`}
      />
    </div>
  );
}

// ── Mon–Fri bars ─────────────────────────────────────────────────────────────
export function WeekDaysChart({ doc }: { doc: WeeklyReview }) {
  const u = doc.kpis.current.unit;
  const data = doc.days.map((d) => ({ ...d, label: weekdayShort(d.date), value: u === "usd" ? d.net : d.r }));
  const any = data.some((d) => d.value != null);
  const fmt = (v: number) => fmtValue(v, u);
  return (
    <Panel title="По дням" description={u === "usd" ? "P&L нетто, Пн–Пт" : "Сумма R, Пн–Пт (без $ данных)"} icon={CandlestickChart} className="min-w-0">
      {!any ? (
        <EmptyState icon={CandlestickChart} title="Нет закрытых сделок на этой неделе" description="Бары появятся, когда сделки получат результат." className="py-8" />
      ) : (
        <div className="h-44 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
              <YAxis width={52} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(v: number) => (u === "usd" ? fmtUsd(v, { decimals: "auto", compact: 10_000 }) : fmtR(v, { signed: false }))} />
              <ReferenceLine y={0} stroke="hsl(var(--border))" />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                cursor={{ fill: "hsl(var(--muted-foreground) / 0.08)" }}
                labelFormatter={(_, pl) => (pl?.[0]?.payload?.date ? fmtDay(String(pl[0].payload.date), true) : "")}
                formatter={(v: number, _n, item) => [`${fmt(v)} · ${item?.payload?.trades ?? 0} сд. (${item?.payload?.wins ?? 0}W/${item?.payload?.losses ?? 0}L)`, u === "usd" ? "Нетто" : "R"]}
              />
              <Bar dataKey="value" radius={[6, 6, 2, 2]} isAnimationActive={false}>
                {data.map((d) => (
                  <Cell key={d.date} fill={d.value == null ? "transparent" : d.value >= 0 ? "hsl(var(--up))" : "hsl(var(--down))"} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="mt-2 grid grid-cols-5 gap-1 text-center text-2xs text-muted-foreground tabular-nums">
        {data.map((d) => (
          <span key={d.date} className={cn(d.trades === 0 && "opacity-60")}>{d.trades} сд.</span>
        ))}
      </div>
    </Panel>
  );
}

// ── Group lists (horizon / setup) ────────────────────────────────────────────
function GroupRow({ g, unit, label, pill, max }: { g: GroupKpi; unit: "usd" | "r"; label: React.ReactNode; pill?: React.ReactNode; max: number }) {
  const v = unit === "usd" ? g.netPnl : g.totalR;
  const width = max > 0 && v != null ? Math.min(100, (Math.abs(v) / max) * 100) : 0;
  return (
    <li className="flex items-center gap-3 py-1.5 text-sm">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate font-medium text-foreground">{label}</span>
          {pill}
          <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{g.trades} сд. · WR {fmtRate(g.winRate)}</span>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--glass-bg)]" aria-hidden="true">
          <div className={cn("h-full rounded-full", v != null && v < 0 ? "bg-down" : "bg-up")} style={{ width: `${width}%` }} />
        </div>
      </div>
      <span className={cn("w-20 shrink-0 text-right font-semibold tabular-nums", v == null ? "text-muted-foreground" : v > 0 ? "text-up" : v < 0 ? "text-down" : "text-foreground")}>
        {fmtValue(v, unit)}
      </span>
    </li>
  );
}

export function HorizonPanel({ doc }: { doc: WeeklyReview }) {
  const u = doc.kpis.current.unit;
  const rows = doc.byHorizon;
  const max = Math.max(0, ...rows.map((g) => Math.abs((u === "usd" ? g.netPnl : g.totalR) ?? 0)));
  return (
    <Panel title="По горизонту" description="Интрадей · овернайт · свинг" icon={MoonStar} className="min-w-0">
      {rows.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">Нет сделок.</p>
      ) : (
        <ul className="divide-y divide-border/50">
          {rows.map((g) => (
            <GroupRow key={g.key} g={g} unit={u} max={max} label={HORIZON_LABEL[g.key as Horizon] ?? g.key} pill={<Pill tone={HORIZON_TONE[g.key as Horizon] ?? "neutral"}>{fmtR(g.expectancyR)}</Pill>} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function SetupPanel({ doc }: { doc: WeeklyReview }) {
  const u = doc.kpis.current.unit;
  const rows = [...doc.bySetup].sort((a, b) => ((u === "usd" ? b.netPnl : b.totalR) ?? 0) - ((u === "usd" ? a.netPnl : a.totalR) ?? 0));
  const max = Math.max(0, ...rows.map((g) => Math.abs((u === "usd" ? g.netPnl : g.totalR) ?? 0)));
  const top = rows.slice(0, 3);
  const bottom = rows.length > 3 ? rows.slice(-3).reverse().filter((g) => !top.includes(g)) : [];
  const label = (g: GroupKpi) => (g.playbookId ? <Link href={`/playbook?open=${g.playbookId}`} className="hover:text-primary hover:underline">{g.key}</Link> : g.key);
  return (
    <Panel title="По сетапам" description={rows.length > 6 ? `топ-3 и худшие 3 из ${rows.length}` : "что работало, а что нет"} icon={BookMarked} className="min-w-0">
      {rows.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">Нет сделок с сетапом.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <ul className="divide-y divide-border/50">
            {top.map((g) => <GroupRow key={g.key} g={g} unit={u} max={max} label={label(g)} pill={<Pill tone={toneOf(g.expectancyR)}>{fmtR(g.expectancyR)}</Pill>} />)}
          </ul>
          {bottom.length > 0 && (
            <>
              <p className="micro-label">Худшие</p>
              <ul className="divide-y divide-border/50">
                {bottom.map((g) => <GroupRow key={g.key} g={g} unit={u} max={max} label={label(g)} pill={<Pill tone={toneOf(g.expectancyR)}>{fmtR(g.expectancyR)}</Pill>} />)}
              </ul>
            </>
          )}
        </div>
      )}
    </Panel>
  );
}

// ── Best / worst trades ──────────────────────────────────────────────────────
function TradeRow({ t, unit }: { t: TradeLite; unit: "usd" | "r" }) {
  const v = unit === "usd" ? t.net : t.r;
  return (
    <li>
      <Link href={tradeHref(t.id)} className="group flex items-center gap-3 rounded-xl px-2 py-2 text-sm transition-colors hover:bg-[var(--glass-bg)]">
        <span className="w-16 shrink-0 font-semibold text-foreground">{t.ticker}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {fmtDay(t.cdate)}{t.setup ? ` · ${t.setup}` : ""}{t.side ? ` · ${t.side}` : ""}
        </span>
        <Pill tone={HORIZON_TONE[t.horizon]} className="hidden sm:inline-flex">{HORIZON_LABEL[t.horizon]}</Pill>
        {unit === "usd" && t.r != null && <span className="hidden w-14 shrink-0 text-right text-xs text-muted-foreground tabular-nums sm:inline">{fmtR(t.r)}</span>}
        <span className={cn("w-20 shrink-0 text-right font-semibold tabular-nums", v == null ? "text-muted-foreground" : v >= 0 ? "text-up" : "text-down")}>{fmtValue(v, unit)}</span>
        <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
      </Link>
    </li>
  );
}

export function BestWorstPanel({ doc }: { doc: WeeklyReview }) {
  const u = doc.kpis.current.unit;
  const empty = doc.bestTrades.length === 0 && doc.worstTrades.length === 0;
  return (
    <Panel title="Лучшие и худшие сделки" description="три в плюс, три в минус — откройте, чтобы разобрать" icon={Trophy} className="min-w-0">
      {empty ? (
        <p className="py-4 text-sm text-muted-foreground">Нет закрытых сделок с результатом.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="micro-label mb-1 text-up">В плюс</p>
            {doc.bestTrades.length ? <ul className="-mx-2">{doc.bestTrades.map((t) => <TradeRow key={t.id} t={t} unit={u} />)}</ul> : <p className="px-2 py-2 text-sm text-muted-foreground">Нет прибыльных сделок.</p>}
          </div>
          <div>
            <p className="micro-label mb-1 text-down">В минус</p>
            {doc.worstTrades.length ? <ul className="-mx-2">{doc.worstTrades.map((t) => <TradeRow key={t.id} t={t} unit={u} />)}</ul> : <p className="px-2 py-2 text-sm text-muted-foreground">Нет убыточных сделок.</p>}
          </div>
        </div>
      )}
    </Panel>
  );
}

// ── Mistakes & violations ────────────────────────────────────────────────────
const SEVERITY_TONE: Record<string, Tone> = { low: "neutral", medium: "warn", high: "down", critical: "down" };

function CostLine({ label, cost }: { label: string; cost: WeeklyReview["mistakes"]["cost"] }) {
  if (!cost.trades) return null;
  return (
    <span className="text-xs text-muted-foreground">
      {label}: <span className="font-semibold text-down tabular-nums">{cost.usd != null ? fmtUsd(cost.usd, { decimals: "auto" }) : fmtR(cost.r)}</span>
      {cost.usd != null && cost.r != null && <span className="tabular-nums"> ({fmtR(cost.r)})</span>} · {cost.trades} сд.
    </span>
  );
}

function MistakeRow({ m }: { m: Mistake }) {
  const v = m.tradeNet ?? m.tradeR;
  return (
    <li className="flex items-start gap-3 py-2 text-sm">
      <Pill tone={SEVERITY_TONE[m.severity] ?? "neutral"} className="mt-0.5 shrink-0">{m.errorType}</Pill>
      <div className="min-w-0 flex-1">
        <p className="text-foreground">{m.description}</p>
        <p className="text-xs text-muted-foreground">
          {m.tradeId ? <Link href={tradeHref(m.tradeId)} className="hover:underline">{m.ticker ?? `#${m.tradeId}`}{m.tradeDate ? ` · ${fmtDay(m.tradeDate)}` : ""}</Link> : m.ticker ?? "без сделки"}
          {m.lesson ? ` · урок: ${m.lesson}` : ""}
        </p>
      </div>
      {v != null && <span className={cn("shrink-0 text-right font-semibold tabular-nums", v < 0 ? "text-down" : "text-up")}>{m.tradeNet != null ? fmtUsd(m.tradeNet, { signed: true, decimals: "auto" }) : fmtR(m.tradeR)}</span>}
    </li>
  );
}

function ViolationRow({ v }: { v: Violation }) {
  const val = v.tradeNet ?? v.tradeR;
  return (
    <li className="flex items-start gap-3 py-2 text-sm">
      <Pill tone={SEVERITY_TONE[v.severity] ?? "warn"} className="mt-0.5 shrink-0">{v.ruleName ?? v.ruleKind ?? "Правило"}</Pill>
      <div className="min-w-0 flex-1">
        <p className="text-foreground">{v.message}</p>
        <p className="text-xs text-muted-foreground">
          {v.archivedLabel && <Pill tone="neutral" className="mr-1.5 opacity-80" title="Нарушение сохранено с комментариями, в текущей статистике не учитывается">{v.archivedLabel}</Pill>}
          {v.tradeId ? <Link href={tradeHref(v.tradeId)} className="hover:underline">{v.ticker ?? `#${v.tradeId}`}{v.tradeDate ? ` · ${fmtDay(v.tradeDate)}` : ""}</Link> : fmtDay(v.occurredAt.slice(0, 10))}
        </p>
      </div>
      {val != null && <span className={cn("shrink-0 text-right font-semibold tabular-nums", val < 0 ? "text-down" : "text-up")}>{v.tradeNet != null ? fmtUsd(v.tradeNet, { signed: true, decimals: "auto" }) : fmtR(v.tradeR)}</span>}
    </li>
  );
}

export function MistakesPanel({ doc }: { doc: WeeklyReview }) {
  const { mistakes, violations } = doc;
  const empty = mistakes.items.length === 0 && violations.items.length === 0;
  const [all, setAll] = React.useState(false);
  const hidden = Math.max(0, mistakes.items.length - 8) + Math.max(0, violations.items.length - 8);
  const cap = all ? Infinity : 8;
  return (
    <Panel
      title="Ошибки и нарушения правил"
      description="что стоило денег на этой неделе"
      icon={ListChecks}
      className="min-w-0"
      actions={<Link href="/error-tracker" className="text-xs text-primary hover:underline">Правила →</Link>}
    >
      {empty ? (
        <div className="flex items-center gap-2 py-3 text-sm text-up"><CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Чистая неделя: ни ошибок, ни нарушений.</div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-sm"><span className="font-semibold tabular-nums">{mistakes.items.length}</span> <span className="text-muted-foreground">ошибок</span></span>
            <CostLine label="цена" cost={mistakes.cost} />
            <span className="text-sm"><span className="font-semibold tabular-nums">{violations.items.length}</span> <span className="text-muted-foreground">нарушений</span></span>
            <CostLine label="цена" cost={violations.cost} />
          </div>
          {mistakes.items.length > 0 && <ul className="divide-y divide-border/50">{mistakes.items.slice(0, cap).map((m) => <MistakeRow key={m.id} m={m} />)}</ul>}
          {violations.items.length > 0 && (
            <>
              {mistakes.items.length > 0 && <p className="micro-label">Нарушения правил</p>}
              <ul className="divide-y divide-border/50">{violations.items.slice(0, cap).map((v) => <ViolationRow key={v.id} v={v} />)}</ul>
            </>
          )}
          {hidden > 0 && (
            <button type="button" onClick={() => setAll((v) => !v)} className="self-start text-xs text-primary hover:underline">
              {all ? "Свернуть" : `Показать ещё ${hidden}`}
            </button>
          )}
        </div>
      )}
    </Panel>
  );
}

// ── Discipline ───────────────────────────────────────────────────────────────
export function DisciplinePanel({ doc }: { doc: WeeklyReview }) {
  const d = doc.discipline;
  const ratings = doc.ratings;
  const avgOverall = ratings.length ? ratings.reduce((s, r) => s + r.overall, 0) / ratings.length : null;
  return (
    <Panel title="Дисциплина и журнал" description="EOD-записи, чистые дни, серии" icon={NotebookPen} className="min-w-0" actions={<Link href="/journal" className="text-xs text-primary hover:underline">Журнал →</Link>}>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex items-center gap-3">
          <ProgressRing value={d.journalDays} max={5} size={52} tone={d.journalDays >= 4 ? "up" : d.journalDays >= 2 ? "warn" : "down"} label={`${d.journalDays}/5`} ariaLabel="Дней с записью в журнале" />
          <div className="min-w-0 text-sm">
            <p className="font-medium text-foreground">Журнал</p>
            <p className="text-xs text-muted-foreground">серия {d.journalStreak} дн. · с разбором {d.journalWithReview}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ProgressRing value={d.tradingDays ? d.cleanDays : 0} max={Math.max(1, d.tradingDays)} size={52} tone={d.tradingDays === 0 ? "neutral" : d.cleanDays === d.tradingDays ? "up" : d.cleanDays >= d.tradingDays / 2 ? "warn" : "down"} label={`${d.cleanDays}/${d.tradingDays}`} ariaLabel="Чистых торговых дней" />
          <div className="min-w-0 text-sm">
            <p className="font-medium text-foreground">Чистые дни</p>
            <p className="text-xs text-muted-foreground">без ошибок и нарушений · серия {d.cleanStreak} дн.</p>
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <Pill tone="neutral">дисциплина {d.avgDiscipline ?? "—"}/5</Pill>
        <Pill tone="neutral">настроение {d.avgMood ?? "—"}/5</Pill>
        <Pill tone={d.followedPlanDays >= 4 ? "up" : "neutral"}>по плану {d.followedPlanDays} дн.</Pill>
        {avgOverall != null && <Pill tone={avgOverall >= 7 ? "up" : avgOverall >= 5 ? "warn" : "down"}>рейтинг куратора {avgOverall.toFixed(1)}/10</Pill>}
      </div>
      {d.days.length > 0 && (
        <ul className="mt-3 grid grid-cols-5 gap-1" aria-label="Записи журнала по дням">
          {[0, 1, 2, 3, 4].map((i) => {
            const date = doc.days[i]?.date;
            const j = d.days.find((x) => x.date === date);
            return (
              <li key={i} className={cn("rounded-lg px-1 py-1 text-center text-2xs tabular-nums", j ? (j.hasReview ? "bg-up/15 text-up" : "bg-primary/15 text-primary") : "bg-[var(--glass-bg)] text-muted-foreground")} title={date ? fmtDay(date, true) : undefined}>
                {date ? weekdayShort(date) : ""}{j?.discipline != null ? ` ${j.discipline}` : ""}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

// ── Risk events ──────────────────────────────────────────────────────────────
export function RiskPanel({ doc }: { doc: WeeklyReview }) {
  const { limits, events, weeklyLossPct } = doc.risk;
  return (
    <Panel title="Риск-события" description={limits ? `лимиты: день ${fmtUsd(limits.dailyLossLimit, { decimals: "auto" })} · неделя ${fmtUsd(limits.weeklyLossLimit, { decimals: "auto" })} · сделка ${fmtUsd(limits.maxRiskPerTrade, { decimals: "auto" })}` : "лимиты не заданы"} icon={ShieldAlert} className="min-w-0" actions={<Link href="/risk" className="text-xs text-primary hover:underline">Риск-деск →</Link>}>
      {!limits ? (
        <p className="py-3 text-sm text-muted-foreground">Куратор ещё не задал лимиты — события не вычисляются.</p>
      ) : events.length === 0 ? (
        <div className="flex items-center gap-2 py-3 text-sm text-up"><CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Лимиты не нарушались{weeklyLossPct != null ? ` · недельный лимит использован на ${weeklyLossPct}%` : ""}.</div>
      ) : (
        <ul className="divide-y divide-border/50">
          {events.map((e: RiskEvent, i) => (
            <li key={`${e.kind}-${e.date}-${i}`} className="flex items-center gap-3 py-2 text-sm">
              <AlertTriangle className={cn("h-4 w-4 shrink-0", e.level === "breach" ? "text-down" : "text-[hsl(var(--chart-3))]")} aria-hidden="true" />
              <span className="w-14 shrink-0 text-xs text-muted-foreground tabular-nums">{fmtDay(e.date)}</span>
              <span className="min-w-0 flex-1 truncate text-foreground">{e.label}{e.detail ? <span className="text-muted-foreground"> · {e.detail}</span> : null}</span>
              <Pill tone={e.level === "breach" ? "down" : "warn"}>{e.pct != null ? `${e.pct}%` : e.level === "breach" ? "нарушение" : "внимание"}</Pill>
              {e.limit ? <span className="hidden w-28 shrink-0 text-right text-xs text-muted-foreground tabular-nums sm:inline">{fmtUsd(e.used, { decimals: "auto" })} / {fmtUsd(e.limit, { decimals: "auto" })}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ── Open positions at week end ───────────────────────────────────────────────
export function OpenBookPanel({ doc }: { doc: WeeklyReview }) {
  const rows = doc.openPositions;
  const risk = rows.reduce((s, p) => s + (p.riskUsd ?? 0), 0);
  const exposure = rows.reduce((s, p) => s + (p.exposureUsd ?? 0), 0);
  return (
    <Panel title="Позиции на конец недели" description={rows.length ? `${rows.length} поз. · риск ${fmtUsd(risk, { decimals: "auto" })} · экспозиция ${fmtUsd(exposure, { decimals: "auto", compact: 10_000 })}` : "овернайт / свинг через выходные"} icon={MoonStar} className="min-w-0">
      {rows.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">В выходные книга была пустой.</p>
      ) : (
        <ul className="divide-y divide-border/50">
          {rows.map((p: OpenPosition) => (
            <li key={p.id}>
              <Link href={tradeHref(p.id)} className="flex items-center gap-3 py-2 text-sm hover:text-primary">
                <span className="w-16 shrink-0 font-semibold">{p.ticker}</span>
                <Pill tone={HORIZON_TONE[p.horizon]}>{HORIZON_LABEL[p.horizon]}</Pill>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">с {fmtDay(p.date)} · {p.daysHeld} дн.{p.side ? ` · ${p.side}` : ""}{!p.stillOpen && p.exitDate ? ` · закрыта ${fmtDay(p.exitDate)}` : ""}</span>
                <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">{p.riskUsd != null ? `риск ${fmtUsd(p.riskUsd, { decimals: "auto" })}` : "риск —"}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
