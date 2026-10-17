/**
 * Sections of «Разбор дня»: KPI header, intraday equity, trade timeline, breakdowns, leaks, strengths,
 * tomorrow's plan and cross-links. All numbers come pre-computed from GET /api/day-report (net $, ET time).
 */
import * as React from "react";
import type { CSSProperties } from "react";
import { Link } from "wouter";
import { Area, AreaChart, CartesianGrid, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AlertTriangle, BarChart3, CalendarDays, CheckCircle2, Clock, ExternalLink, LineChart, ListChecks, ListOrdered, NotebookPen, Sparkles, Target,
} from "lucide-react";
import { DataTable, EmptyState, Panel, Pill, StatCard, StatGrid, StatRow, toneOf, toneText, type Tone } from "@/components/ds";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import { weekKeyOf } from "@/components/weekly-review/api";
import {
  SIDE_LABEL, fmtDayShort, fmtHold, fmtPct, fmtUsd, pluralTrades,
  type Bucket, type DayReport, type Leak, type LeakKind, type TimelineRow, type TradeRef,
} from "./api";

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

export const LEAK_SHORT: Record<LeakKind, string> = {
  fee_over_gross: "комиссия > брутто",
  after_peak: "после пика",
  revenge: "реванш",
  size_up: "размер ↑",
  after_limit: "после лимита",
};

function Money({ v, signed = true, className }: { v: number | null | undefined; signed?: boolean; className?: string }) {
  return <span className={cn("tabular-nums", toneText(toneOf(v)), className)}>{fmtUsd(v, signed)}</span>;
}

function TradeLink({ t }: { t: Pick<TradeRef, "id" | "ticker"> }) {
  return (
    <Link href={links.trade(t.id)} className="font-medium text-foreground hover:text-primary hover:underline">
      {t.ticker}
    </Link>
  );
}

// ── 1. Header KPIs ───────────────────────────────────────────────────────────
export function SummaryBento({ doc }: { doc: DayReport }) {
  const s = doc.summary;
  const c = doc.comparison;
  const feeShare = s.feeShareOfGross;
  const cmpTone: Tone = c.betterThanPct == null ? "neutral" : c.betterThanPct >= 0.6 ? "up" : c.betterThanPct <= 0.4 ? "down" : "neutral";
  return (
    <StatGrid className="xl:grid-cols-5">
      <StatCard
        label="Нетто за день"
        value={fmtUsd(s.net, true)}
        tone={toneOf(s.net)}
        hint={`брутто ${fmtUsd(s.gross, true)} · комиссии ${fmtUsd(s.fees)}${feeShare != null ? ` (${fmtPct(feeShare, 1)} брутто)` : ""}`}
      />
      <StatCard
        label="Сделки · win rate"
        value={`${s.closed}${s.open ? ` +${s.open} откр.` : ""} · ${fmtPct(s.winRate)}`}
        hint={`${s.wins}W / ${s.losses}L${s.be ? ` / ${s.be} BE` : ""} · средняя ${fmtUsd(s.expectancy, true)}`}
      />
      <StatCard
        label="Profit factor ($ нетто)"
        value={s.profitFactor != null ? s.profitFactor.toFixed(2) : s.wins > 0 ? "без убытков" : "—"}
        tone={s.profitFactor == null ? (s.wins > 0 ? "up" : "neutral") : s.profitFactor >= 1 ? "up" : "down"}
        hint={`ср. плюс ${fmtUsd(s.avgWin, true)} · ср. минус ${fmtUsd(s.avgLoss, true)}`}
      />
      <StatCard
        label="Лучшая / худшая"
        value={
          <span className="flex items-baseline gap-2 text-xl">
            <Money v={s.best?.net} />
            <span className="text-muted-foreground">/</span>
            <Money v={s.worst?.net} />
          </span>
        }
        hint={s.best && s.worst ? `${s.best.ticker} · ${s.worst.ticker}` : "—"}
      />
      <StatCard
        label={`vs ${c.days || 20} торговых дней`}
        value={c.betterThanPct != null && s.closed > 0 ? `лучше ${Math.round(c.betterThanPct * 100)}%` : "—"}
        tone={cmpTone}
        hint={c.avg != null ? `среднее ${fmtUsd(c.avg, true)}${c.z != null ? ` · z ${c.z > 0 ? "+" : ""}${c.z.toFixed(2)}` : ""}` : c.label}
      />
    </StatGrid>
  );
}

// ── 2. Intraday equity ───────────────────────────────────────────────────────
export function EquityPanel({ doc }: { doc: DayReport }) {
  const e = doc.equity;
  const timed = e.points.every((p) => p.t != null);
  const data = e.points.map((p, i) => ({ ...p, x: timed ? p.t! : i }));
  const peakPt = data.find((p) => p.tradeId === e.peak.tradeId && e.peak.tradeId != null);
  const ddEnd = data.find((p) => p.tradeId === e.maxDrawdown.toTradeId && e.maxDrawdown.toTradeId != null);
  const fmtX = (x: number) => {
    if (!timed) return `#${x}`;
    const p = data.find((d) => d.x === x);
    return p?.time?.slice(0, 5) ?? "";
  };
  const color = e.final >= 0 ? "hsl(var(--up))" : "hsl(var(--down))";
  const srcLabel = e.timeSource === "executions" ? "по времени исполнений (выход)" : e.timeSource === "snapshot" ? "по времени PropReports (выход)" : "порядок сделок, без времени";
  return (
    <Panel
      title="Кривая дня"
      description={`Нарастающее нетто ${srcLabel}, ET`}
      icon={LineChart}
      className="min-w-0"
      actions={
        <div className="flex flex-wrap gap-1.5">
          <Pill tone="up" title="Максимум нарастающего нетто">пик {fmtUsd(e.peak.value, true)}{e.peak.time ? ` · ${e.peak.time.slice(0, 5)}` : ""}</Pill>
          <Pill tone={e.maxDrawdown.value > 0 ? "down" : "neutral"} title="Максимальная просадка от пика внутри дня">
            max DD {fmtUsd(-e.maxDrawdown.value)}{e.maxDrawdown.fromTime && e.maxDrawdown.toTime ? ` · ${e.maxDrawdown.fromTime.slice(0, 5)}→${e.maxDrawdown.toTime.slice(0, 5)}` : ""}
          </Pill>
          {e.giveback > 0 && <Pill tone="warn" title="Пик минус закрытие дня">отдано {fmtUsd(e.giveback)}</Pill>}
        </div>
      }
    >
      {data.length < 2 ? (
        <EmptyState icon={LineChart} title="Нет закрытых сделок" description="Кривая строится по закрытым сделкам дня." className="py-8" />
      ) : (
        <div className="h-56 w-full" role="img" aria-label={`Кривая нетто за день: пик ${fmtUsd(e.peak.value, true)}, закрытие ${fmtUsd(e.final, true)}, максимальная просадка ${fmtUsd(e.maxDrawdown.value)}`}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="dr-eq" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="hsl(var(--border) / 0.4)" vertical={false} />
              <XAxis
                dataKey="x"
                type="number"
                domain={["dataMin", "dataMax"]}
                ticks={data.map((d) => d.x)}
                tickFormatter={fmtX}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={24}
              />
              <YAxis width={64} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(v: number) => fmtUsd(v)} />
              <ReferenceLine y={0} stroke="hsl(var(--border))" />
              {doc.dailyLossLimit != null && <ReferenceLine y={-doc.dailyLossLimit} stroke="hsl(var(--down))" strokeDasharray="4 4" label={{ value: "дневной лимит", fill: "hsl(var(--down))", fontSize: 10, position: "insideBottomLeft" }} />}
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelFormatter={(x: number) => {
                  const p = data.find((d) => d.x === x);
                  return p ? `${p.time ?? ""}${p.ticker ? ` · ${p.ticker}` : " · старт"}` : "";
                }}
                formatter={(v: number, _n, item) => [`${fmtUsd(v, true)}${item?.payload?.tradeId ? ` (сделка ${fmtUsd(item.payload.net, true)})` : ""}`, "Нетто нарастающим"]}
              />
              <Area type="stepAfter" dataKey="cum" stroke={color} strokeWidth={2} fill="url(#dr-eq)" isAnimationActive={false} dot={{ r: 2.5, fill: color }} />
              {peakPt && <ReferenceDot x={peakPt.x} y={peakPt.cum} r={5} fill="hsl(var(--up))" stroke="hsl(var(--background))" />}
              {ddEnd && e.maxDrawdown.value > 0 && <ReferenceDot x={ddEnd.x} y={ddEnd.cum} r={5} fill="hsl(var(--down))" stroke="hsl(var(--background))" />}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

// ── 3. Timeline ──────────────────────────────────────────────────────────────
export function TimelinePanel({ doc }: { doc: DayReport }) {
  const flags = React.useMemo(() => {
    const m = new Map<number, LeakKind[]>();
    for (const l of doc.leaks) for (const id of l.tradeIds) m.set(id, [...(m.get(id) ?? []), l.kind]);
    return m;
  }, [doc.leaks]);
  const rows = doc.timeline;
  return (
    <Panel
      title="Хронология сделок"
      description={`${rows.length} ${pluralTrades(rows.length)} по времени входа, ET${doc.firstEntry && doc.lastExit ? ` · ${doc.firstEntry.slice(0, 5)}–${doc.lastExit.slice(0, 5)}` : ""}${doc.activeMinutes != null ? ` · в рынке ${fmtHold(doc.activeMinutes)}` : ""}`}
      icon={ListOrdered}
      className="min-w-0"
      padded={false}
      bodyClassName="px-2 pb-2 sm:px-3"
    >
      <DataTable ariaLabel="Хронология сделок дня">
        <table>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Вход</th>
              <th scope="col">Выход</th>
              <th scope="col">Тикер</th>
              <th scope="col">Сторона</th>
              <th scope="col" className="!text-right">Кол-во</th>
              <th scope="col" className="!text-right">Удержание</th>
              <th scope="col" className="!text-right">Брутто</th>
              <th scope="col" className="!text-right">Комиссия</th>
              <th scope="col" className="!text-right">Нетто</th>
              <th scope="col" className="!text-right">Итог дня</th>
              <th scope="col">Пауза</th>
              <th scope="col">Флаги</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => <TimelineTr key={t.id} t={t} flags={flags.get(t.id) ?? []} />)}
          </tbody>
        </table>
      </DataTable>
    </Panel>
  );
}

function TimelineTr({ t, flags }: { t: TimelineRow; flags: LeakKind[] }) {
  return (
    <tr className={cn(flags.length > 0 && "bg-[hsl(var(--chart-3)/0.06)]")}>
      <td className="text-muted-foreground">{t.index}</td>
      <td className="whitespace-nowrap">{t.entryTime ?? "—"}</td>
      <td className="whitespace-nowrap">{t.exitTime ?? "—"}</td>
      <td><TradeLink t={t} />{t.setup && <span className="ml-1.5 text-xs text-muted-foreground">{t.setup}</span>}</td>
      <td>{t.side ? <Pill tone={t.side === "long" ? "up" : "down"}>{SIDE_LABEL[t.side]}</Pill> : "—"}</td>
      <td className="text-right">{t.qty ?? "—"}</td>
      <td className="whitespace-nowrap text-right">{fmtHold(t.holdMin)}</td>
      <td className="text-right"><Money v={t.gross} /></td>
      <td className="text-right text-muted-foreground">{fmtUsd(t.fees)}</td>
      <td className="text-right font-medium"><Money v={t.net} /></td>
      <td className="text-right"><Money v={t.cumAfter} /></td>
      <td className="whitespace-nowrap text-xs text-muted-foreground">
        {t.overlap ? <Pill tone="purple" title="Вход при ещё открытой предыдущей позиции">параллельно</Pill> : t.gapMin != null ? fmtHold(t.gapMin) : "—"}
        {t.afterLoss && !t.overlap && <span className="ml-1 text-down" title="Предыдущая закрытая сделка — убыток">после −</span>}
      </td>
      <td>
        <div className="flex flex-wrap gap-1">
          {flags.map((f) => <Pill key={f} tone={f === "after_limit" || f === "revenge" ? "down" : "warn"}>{LEAK_SHORT[f]}</Pill>)}
        </div>
      </td>
    </tr>
  );
}

// ── 4. Breakdowns ────────────────────────────────────────────────────────────
function BucketTable({ title, rows, ariaLabel }: { title: string; rows: Bucket[]; ariaLabel: string }) {
  const max = Math.max(0, ...rows.map((r) => Math.abs(r.net)));
  return (
    <div className="min-w-0">
      <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      {rows.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">Нет данных</p>
      ) : (
        <DataTable ariaLabel={ariaLabel}>
          <table>
            <thead>
              <tr>
                <th scope="col">{title}</th>
                <th scope="col" className="!text-right">Сд.</th>
                <th scope="col" className="!text-right">W/L</th>
                <th scope="col" className="!text-right">Нетто</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="whitespace-nowrap">
                    <div className="flex flex-col gap-1">
                      <span className="font-medium">{r.label}</span>
                      <span className="h-1 rounded-full bg-[var(--glass-bg)]" aria-hidden="true">
                        <span className={cn("block h-1 rounded-full", r.net >= 0 ? "bg-up/70" : "bg-down/70")} style={{ width: `${max > 0 ? (Math.abs(r.net) / max) * 100 : 0}%` }} />
                      </span>
                    </div>
                  </td>
                  <td className="text-right">{r.trades}</td>
                  <td className="whitespace-nowrap text-right text-muted-foreground">{r.wins}/{r.losses}</td>
                  <td className="text-right font-medium"><Money v={r.net} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
      )}
    </div>
  );
}

export function BreakdownPanel({ doc }: { doc: DayReport }) {
  return (
    <Panel title="Разрезы" description="Нетто по тикеру, часу входа (ET) и стороне" icon={BarChart3} className="min-w-0">
      <div className="grid gap-4 lg:grid-cols-3">
        <BucketTable title="Тикер" rows={doc.breakdown.byTicker} ariaLabel="Нетто по тикерам" />
        <BucketTable title="Час (ET)" rows={doc.breakdown.byHour} ariaLabel="Нетто по часу входа" />
        <BucketTable title="Сторона" rows={doc.breakdown.bySide} ariaLabel="Нетто по стороне" />
      </div>
    </Panel>
  );
}

// ── 5. Leaks ─────────────────────────────────────────────────────────────────
const SEVERITY_TONE: Record<Leak["severity"], Tone> = { high: "down", medium: "warn", low: "neutral" };
const SEVERITY_LABEL: Record<Leak["severity"], string> = { high: "сильная", medium: "средняя", low: "слабая" };

export function LeaksPanel({ doc }: { doc: DayReport }) {
  const tickerOf = React.useMemo(() => new Map(doc.timeline.map((t) => [t.id, t.ticker])), [doc.timeline]);
  return (
    <Panel
      title="Утечки"
      description={doc.dailyLossLimit != null
        ? `Правила дня · дневной лимит ${fmtUsd(doc.dailyLossLimit)}${doc.dailyLossLimitSource === "tier" ? " (уровень скейлинга)" : ""}`
        : "Правила дня · дневной лимит не задан — проверка лимита пропущена"}
      icon={AlertTriangle}
      className="min-w-0"
      actions={doc.leaks.length > 0 ? <Pill tone="down" title="Убыточные помеченные сделки без двойного счёта">≈ {fmtUsd(-doc.leaksTotalUsd)}</Pill> : undefined}
    >
      {doc.leaks.length === 0 ? (
        <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-up" aria-hidden="true" /> Утечек по правилам не найдено.
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border/50">
          {doc.leaks.map((l) => (
            <li key={l.kind} className="flex flex-wrap items-start justify-between gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{l.title}</span>
                  <Pill tone={SEVERITY_TONE[l.severity]}>{SEVERITY_LABEL[l.severity]}</Pill>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{l.detail}</p>
                <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                  {l.tradeIds.map((id) => (
                    <Link key={id} href={links.trade(id)} className="rounded-full border border-[var(--field-border)] px-2 py-0.5 hover:text-primary">
                      {tickerOf.get(id) ?? `#${id}`}
                    </Link>
                  ))}
                </div>
              </div>
              <div className="text-right">
                <div className={cn("text-sm font-semibold tabular-nums", l.costUsd > 0 ? "text-down" : "text-muted-foreground")}>{l.costUsd > 0 ? fmtUsd(-l.costUsd) : "$0.00"}</div>
                <div className="text-2xs text-muted-foreground">нетто сделок {fmtUsd(l.netUsd, true)}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ── 6. Strengths ─────────────────────────────────────────────────────────────
export function StrengthsPanel({ doc }: { doc: DayReport }) {
  const s = doc.strengths;
  const nothing = s.topTrades.length === 0;
  return (
    <Panel title="Что получилось" description="Лучшие сделки и то, где в этот день было преимущество" icon={Sparkles} className="min-w-0">
      {nothing ? (
        <p className="py-2 text-sm text-muted-foreground">Прибыльных сделок в этот день нет.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <ol className="flex flex-col gap-1.5">
            {s.topTrades.map((t, i) => (
              <li key={t.id} className="flex items-center gap-3 text-sm">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-up/15 text-xs font-semibold text-up">{i + 1}</span>
                <TradeLink t={t} />
                {t.side && <span className="text-xs text-muted-foreground">{SIDE_LABEL[t.side]}</span>}
                <span className="text-xs text-muted-foreground tabular-nums">{t.entryTime?.slice(0, 5) ?? "—"} · {fmtHold(t.holdMin)}</span>
                <Money v={t.net} className="ml-auto font-semibold" />
              </li>
            ))}
          </ol>
          <div className="flex flex-col gap-1">
            {s.tickers.length > 0 && <EdgeRow label="Тикеры с преимуществом" items={s.tickers.map((x) => `${x.label} ${fmtUsd(x.net, true)}`)} />}
            {s.setups.length > 0 && <EdgeRow label="Сетапы" items={s.setups.map((x) => `${x.label} ${fmtUsd(x.net, true)} (${x.wins}/${x.trades})`)} />}
            {s.sides.length > 0 && <EdgeRow label="Сторона" items={s.sides.map((x) => `${x.label} ${fmtUsd(x.net, true)}`)} />}
            {s.bestHour && <EdgeRow label="Лучший час (ET)" items={[`${s.bestHour.label} ${fmtUsd(s.bestHour.net, true)}`]} />}
            {s.setups.length === 0 && <p className="text-xs text-muted-foreground">Сетапы у сделок не указаны — разметьте их в журнале, чтобы видеть преимущество по сетапам.</p>}
          </div>
        </div>
      )}
    </Panel>
  );
}

function EdgeRow({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
      <span className="text-xs text-muted-foreground">{label}:</span>
      {items.map((x) => <Pill key={x} tone="up">{x}</Pill>)}
    </div>
  );
}

// ── 7. Plan ──────────────────────────────────────────────────────────────────
export function PlanPanel({ doc }: { doc: DayReport }) {
  return (
    <Panel title="План на завтра" description="Правила из флагов дня — без ИИ, по шаблонам" icon={Target} className="min-w-0">
      {doc.plan.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">Нет рекомендаций — в этот день не было закрытых сделок.</p>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {doc.plan.map((p, i) => (
            <li key={p.id} className="flex gap-3">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{i + 1}</span>
              <div className="min-w-0">
                <p className="text-sm text-foreground">{p.text}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{p.source === "stat" ? "статистика дня" : `флаг «${LEAK_SHORT[p.source]}»`} · {p.reason}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

// ── Comparison detail ────────────────────────────────────────────────────────
export function ComparisonPanel({ doc }: { doc: DayReport }) {
  const c = doc.comparison;
  return (
    <Panel title="На фоне последних дней" description={c.label} icon={CalendarDays} className="min-w-0">
      <StatRow label="Сегодня (нетто)" value={fmtUsd(doc.summary.net, true)} tone={toneOf(doc.summary.net)} />
      <StatRow label={`Среднее за ${c.days} дн.`} value={fmtUsd(c.avg, true)} tone={toneOf(c.avg)} />
      <StatRow label="Ст. отклонение" value={c.std != null ? fmtUsd(c.std) : "—"} />
      <StatRow label="z-score" value={c.z != null ? `${c.z > 0 ? "+" : ""}${c.z.toFixed(2)}` : "—"} tone={toneOf(c.z)} />
      <StatRow label="Место в окне" value={c.rank != null && c.days ? `${c.rank} из ${c.days + 1}` : "—"} />
      <StatRow label="Лучший день окна" value={c.bestDay ? `${fmtUsd(c.bestDay.net, true)} · ${fmtDayShort(c.bestDay.date)}` : "—"} />
      <StatRow label="Худший день окна" value={c.worstDay ? `${fmtUsd(c.worstDay.net, true)} · ${fmtDayShort(c.worstDay.date)}` : "—"} />
    </Panel>
  );
}

// ── 8. Links ─────────────────────────────────────────────────────────────────
export function LinksPanel({ doc }: { doc: DayReport }) {
  const items: { href: string; label: string; icon: typeof NotebookPen }[] = [
    { href: links.journalDay(doc.date, doc.trader || undefined), label: "Журнал дня", icon: NotebookPen },
    { href: links.trades({ date: doc.date }), label: `Сделки дня (${doc.summary.trades})`, icon: ListChecks },
    { href: links.weeklyReview({ trader: doc.trader || undefined, week: weekKeyOf(doc.date) }), label: "Отчёт недели", icon: Clock },
  ];
  return (
    <div className="flex flex-wrap gap-2" data-print-hide>
      {items.map((it) => (
        <Link key={it.label} href={it.href} className="glass-field inline-flex min-h-9 items-center gap-2 px-3.5 text-sm font-medium hover:text-primary">
          <it.icon className="h-4 w-4" aria-hidden="true" /> {it.label} <ExternalLink className="h-3 w-3 opacity-60" aria-hidden="true" />
        </Link>
      ))}
    </div>
  );
}
