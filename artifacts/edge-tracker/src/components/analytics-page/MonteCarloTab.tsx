import { useEffect, useMemo, useRef, useState } from "react";
import type { Trade } from "@workspace/api-client-react";
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { Dices, RefreshCw } from "lucide-react";
import { Panel, StatCard, StatGrid, Segmented, EmptyState, Pill, toneOf } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { type Unit, type AnalyticsFilters, CHART_TOOLTIP_STYLE, AXIS, GRID } from "./metrics";
import { fmtCount, fmtR, fmtRate, fmtUsd } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { toSimTrades, useRiskLimits } from "./edge-api";
import { monteCarlo, hashSeed, type MonteCarloInput, type MonteCarloResult } from "./edge-stats";
import type { McRequest, McResponse } from "./mc.worker";

const HORIZONS = [50, 100, 250, 500] as const;
const R_DAILY = ["0", "2", "3", "5"] as const;
const R_RUIN = ["0", "10", "20", "50"] as const;

/** Runs Monte Carlo in a module Web Worker; falls back to a deferred main-thread run when workers are unavailable. */
function useMonteCarlo(input: MonteCarloInput | null) {
  const [state, setState] = useState<{ result: MonteCarloResult | null; busy: boolean; mode: "worker" | "main" }>({ result: null, busy: false, mode: "worker" });
  const workerRef = useRef<Worker | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    try {
      workerRef.current = new Worker(new URL("./mc.worker.ts", import.meta.url), { type: "module" });
    } catch {
      workerRef.current = null;
    }
    return () => { workerRef.current?.terminate(); workerRef.current = null; };
  }, []);

  useEffect(() => {
    if (!input) { setState((s) => ({ ...s, result: null, busy: false })); return; }
    const id = ++reqId.current;
    setState((s) => ({ ...s, busy: true }));
    const w = workerRef.current;
    if (w) {
      const onMsg = (e: MessageEvent<McResponse>) => {
        if (e.data.id !== id) return;
        setState({ result: e.data.result, busy: false, mode: "worker" });
        w.removeEventListener("message", onMsg);
      };
      const onErr = () => {
        w.removeEventListener("message", onMsg);
        w.removeEventListener("error", onErr);
        workerRef.current = null;
        const t = setTimeout(() => setState({ result: monteCarlo(input), busy: false, mode: "main" }), 0);
        return () => clearTimeout(t);
      };
      w.addEventListener("message", onMsg);
      w.addEventListener("error", onErr, { once: true });
      w.postMessage({ id, input } satisfies McRequest);
      return () => { w.removeEventListener("message", onMsg); w.removeEventListener("error", onErr); };
    }
    const t = setTimeout(() => { if (reqId.current === id) setState({ result: monteCarlo(input), busy: false, mode: "main" }); }, 0);
    return () => clearTimeout(t);
  }, [input]);

  return state;
}

export function MonteCarloTab({ trades, unit, filters }: { trades: Trade[]; unit: Unit | null; filters: AnalyticsFilters }) {
  const u: Unit = unit ?? "r";
  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number]>(100);
  const [runs, setRuns] = useState<1000 | 5000>(1000);
  const [tpdMode, setTpdMode] = useState<"auto" | "1" | "2" | "3" | "5">("auto");
  const [rDaily, setRDaily] = useState<(typeof R_DAILY)[number]>("3");
  const [rRuin, setRRuin] = useState<(typeof R_RUIN)[number]>("20");
  const [seedBump, setSeedBump] = useState(0);
  const { data: limits, isLoading: limitsLoading } = useRiskLimits();

  const sim = useMemo(() => toSimTrades(trades), [trades]);
  const values = useMemo(() => sim.map((t) => (u === "r" ? t.r : t.net)).filter((v): v is number => v != null), [sim, u]);
  const autoTpd = useMemo(() => {
    const days = new Map<string, number>();
    for (const t of sim) days.set(t.day, (days.get(t.day) ?? 0) + 1);
    const counts = [...days.values()].sort((a, b) => a - b);
    return counts.length ? Math.max(1, counts[Math.floor(counts.length / 2)]) : 1;
  }, [sim]);
  const tradesPerDay = tpdMode === "auto" ? autoTpd : Number(tpdMode);

  const usdLimits = u === "usd" ? limits ?? null : null;
  const dailyLimit = u === "usd" ? usdLimits?.dailyLossLimit ?? null : Number(rDaily) || null;
  const weeklyLimit = u === "usd" ? usdLimits?.weeklyLossLimit ?? null : dailyLimit ? dailyLimit * 2.5 : null;
  const ruinLevel = u === "usd" ? usdLimits?.maxDrawdown ?? usdLimits?.accountSize ?? null : Number(rRuin) || null;

  const input = useMemo<MonteCarloInput | null>(() => {
    if (values.length < 2) return null;
    return {
      values, horizon, runs, tradesPerDay,
      dailyLossLimit: dailyLimit, weeklyLossLimit: weeklyLimit, ruinLevel,
      seed: hashSeed(`${filters.trader}|${filters.period}|${u}|${values.length}|${seedBump}`),
    };
  }, [values, horizon, runs, tradesPerDay, dailyLimit, weeklyLimit, ruinLevel, filters.trader, filters.period, u, seedBump]);

  const { result, busy, mode } = useMonteCarlo(input);
  const fmt = (v: number | null | undefined, digits = 1) => (u === "r" ? fmtR(v, digits) : fmtUsd(v, { signed: true, decimals: "auto" }));

  if (values.length < 2) {
    return <Panel><EmptyState icon={Dices} title="Мало данных для симуляции" description={`Нужно хотя бы 2 закрытые сделки с ${u === "r" ? "R" : "P&L"}. Сейчас — ${values.length}.`} /></Panel>;
  }

  const chart = result?.bands.map((b) => ({ i: b.i, p5: b.p5, p95: b.p95, p25: b.p25, p75: b.p75, p50: b.p50, outer: [b.p5, b.p95], inner: [b.p25, b.p75] })) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Монте-Карло: следующие N сделок"
        description={`Перемешиваем ${commonI18n.t("units.trades", { count: values.length })} закрытых (${u === "r" ? "R" : "$ нетто"}) с возвратом — ${fmtCount(runs)} прогонов, фиксированное зерно${mode === "main" ? " · без Web Worker" : ""}`}
        icon={Dices}
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Сделок вперёд</span>
          <Segmented<string> ariaLabel="Горизонт симуляции" size="sm" options={HORIZONS.map((h) => ({ value: String(h), label: String(h) }))} value={String(horizon)} onChange={(v) => setHorizon(Number(v) as (typeof HORIZONS)[number])} />
          <span className="text-xs text-muted-foreground">Прогонов</span>
          <Segmented<string> ariaLabel="Число прогонов" size="sm" options={[{ value: "1000", label: "1 000" }, { value: "5000", label: "5 000" }]} value={String(runs)} onChange={(v) => setRuns(v === "5000" ? 5000 : 1000)} />
          <span className="text-xs text-muted-foreground">Сделок в день</span>
          <Segmented<"auto" | "1" | "2" | "3" | "5"> ariaLabel="Сделок в день" size="sm" options={[{ value: "auto", label: `авто (${autoTpd})` }, { value: "1", label: "1" }, { value: "2", label: "2" }, { value: "3", label: "3" }, { value: "5", label: "5" }]} value={tpdMode} onChange={setTpdMode} />
          {u === "r" ? (
            <>
              <span className="text-xs text-muted-foreground">Дневной лимит</span>
              <Segmented<(typeof R_DAILY)[number]> ariaLabel="Дневной лимит убытка в R" size="sm" options={R_DAILY.map((v) => ({ value: v, label: v === "0" ? "нет" : `−${v}R` }))} value={rDaily} onChange={setRDaily} />
              <span className="text-xs text-muted-foreground">Разорение</span>
              <Segmented<(typeof R_RUIN)[number]> ariaLabel="Уровень разорения в R" size="sm" options={R_RUIN.map((v) => ({ value: v, label: v === "0" ? "нет" : `−${v}R` }))} value={rRuin} onChange={setRRuin} />
            </>
          ) : limitsLoading ? (
            <Skeleton className="h-6 w-40 rounded-full" />
          ) : usdLimits && (usdLimits.dailyLossLimit || usdLimits.weeklyLossLimit || usdLimits.maxDrawdown || usdLimits.accountSize) ? (
            <Pill tone="accent">лимиты из риск-деска: день {usdLimits.dailyLossLimit ? fmtUsd(-usdLimits.dailyLossLimit, { signed: true, decimals: "auto" }) : "—"} · неделя {usdLimits.weeklyLossLimit ? fmtUsd(-usdLimits.weeklyLossLimit, { signed: true, decimals: "auto" }) : "—"} · просадка {usdLimits.maxDrawdown ? fmtUsd(-usdLimits.maxDrawdown, { signed: true, decimals: "auto" }) : usdLimits.accountSize ? fmtUsd(-usdLimits.accountSize, { signed: true, decimals: "auto" }) : "—"}</Pill>
          ) : (
            <Pill tone="neutral">лимиты не заданы — вероятности лимитов недоступны в $; переключитесь на R</Pill>
          )}
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setSeedBump((s) => s + 1)} aria-label="Пересчитать с другим зерном"><RefreshCw aria-hidden="true" /> Другое зерно</Button>
        </div>

        {busy && !result ? (
          <Skeleton className="h-[280px] rounded-xl" />
        ) : result ? (
          <div className={busy ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={busy}>
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="i" {...AXIS} />
                  <YAxis {...AXIS} tickFormatter={(v: number) => (u === "r" ? `${v}R` : fmtUsd(v, { signed: true, decimals: "auto" }))} width={64} />
                  <Tooltip
                    contentStyle={CHART_TOOLTIP_STYLE}
                    labelFormatter={(i) => `Через ${i} сделок`}
                    formatter={(v: number | number[], name: string) => [Array.isArray(v) ? `${fmt(v[0])} … ${fmt(v[1])}` : fmt(v), name === "outer" ? "5–95%" : name === "inner" ? "25–75%" : "Медиана"]}
                  />
                  <ReferenceLine y={0} stroke={GRID} />
                  {ruinLevel != null && <ReferenceLine y={-ruinLevel} stroke="hsl(var(--down))" strokeDasharray="4 4" label={{ value: "разорение", fill: "hsl(var(--down))", fontSize: 10, position: "insideBottomRight" }} />}
                  <Area type="monotone" dataKey="outer" stroke="none" fill="hsl(var(--primary))" fillOpacity={0.12} isAnimationActive={false} />
                  <Area type="monotone" dataKey="inner" stroke="none" fill="hsl(var(--primary))" fillOpacity={0.22} isAnimationActive={false} />
                  <Line type="monotone" dataKey="p50" stroke="hsl(var(--primary))" dot={false} strokeWidth={2} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <StatGrid className="mt-4">
              <StatCard label={`Медиана через ${horizon}`} value={fmt(result.final.p50)} tone={toneOf(result.final.p50)} hint={`5%: ${fmt(result.final.p5)} · 95%: ${fmt(result.final.p95)}`} />
              <StatCard label="Шанс быть в плюсе" value={fmtRate(result.probProfit)} tone={result.probProfit >= 0.7 ? "up" : result.probProfit >= 0.5 ? "warn" : "down"} hint={`исторически: ожидание ${fmt(result.input.mean, 2)}, WR ${fmtRate(result.input.winRate)}`} />
              <StatCard label="Дневной лимит" value={result.probDailyLimit == null ? "—" : fmtRate(result.probDailyLimit)} tone={result.probDailyLimit == null ? "neutral" : result.probDailyLimit > 0.5 ? "down" : result.probDailyLimit > 0.2 ? "warn" : "up"} hint={result.probDailyLimit == null ? "лимит не задан" : `хотя бы раз за ${Math.ceil(horizon / result.tradesPerDay)} дн. · в среднем ${result.limitDaysPerRun?.toFixed(1)} дн. на прогон`} />
              <StatCard label="Недельный лимит" value={result.probWeeklyLimit == null ? "—" : fmtRate(result.probWeeklyLimit)} tone={result.probWeeklyLimit == null ? "neutral" : result.probWeeklyLimit > 0.3 ? "down" : result.probWeeklyLimit > 0.1 ? "warn" : "up"} hint={result.probWeeklyLimit == null ? "лимит не задан" : u === "r" ? `лимит ${fmtR(-(weeklyLimit ?? 0), 1)} (2.5 × дневного)` : "по риск-деску"} />
              <StatCard label="Риск разорения" value={result.probRuin == null ? "—" : fmtRate(result.probRuin, 1)} tone={result.probRuin == null ? "neutral" : result.probRuin > 0.1 ? "down" : result.probRuin > 0.02 ? "warn" : "up"} hint={ruinLevel != null ? `капитал опустится ниже ${fmt(-ruinLevel, 0)}` : "уровень не задан"} />
              <StatCard label="Макс. просадка" value={fmt(result.maxDrawdown.p50)} tone="down" hint={`медиана · худшие 5%: ${fmt(result.maxDrawdown.p95)} · худший: ${fmt(result.maxDrawdown.worst)}`} />
              <StatCard label="Серия убытков" value={`${result.maxLossStreak.p50}`} hint={`медиана · 95%: ${result.maxLossStreak.p95} · худшая: ${result.maxLossStreak.worst}`} />
            </StatGrid>
            <p className="mt-3 text-2xs text-muted-foreground">
              Бутстрэп по прошлым сделкам: считаем их независимыми и одинаково распределёнными, поэтому реальные хвосты обычно тяжелее. Лента — 5–95% и 25–75% по {fmtCount(runs)} прогонам. День = {result.tradesPerDay} сд. подряд, неделя = 5 дней.
            </p>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
