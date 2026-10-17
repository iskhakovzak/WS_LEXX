import { useMemo, useState } from "react";
import type { Trade } from "@workspace/api-client-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from "recharts";
import { FlaskConical, Check } from "lucide-react";
import { Panel, EmptyState, Pill, toneOf } from "@/components/ds";
import { cn } from "@/lib/utils";
import { type Unit, fmtR, fmtUsd, fmtPct, fmtPf, fmtSigned, sdeal, CHART_TOOLTIP_STYLE, AXIS, GRID } from "./metrics";
import { toSimTrades } from "./edge-api";
import { applyWhatIf, kpisOf, equityCurve, WHAT_IF_RULES, type WhatIfRuleId, type ValueKpis } from "./edge-stats";

export function WhatIfTab({ trades, unit }: { trades: Trade[]; unit: Unit | null }) {
  const u: Unit = unit ?? "r";
  const [rules, setRules] = useState<Set<WhatIfRuleId>>(new Set());
  const sim = useMemo(() => toSimTrades(trades), [trades]);

  const base = useMemo(() => {
    const values = sim.map((t) => (u === "r" ? t.r : t.net)).filter((v): v is number => v != null);
    return { values, kpis: kpisOf(values) };
  }, [sim, u]);
  const alt = useMemo(() => {
    const r = applyWhatIf(sim, rules, u);
    return { ...r, kpis: kpisOf(r.values) };
  }, [sim, rules, u]);

  const chart = useMemo(() => {
    const a = equityCurve(base.values), b = equityCurve(alt.values);
    const n = Math.max(a.length, b.length);
    return Array.from({ length: n + 1 }, (_, i) => ({ i, Факт: i === 0 ? 0 : a[i - 1] ?? a[a.length - 1] ?? 0, "Что если": i === 0 ? 0 : b[i - 1] ?? b[b.length - 1] ?? 0 }));
  }, [base.values, alt.values]);

  const fmt = (v: number | null | undefined, digits = 2) => (u === "r" ? fmtR(v, digits) : fmtUsd(v));
  const toggle = (id: WhatIfRuleId) => setRules((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  if (base.values.length === 0) {
    return (
      <Panel><EmptyState icon={FlaskConical} title="Нечего моделировать" description={u === "r" ? "В закрытых сделках нет R — заполните стоп и выход или R в карточке сделки." : "В закрытых сделках нет P&L."} /></Panel>
    );
  }

  const rows: { label: string; a: number | null; b: number | null; fmt: (v: number | null) => string; invert?: boolean; pct?: boolean }[] = [
    { label: `Итог, ${u === "r" ? "R" : "$ нетто"}`, a: base.kpis.total, b: alt.kpis.total, fmt: (v) => fmt(v, 1) },
    { label: "Сделок", a: base.kpis.n, b: alt.kpis.n, fmt: (v) => String(v ?? "—") },
    { label: "Win rate", a: base.kpis.winRate, b: alt.kpis.winRate, fmt: (v) => fmtPct(v), pct: true },
    { label: "Ожидание на сделку", a: base.kpis.expectancy, b: alt.kpis.expectancy, fmt: (v) => fmt(v) },
    { label: "Profit factor", a: base.kpis.profitFactor, b: alt.kpis.profitFactor, fmt: (v) => fmtPf(v) },
    { label: "Средний плюс", a: base.kpis.avgWin, b: alt.kpis.avgWin, fmt: (v) => fmt(v) },
    { label: "Средний минус", a: base.kpis.avgLoss, b: alt.kpis.avgLoss, fmt: (v) => fmt(v) },
    { label: "Макс. просадка", a: base.kpis.maxDrawdown, b: alt.kpis.maxDrawdown, fmt: (v) => fmt(v, 1) },
    { label: "Макс. серия убытков", a: base.kpis.maxLossStreak, b: alt.kpis.maxLossStreak, fmt: (v) => String(v ?? "—"), invert: true },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Panel title="Правила" description="Включите правило — кривая и показатели пересчитаются по тем же сделкам" icon={FlaskConical}>
        <ul className="flex flex-col gap-1.5">
          {WHAT_IF_RULES.map((r) => {
            const on = rules.has(r.id);
            const skipped = alt.skipped.find((s) => s.rule === r.id);
            return (
              <li key={r.id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => toggle(r.id)}
                  className={cn("flex w-full items-start gap-2 rounded-xl px-3 py-2 text-left transition-colors", on ? "bg-primary/10 ring-1 ring-primary/40" : "bg-[var(--glass-bg)] hover:bg-primary/5")}
                >
                  <span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border", on ? "border-primary bg-primary text-primary-foreground" : "border-border")} aria-hidden="true">
                    {on && <Check className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{r.label}{r.id === "dropWorstSetup" && on && alt.worstSetup ? `: ${alt.worstSetup}` : ""}</span>
                    <span className="block text-2xs text-muted-foreground">{skipped ? `Не применено — ${skipped.reason}` : r.hint}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {rules.size > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {alt.removed > 0 && <Pill tone="neutral">убрано {sdeal(alt.removed)}</Pill>}
            {alt.modified > 0 && <Pill tone="neutral">обрезано {sdeal(alt.modified)}</Pill>}
            {alt.removed === 0 && alt.modified === 0 && <Pill tone="neutral">правила ничего не изменили</Pill>}
          </div>
        )}
      </Panel>

      <div className="flex flex-col gap-4 lg:col-span-2">
        <Panel title="Кривая капитала: факт против «что если»" description={`${sdeal(base.kpis.n)} закрытых в хронологии закрытия · ${u === "r" ? "в R" : "в $ нетто"}`}>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="i" {...AXIS} />
                <YAxis {...AXIS} tickFormatter={(v: number) => (u === "r" ? `${v}R` : fmtUsd(v))} width={64} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(v: number) => fmt(v, 1)} labelFormatter={(i) => `Сделка ${i}`} />
                <Legend />
                <ReferenceLine y={0} stroke={GRID} />
                <Line type="monotone" dataKey="Факт" stroke="hsl(var(--muted-foreground))" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                <Line type="monotone" dataKey="Что если" stroke="hsl(var(--primary))" dot={false} strokeWidth={2} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Показатели рядом">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="py-1.5 text-left font-medium">Показатель</th>
                <th className="py-1.5 text-right font-medium">Факт</th>
                <th className="py-1.5 text-right font-medium">Что если</th>
                <th className="py-1.5 text-right font-medium">Δ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const d = r.a != null && r.b != null ? r.b - r.a : null;
                const tone = d == null || Math.abs(d) < 1e-9 ? "neutral" : toneOf(r.invert ? -d : d);
                return (
                  <tr key={r.label} className="border-t border-border/50 tabular-nums">
                    <td className="py-1.5">{r.label}</td>
                    <td className="py-1.5 text-right text-muted-foreground">{r.fmt(r.a)}</td>
                    <td className="py-1.5 text-right font-medium">{r.fmt(r.b)}</td>
                    <td className={cn("py-1.5 text-right", tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-muted-foreground")}>
                      {d == null ? "—" : r.pct ? `${fmtSigned(d * 100, 0)} п.п.` : r.label === "Сделок" || r.label.startsWith("Макс. серия") ? fmtSigned(d, 0) : r.label === "Profit factor" ? fmtSigned(d, 2) : fmt(d, 2)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-2xs text-muted-foreground">Правила применяются к прошлым сделкам как есть: они не учитывают, что без ранних входов вы могли бы взять другие сделки. «Убытки не хуже −1R» уменьшает и $ пропорционально.</p>
        </Panel>
      </div>
    </div>
  );
}

export type { ValueKpis };
