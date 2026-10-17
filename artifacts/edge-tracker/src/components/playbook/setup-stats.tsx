/**
 * «Статистика» tab of a setup: $-first edge from real (auto-imported) trades linked to the setup —
 * net, win rate, expectancy in $, payoff, best entry slots (ET), equity curve, tickers, horizon split.
 * R stays optional (shown only when trades carry it). Data: GET /api/playbook/:id/stats.
 * When the sample includes other traders' trades and the viewer is not staff, the server nulls every $ figure
 * (`redacted: true`); the panel then leads with R (avg R, expectancy in R, PF in R, cumulative-R curve).
 */
import * as React from "react";
import { BarChart3, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, SortableTh, Sparkline, StatCard, StatGrid, toneText, useTableSort, type Tone } from "@/components/ds";
import { winrateTone } from "@/components/playbook-sub/bits";
import { cn } from "@/lib/utils";
import { notLiveMessage, useSetupStats } from "./api";
import { DocSection, REDACTED_AGG_HINT, RedactedHint } from "./setup-bits";
import { HORIZON_LABEL, ddmm, fmtPct, fmtR, fmtUsd, moneyTone, type SetupSummary, type SlotStat, type UsdStats } from "./model";

const slotLabel = (s: string) => (s === "pre" ? "Премаркет" : s === "post" ? "После закрытия" : `${s}–${endOf(s)}`);
function endOf(s: string) {
  const [h, m] = s.split(":").map(Number);
  const t = h * 60 + m + 30;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}
const wrTone = (u: UsdStats): Tone => (u.winrate == null ? "neutral" : winrateTone(u.winrate, u.wins + u.losses));

export function SetupStatsPanel({ setupId, summary, children }: { setupId: number; summary?: SetupSummary; children?: React.ReactNode }) {
  const q = useSetupStats(setupId);

  if (q.isLoading) {
    return (
      <div className="flex min-h-[420px] flex-col gap-[var(--grid-gap)]" aria-busy="true">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-[var(--glass-bg)] motion-reduce:animate-none" />)}</div>
        <div className="h-48 animate-pulse rounded-2xl bg-[var(--glass-bg)] motion-reduce:animate-none" />
      </div>
    );
  }

  // Older API: fall back to the summary row ($ fields when present).
  if (q.isError) {
    const live = notLiveMessage(q.error);
    if (live && summary && summary.tradeCount > 0) {
      return (
        <div className="flex flex-col gap-[var(--grid-gap)]">
          <StatGrid cols={4}>
            <StatCard label="Сделок" value={summary.tradeCount} hint={`${summary.wins}W · ${summary.losses}L`} />
            <StatCard label="Win rate" value={fmtPct(summary.winrate)} hint="W / (W + L)" />
            <StatCard label="P&L нетто" value={fmtUsd(summary.netPnl)} tone={moneyTone(summary.netPnl)} />
            <StatCard label="Ожидание, $" value={fmtUsd(summary.netPnl != null && summary.tradeCount ? summary.netPnl / summary.tradeCount : null)} tone={moneyTone(summary.netPnl)} hint="на сделку" />
          </StatGrid>
          {summary.redacted && <RedactedHint text={REDACTED_AGG_HINT} />}
          <p className="text-xs text-muted-foreground">Лучшие часы, кривая и разбивка по тикерам появятся после перезапуска API.</p>
          {children}
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-[var(--grid-gap)]">
        <div className="glass-panel rounded-2xl">
          <EmptyState
            icon={BarChart3}
            title={live ? "Статистика включится после обновления сервера" : "Не удалось загрузить статистику"}
            description={live ? undefined : (q.error as Error)?.message}
            action={live ? undefined : <Button variant="outline" onClick={() => q.refetch()}>Повторить</Button>}
          />
        </div>
        {children}
      </div>
    );
  }

  const s = q.data!;
  if (!s.count) {
    return (
      <div className="flex flex-col gap-[var(--grid-gap)]">
        <div className="glass-panel rounded-2xl">
          <EmptyState
            icon={BarChart3}
            title="По сетапу ещё нет сделок"
            description="Сделки подтягиваются автоматически. Привяжите их к сетапу — через «Добавить примеры» или из карточки сделки — и здесь появится edge в $."
          />
        </div>
        {children}
      </div>
    );
  }

  const u = s.usd;
  const small = u.n < 10;
  const hasR = (s.edge?.rCount ?? 0) > 0;
  // $ hidden by the server → R everywhere a $ figure would be.
  const redacted = !!s.redacted;
  const curve = redacted ? (s.equityR ?? []).map((p) => p.cum) : s.equity.map((p) => p.cum);
  const curveTone = redacted ? moneyTone(s.edge?.avgR) : moneyTone(u.net);
  const expR = s.edge?.expectancy ?? s.edge?.avgR ?? null;
  const maxSlotN = Math.max(1, ...s.slots.map((x) => x.n));

  return (
    <div className="flex flex-col gap-[var(--grid-gap)]">
      {redacted && <RedactedHint text={REDACTED_AGG_HINT} className="px-1" />}
      {redacted ? (
        <StatGrid cols={4}>
          <StatCard label="Средний R" value={fmtR(s.edge?.avgR)} tone={curveTone} hint={`${s.count} ${s.count < 10 ? "· мало для выводов" : "сделок"}`} spark={curve.length > 1 ? curve : undefined} term="avgR" />
          <StatCard label="Win rate" value={fmtPct(u.winrate)} tone={wrTone(u)} hint={`${u.wins}W · ${u.losses}L`} term="winrate" />
          <StatCard label="Ожидание" value={fmtR(expR)} tone={moneyTone(expR)} hint={hasR ? `R на сделку · R есть у ${s.edge.rCount}` : "нет R — нужен стоп"} term="expectancy" />
          <StatCard label="PF (R)" value={s.edge?.profitFactor == null ? "—" : s.edge.profitFactor.toFixed(2)} hint="ΣR⁺ / |ΣR⁻|" term="pf" />
        </StatGrid>
      ) : (
      <StatGrid cols={4}>
        <StatCard label="P&L нетто" value={fmtUsd(u.net)} tone={moneyTone(u.net)} hint={`${u.n} ${small ? "· мало для выводов" : "сделок"}`} spark={curve.length > 1 ? curve : undefined} />
        <StatCard label="Win rate" value={fmtPct(u.winrate)} tone={wrTone(u)} hint={`${u.wins}W · ${u.losses}L`} term="winrate" />
        <StatCard label="Ожидание" value={fmtUsd(u.expectancy, 2)} tone={moneyTone(u.expectancy)} hint="$ на сделку" term="expectancy" />
        <StatCard
          label="Payoff"
          value={u.payoff == null ? "—" : u.payoff.toFixed(2)}
          hint={`ср. плюс ${fmtUsd(u.avgWin)} · минус ${fmtUsd(u.avgLoss)}`}
        />
      </StatGrid>
      )}

      {s.recent.n >= 5 && u.n >= 25 && s.recent.expectancy != null && u.expectancy != null && s.recent.expectancy < u.expectancy - Math.abs(u.expectancy) && (
        <p className="rounded-xl border border-[hsl(var(--chart-3)/0.3)] bg-[hsl(var(--chart-3)/0.1)] px-3 py-2 text-sm text-[hsl(var(--chart-3))]">
          Edge проседает: последние {s.recent.n} сделок дают {fmtUsd(s.recent.expectancy, 2)} на сделку против {fmtUsd(u.expectancy, 2)} за всю историю.
        </p>
      )}

      <div className="grid gap-[var(--grid-gap)] xl:grid-cols-2">
        <DocSection title="Лучшее время входа (ET)" icon={Clock}>
          {s.slots.length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет времени входа у сделок — появится, когда подтянутся исполнения.</p>
          ) : (
            <>
              {s.bestSlots.length > 0 && (
                <p className="mb-3 text-sm text-foreground">
                  Лучше всего работает: {s.bestSlots.map((b) => <strong key={b.slot} className="font-semibold">{slotLabel(b.slot)}</strong>).reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, ", ", el] : [el]), [])}
                </p>
              )}
              <ul className="flex flex-col gap-1">
                {s.slots.map((sl) => <SlotRow key={sl.slot} sl={sl} maxN={maxSlotN} best={s.bestSlots.some((b) => b.slot === sl.slot)} />)}
              </ul>
              {s.timeCoverage != null && s.timeCoverage < 0.95 && (
                <p className="mt-2 text-xs text-muted-foreground">Время входа известно у {Math.round(s.timeCoverage * 100)}% сделок.</p>
              )}
            </>
          )}
        </DocSection>

        <DocSection title={redacted ? "Кривая R по дням" : "Кривая P&L по дням"} icon={BarChart3} actions={s.firstDate ? <span className="text-xs tabular-nums text-muted-foreground">{ddmm(s.firstDate)} — {ddmm(s.lastDate)}</span> : undefined}>
          {curve.length > 1 ? (
            <Sparkline data={curve} width={560} height={140} tone={curveTone} baseline={0} className="h-36 w-full" ariaLabel={redacted ? "Накопленный R" : "Накопленный P&L нетто"} />
          ) : (
            <p className="text-sm text-muted-foreground">{redacted && !hasR ? "Кривая в R появится у сделок со стопом." : "Нужно хотя бы два торговых дня."}</p>
          )}
          {!redacted && (
          <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
            <Mini label="Лучшая" value={fmtUsd(u.best)} tone={moneyTone(u.best)} />
            <Mini label="Худшая" value={fmtUsd(u.worst)} tone={moneyTone(u.worst)} />
            <Mini label="Просадка" value={s.edge?.maxDrawdown != null ? fmtUsd(-Math.abs(s.edge.maxDrawdown)) : "—"} tone={s.edge?.maxDrawdown ? "down" : "neutral"} />
          </dl>
          )}
        </DocSection>
      </div>

      <div className="grid gap-[var(--grid-gap)] 2xl:grid-cols-2">
        <DocSection title="Тикеры">
          <UsdTable head="Тикер" rows={s.tickers.map((t) => ({ key: t.ticker, label: t.ticker, u: t }))} />
        </DocSection>
        <DocSection title={s.traders ? "Трейдеры и горизонт" : "Горизонт"}>
          {s.traders && s.traders.length > 0 && <div className="mb-3"><UsdTable head="Трейдер" rows={s.traders.map((t) => ({ key: t.trader, label: t.trader, u: t }))} /></div>}
          <UsdTable head="Горизонт" rows={Object.entries(s.byHorizon).map(([k, v]) => ({ key: k, label: HORIZON_LABEL[k] ?? k, u: v }))} />
        </DocSection>
      </div>

      {hasR && (
        <p className="px-1 text-xs text-muted-foreground">
          В R (где есть стоп): средний {fmtR(s.edge.avgR)} по {s.edge.rCount} сделкам{s.edge.profitFactor != null ? ` · PF ${s.edge.profitFactor.toFixed(2)}` : ""}.
        </p>
      )}
      {children}
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  return (
    <div className="rounded-xl bg-[var(--glass-bg)] px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("font-semibold tabular-nums", toneText(tone))}>{value}</dd>
    </div>
  );
}

function SlotRow({ sl, maxN, best }: { sl: SlotStat; maxN: number; best: boolean }) {
  return (
    <li className="grid grid-cols-[132px_minmax(0,1fr)_56px_80px] items-center gap-2 text-sm">
      <span className={cn("tabular-nums", best ? "font-semibold text-foreground" : "text-muted-foreground")}>{slotLabel(sl.slot)}</span>
      <span className="h-1.5 overflow-hidden rounded-full bg-[hsl(var(--border))]" aria-hidden="true">
        <span className={cn("block h-full rounded-full", sl.net == null ? "bg-[hsl(var(--muted-foreground)/0.45)]" : sl.net >= 0 ? "bg-up" : "bg-down")} style={{ width: `${(sl.n / maxN) * 100}%` }} />
      </span>
      <span className="text-right text-xs tabular-nums text-muted-foreground" title="Сделок · win rate">{sl.n} · {fmtPct(sl.winrate)}</span>
      <span className={cn("text-right tabular-nums", toneText(moneyTone(sl.net)))}>{fmtUsd(sl.net)}</span>
    </li>
  );
}

type UsdRow = { key: string; label: string; u: UsdStats };
type UsdKey = "label" | "n" | "winrate" | "exp" | "net";
const USD_ACCESSORS: Record<UsdKey, (r: UsdRow) => number | string | null | undefined> = {
  label: (r) => r.label,
  n: (r) => r.u.n,
  winrate: (r) => r.u.winrate,
  exp: (r) => r.u.expectancy,
  net: (r) => r.u.net,
};

/** Sortable breakdown (ticker / trader / horizon): default — most trades first; long lists scroll inside. */
function UsdTable({ rows: data, head }: { rows: UsdRow[]; head: string }) {
  const { rows, thProps } = useTableSort<UsdRow, UsdKey>(data, USD_ACCESSORS, "n", "desc", { label: "asc" });
  if (!data.length) return <p className="text-sm text-muted-foreground">—</p>;
  return (
    <div className="max-h-[min(60dvh,520px)] overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-raised bg-surface-solid">
          <tr className="text-xs text-muted-foreground [&_th]:py-1 [&_th]:font-medium">
            <SortableTh {...thProps("label")}>{head}</SortableTh>
            <SortableTh {...thProps("n")} align="right">Сделок</SortableTh>
            <SortableTh {...thProps("winrate")} align="right">WR</SortableTh>
            <SortableTh {...thProps("exp")} align="right">$ / сделка</SortableTh>
            <SortableTh {...thProps("net")} align="right">Нетто</SortableTh>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ key, label, u }) => (
            <tr key={key} className="border-t border-border/40">
              <td className="py-1.5 font-medium text-foreground">{label}</td>
              <td className="py-1.5 text-right tabular-nums text-muted-foreground">{u.n}</td>
              <td className="py-1.5 text-right tabular-nums">{fmtPct(u.winrate)}</td>
              <td className={cn("py-1.5 text-right tabular-nums", toneText(moneyTone(u.expectancy)))}>{fmtUsd(u.expectancy, 2)}</td>
              <td className={cn("py-1.5 text-right tabular-nums", toneText(moneyTone(u.net)))}>{fmtUsd(u.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
