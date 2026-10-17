/** Multi-leg options strategy builder: presets, editable legs, payoff, max P/L, breakevens, net greeks. */
import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Calculator, Layers, Plus, RefreshCw, RotateCcw, Search, Trash2, X } from "lucide-react";
import { EmptyState, Panel, Pill, Segmented, StatCard } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  analyzePayoff, blackScholes, fetchQuote, netPremium, newLegId, num, positionGreeks,
  roundStrike, strikeStep, type Leg, type LegKind,
} from "./lib";
import { fmtNum, fmtPct, fmtUsd } from "@/lib/format";
import { MetricTile, NumField } from "./fields";
import { PayoffChart } from "./PayoffChart";
import { GreeksInWords } from "./BlackScholes";
import { OptTerm } from "./glossary";

export type LegDraft = { id: string; kind: LegKind; side: "buy" | "sell"; strike: string; premium: string; qty: string };
type Setter = (v: string) => void;
export type BuilderState = {
  symbol: string; setSymbol: Setter;
  spot: string; setSpot: Setter;
  days: string; setDays: Setter;
  iv: string; setIv: Setter;
  rate: string; setRate: Setter;
  legs: LegDraft[]; setLegs: Dispatch<SetStateAction<LegDraft[]>>;
};

type PresetId = "long_call" | "long_put" | "bull_call" | "bear_put" | "straddle" | "strangle" | "iron_condor" | "butterfly" | "covered_call" | "protective_put";
const PRESETS: { id: PresetId; label: string }[] = [
  { id: "long_call", label: "Long Call" },
  { id: "long_put", label: "Long Put" },
  { id: "bull_call", label: "Bull Call Spread" },
  { id: "bear_put", label: "Bear Put Spread" },
  { id: "straddle", label: "Straddle" },
  { id: "strangle", label: "Strangle" },
  { id: "iron_condor", label: "Iron Condor" },
  { id: "butterfly", label: "Butterfly" },
  { id: "covered_call", label: "Covered Call" },
  { id: "protective_put", label: "Protective Put" },
];

type Spec = { kind: LegKind; side: "buy" | "sell"; k: number; qty?: number };
function presetSpecs(id: PresetId, atm: number, w: number, spot: number): Spec[] {
  switch (id) {
    case "long_call": return [{ kind: "call", side: "buy", k: atm }];
    case "long_put": return [{ kind: "put", side: "buy", k: atm }];
    case "bull_call": return [{ kind: "call", side: "buy", k: atm }, { kind: "call", side: "sell", k: atm + w }];
    case "bear_put": return [{ kind: "put", side: "buy", k: atm }, { kind: "put", side: "sell", k: atm - w }];
    case "straddle": return [{ kind: "call", side: "buy", k: atm }, { kind: "put", side: "buy", k: atm }];
    case "strangle": return [{ kind: "call", side: "buy", k: atm + w }, { kind: "put", side: "buy", k: atm - w }];
    case "iron_condor": return [
      { kind: "put", side: "buy", k: atm - 2 * w }, { kind: "put", side: "sell", k: atm - w },
      { kind: "call", side: "sell", k: atm + w }, { kind: "call", side: "buy", k: atm + 2 * w },
    ];
    case "butterfly": return [{ kind: "call", side: "buy", k: atm - w }, { kind: "call", side: "sell", k: atm, qty: 2 }, { kind: "call", side: "buy", k: atm + w }];
    case "covered_call": return [{ kind: "stock", side: "buy", k: spot, qty: 100 }, { kind: "call", side: "sell", k: atm + w }];
    case "protective_put": return [{ kind: "stock", side: "buy", k: spot, qty: 100 }, { kind: "put", side: "buy", k: atm - w }];
  }
}

function toLeg(d: LegDraft): Leg | null {
  const strike = num(d.strike);
  const qty = Math.floor(num(d.qty));
  const premium = d.kind === "stock" ? 0 : num(d.premium);
  if (!(strike > 0) || !(qty >= 1) || !(premium >= 0)) return null;
  return { id: d.id, kind: d.kind, side: d.side, strike, premium, qty };
}

export default function StrategyBuilder({ b }: { b: BuilderState }) {
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<{ ok: boolean; text: string } | null>(null);

  const S = num(b.spot);
  const days = Math.max(0, num(b.days) || 0);
  const T = days / 365;
  const ivPct = Math.max(0, num(b.iv) || 0);
  const sigma = ivPct / 100;
  const ratePct = num(b.rate) || 0;
  const rr = ratePct / 100;

  const theo = useCallback((d: LegDraft) => {
    const k = num(d.strike);
    if (d.kind === "stock" || !(S > 0) || !(k > 0)) return NaN;
    return blackScholes(S, k, T, rr, sigma, d.kind).price;
  }, [S, T, rr, sigma]);

  const loadSpot = useCallback(async () => {
    const sym = b.symbol.trim().toUpperCase();
    if (!sym) return;
    setLoading(true); setInfo(null);
    try {
      const q = await fetchQuote(sym);
      if (q) { b.setSpot(q.price.toFixed(2)); setInfo({ ok: true, text: `${sym} ${fmtUsd(q.price)}` }); }
      else setInfo({ ok: false, text: "Тикер не найден или нет цены" });
    } catch {
      setInfo({ ok: false, text: "Не удалось загрузить цену" });
    } finally { setLoading(false); }
  }, [b]);

  function applyPreset(id: PresetId) {
    if (!(S > 0)) return;
    const step = strikeStep(S);
    const atm = roundStrike(S, step);
    const w = Math.max(step, roundStrike(S * 0.05, step));
    const drafts = presetSpecs(id, atm, w, S).filter((sp) => sp.k > 0).map<LegDraft>((sp) => {
      const prem = sp.kind === "stock" ? NaN : blackScholes(S, sp.k, T, rr, sigma, sp.kind).price;
      return {
        id: newLegId(), kind: sp.kind, side: sp.side,
        strike: String(+sp.k.toFixed(2)),
        premium: Number.isFinite(prem) ? String(+prem.toFixed(2)) : "",
        qty: String(sp.qty ?? 1),
      };
    });
    b.setLegs(drafts);
  }

  function update(id: string, patch: Partial<LegDraft>) {
    b.setLegs((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }
  function addLeg() {
    const step = S > 0 ? strikeStep(S) : 1;
    b.setLegs((ls) => [...ls, { id: newLegId(), kind: "call", side: "buy", strike: S > 0 ? String(roundStrike(S, step)) : "", premium: "", qty: "1" }]);
  }
  function repriceAll() {
    b.setLegs((ls) => ls.map((l) => {
      const t = theo(l);
      return Number.isFinite(t) ? { ...l, premium: String(+t.toFixed(2)) } : l;
    }));
  }

  const legs = useMemo(() => b.legs.map(toLeg).filter((l): l is Leg => l !== null), [b.legs]);
  const invalidCount = b.legs.length - legs.length;
  const stats = useMemo(() => {
    if (!legs.length || !(S > 0)) return null;
    const summary = analyzePayoff(legs, S, T, rr, sigma);
    const net = netPremium(legs);
    const g = positionGreeks(legs, S, T, rr, sigma);
    const rrRatio = summary.maxProfit != null && summary.maxLoss != null && summary.maxLoss > 0 ? summary.maxProfit / summary.maxLoss : null;
    return { summary, net, g, rrRatio };
  }, [legs, S, T, rr, sigma]);

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Базовый актив" icon={Layers} description="Параметры для теоретических премий и кривой «сегодня»"
        actions={
          <Button type="button" variant="ghost" size="sm" title="Вернуть значения по умолчанию"
            onClick={() => { b.setSpot("100"); b.setDays("30"); b.setIv("30"); b.setRate("4.5"); setInfo(null); }}>
            <RotateCcw aria-hidden="true" /> Сбросить
          </Button>
        }>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))] md:items-end">
          <div className="col-span-2 flex flex-col gap-1.5 md:col-span-1">
            <Label htmlFor="sb-ticker" className="text-xs font-normal text-muted-foreground">Тикер</Label>
            <div className="flex gap-2">
              <Input id="sb-ticker" value={b.symbol} autoComplete="off" placeholder="AAPL" className="h-9 uppercase"
                onChange={(e) => b.setSymbol(e.target.value.toUpperCase())}
                onKeyDown={(e) => { if (e.key === "Enter") void loadSpot(); }} />
              <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => void loadSpot()}
                disabled={loading || !b.symbol.trim()} aria-label="Загрузить цену тикера">
                {loading ? <RefreshCw className="animate-spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
              </Button>
            </div>
          </div>
          <NumField label="Спот" term="spot" prefix="$" value={b.spot} onChange={b.setSpot} error={!(S > 0) ? "Цена > 0" : undefined} />
          <NumField label="Дней" term="dte" value={b.days} onChange={b.setDays} integer />
          <NumField label="IV" term="iv" suffix="%" value={b.iv} onChange={b.setIv} />
          <NumField label="Ставка" term="rate" suffix="%" value={b.rate} onChange={b.setRate} />
        </div>
        {info && <p role="status" className={cn("mt-2 text-xs", info.ok ? "text-up" : "text-down")}>{info.text}</p>}
      </Panel>

      <Panel
        title="Ноги стратегии"
        description="Шаблон подставит страйки вокруг спота и теоретические премии — правьте под реальные цены"
        actions={b.legs.length > 0 ? (
          <>
            <Button type="button" variant="ghost" size="sm" onClick={repriceAll} disabled={!(S > 0)}>
              <Calculator aria-hidden="true" /> Премии по B-S
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => b.setLegs([])}>
              <Trash2 aria-hidden="true" /> Очистить
            </Button>
          </>
        ) : undefined}
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Шаблоны стратегий">
            {PRESETS.map((p) => (
              <button key={p.id} type="button" onClick={() => applyPreset(p.id)} disabled={!(S > 0)}
                className="chip inline-flex min-h-8 items-center px-3 text-xs font-medium disabled:opacity-50">
                {p.label}
              </button>
            ))}
          </div>

          {b.legs.length === 0 ? (
            <EmptyState icon={Layers} title="Нет ног" description="Выберите шаблон выше, добавьте ногу вручную или откройте стратегию из советника по цепочке."
              action={<Button type="button" variant="outline" onClick={addLeg}><Plus aria-hidden="true" /> Нога</Button>} />
          ) : (
            <>
              <ul className="flex flex-col gap-2">
                {b.legs.map((d, i) => {
                  const t = theo(d);
                  const bad = !toLeg(d);
                  return (
                    <li key={d.id} className={cn("grid grid-cols-2 gap-2 rounded-xl border bg-[var(--glass-bg)] p-3 sm:grid-cols-[auto_8rem_minmax(0,1fr)_minmax(0,1fr)_5.5rem_auto] sm:items-end",
                      bad ? "border-down/50" : "border-border/60")}>
                      <div className="col-span-2 flex items-center justify-between gap-2 sm:col-span-1 sm:flex-col sm:items-start sm:gap-1.5">
                        <span className="text-xs text-muted-foreground">Нога {i + 1}</span>
                        <Segmented<"buy" | "sell">
                          ariaLabel={`Нога ${i + 1}: покупка или продажа`}
                          size="sm"
                          value={d.side}
                          onChange={(v) => update(d.id, { side: v })}
                          options={[{ value: "buy", label: "Buy" }, { value: "sell", label: "Sell" }]}
                        />
                      </div>
                      <div className="flex min-w-0 flex-col gap-1.5">
                        <Label htmlFor={`leg-kind-${d.id}`} className="text-xs font-normal text-muted-foreground">Инструмент</Label>
                        <Select value={d.kind} onValueChange={(v) => update(d.id, { kind: v as LegKind, qty: v === "stock" && d.qty === "1" ? "100" : d.qty })}>
                          <SelectTrigger id={`leg-kind-${d.id}`} className="h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="call">Call</SelectItem>
                            <SelectItem value="put">Put</SelectItem>
                            <SelectItem value="stock">Акции</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <NumField label={d.kind === "stock" ? "Цена входа" : "Страйк"} prefix="$" value={d.strike} onChange={(v) => update(d.id, { strike: v })} />
                      <NumField label="Премия" term="premium" prefix="$" value={d.kind === "stock" ? "" : d.premium} disabled={d.kind === "stock"}
                        onChange={(v) => update(d.id, { premium: v })}
                        placeholder={d.kind === "stock" ? "—" : Number.isFinite(t) ? fmtNum(t, 2) : "0.00"}
                        hint={d.kind !== "stock" && Number.isFinite(t) ? `Теоретическая цена: ${fmtUsd(t)}` : undefined} />
                      <NumField label={d.kind === "stock" ? "Акций" : "Контр."} value={d.qty} integer onChange={(v) => update(d.id, { qty: v })} />
                      <Button type="button" variant="ghost" size="icon" className="h-9 w-9 self-end justify-self-end"
                        onClick={() => b.setLegs((ls) => ls.filter((l) => l.id !== d.id))} aria-label={`Удалить ногу ${i + 1}`}>
                        <X aria-hidden="true" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={addLeg}><Plus aria-hidden="true" /> Нога</Button>
                {invalidCount > 0 && <Pill tone="down">{invalidCount} с ошибкой — не учтены</Pill>}
              </div>
            </>
          )}
        </div>
      </Panel>

      {stats && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label={<OptTerm term="debit">{stats.net >= 0 ? "Дебет (платите)" : "Кредит (получаете)"}</OptTerm>} value={fmtUsd(Math.abs(stats.net), { decimals: 0 })} tone={stats.net >= 0 ? "neutral" : "up"}
              hint={legs.some((l) => l.kind === "stock") ? "без стоимости акций" : undefined} />
            <StatCard label="Макс. прибыль" value={stats.summary.maxProfit === null ? "без лимита" : fmtUsd(stats.summary.maxProfit, { decimals: 0 })} tone="up"
              hint={stats.rrRatio != null ? `R:R ${fmtNum(stats.rrRatio, 2)}` : undefined} />
            <StatCard label={<OptTerm term="maxLoss">Макс. убыток</OptTerm>} value={stats.summary.maxLoss === null ? "без лимита" : fmtUsd(-stats.summary.maxLoss, { decimals: 0 })} tone="down" />
            <StatCard label={<OptTerm term="probProfit">Шанс прибыли</OptTerm>} value={stats.summary.probProfit != null ? fmtPct(stats.summary.probProfit * 100, { decimals: 0, signed: false }) : "—"}
              hint={stats.summary.probProfit != null ? "лог-нормальная модель по IV" : "нужны дни и IV"} />
          </div>
          <Panel
            title={<OptTerm term="payoff">Диаграмма выплат</OptTerm>}
            description={stats.summary.breakevens.length ? `Безубыток: ${stats.summary.breakevens.map((x) => fmtUsd(x)).join(" / ")}` : "Нет точки безубытка в диапазоне"}
          >
            <div className="flex flex-col gap-4">
              <PayoffChart legs={legs} spot={S} days={days} ivPct={ivPct} ratePct={ratePct} breakevens={stats.summary.breakevens} />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <MetricTile label="Δ позиции" term="delta" value={fmtNum(stats.g.delta, 1)} sub={`${fmtUsd(stats.g.delta, { signed: true, decimals: 0 })} на $1 · ≈ акций`} />
                <MetricTile label="Γ позиции" term="gamma" value={fmtNum(stats.g.gamma, 2)} sub="изменение Δ на $1" />
                <MetricTile label="Θ / день" term="theta" value={fmtUsd(stats.g.theta, { signed: true, decimals: 0 })} tone={stats.g.theta >= 0 ? "text-up" : "text-down"} sub="распад времени" />
                <MetricTile label="Vega / +1% IV" term="vega" value={fmtUsd(stats.g.vega, { signed: true, decimals: 0 })} tone={stats.g.vega >= 0 ? "text-up" : "text-down"} sub="чувствительность к IV" />
              </div>
              <GreeksInWords delta={stats.g.delta} theta={stats.g.theta} vega={stats.g.vega} />
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
