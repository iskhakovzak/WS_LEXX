import { type ReactNode, useMemo, useState } from "react";
import { Link } from "wouter";
import { Check, ChevronDown, Plus, Receipt, Scissors, Target } from "lucide-react";
import { DataTable, Panel, Pill, SortableTh, TermTooltip, toneOf, useTableSort } from "@/components/ds";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { fmtUsd, pluralRu, sdeal } from "@/components/analytics-page/metrics";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import type { FeeGroupRow, FeesResponse, Preset } from "./api";

type EatenRow = FeesResponse["eaten"][number];
import { TARIFF_EXAMPLES } from "./presets";
import { type CommissionPlan, type PreviewTrade, type Rule, isApplied, planSummary } from "./rules";

function pct(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "—" : `${Math.round(v * 100)}%`;
}
const cents = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(1)} ¢`);
/** Fees in dollars with cents and thousands separators: «$106,170.95». */
export const usd2 = (v: number) => `$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** 0 → transparent, 1+ → full warn tint. Colour plus the number, never colour alone. */
function heat(v: number | null): string | undefined {
  if (v == null) return undefined;
  const a = Math.min(1, Math.max(0, v)) * 0.4;
  return `hsl(var(--warn) / ${a.toFixed(2)})`;
}

type PlanParams = Omit<CommissionPlan, "type">;
type PlanRow = { id: string; label: string; note?: string; plan: PlanParams | null };

/** Generic example tariffs for the comparison (shared with the «Другой тариф» question). */
const EXAMPLE_PLANS: PlanRow[] = TARIFF_EXAMPLES;

/**
 * Fees block: one clear headline («комиссии съедают X% брутто»), the break-even move per share, a plan comparison
 * computed in the browser with the same formula as the server engine, and the detailed breakdown on demand.
 */
export function FeesBlock({
  trades,
  data,
  isLoading,
  presets,
  rules,
  canApplyPlan,
  onApplyPlan,
}: {
  trades: PreviewTrade[];
  data: FeesResponse | undefined;
  isLoading: boolean;
  presets: Preset[];
  rules: Rule[];
  canApplyPlan: boolean;
  onApplyPlan: (r: CommissionPlan) => void;
}) {
  const fact = useMemo(() => planSummary(trades, null), [trades]);
  const [custom, setCustom] = useState({ perShare: "0.003", minPerOrder: "0.5", ecnPerShare: "0.002" });
  const customPlan = useMemo<PlanParams | null>(() => {
    const p = Number(custom.perShare), m = Number(custom.minPerOrder), e = Number(custom.ecnPerShare);
    return [p, m, e].every((x) => Number.isFinite(x) && x >= 0) ? { perShare: p, minPerOrder: m, ecnPerShare: e, keepRegulatory: true } : null;
  }, [custom]);

  const rows = useMemo<PlanRow[]>(() => {
    const fromPresets: PlanRow[] = [];
    for (const p of presets) {
      const r = p.rules.find((x): x is CommissionPlan => x.type === "commissionPlan");
      if (r && p.rules.length === 1) fromPresets.push({ id: `preset-${p.id}`, label: p.label, note: p.description, plan: { perShare: r.perShare, minPerOrder: r.minPerOrder, ecnPerShare: r.ecnPerShare, keepRegulatory: r.keepRegulatory } });
    }
    return [{ id: "fact", label: "Как сейчас", note: "фактические комиссии брокера", plan: null }, ...fromPresets, ...EXAMPLE_PLANS];
  }, [presets]);

  const eatenPct = fact.feePctOfGross;
  const grossPositive = fact.gross > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
            {grossPositive && eatenPct != null ? (
              <>Комиссии съедают <span className={cn("tabular-nums", eatenPct >= 0.5 ? "text-down" : eatenPct >= 0.25 ? "text-warn" : "text-foreground")}>{pct(eatenPct)}</span> <TermTooltip term="gross">брутто</TermTooltip></>
            ) : (
              <>Комиссии за период: <span className="tabular-nums">{usd2(fact.fees)}</span></>
            )}
          </p>
          <p className="mt-1 text-sm text-muted-foreground tabular-nums">
            Брутто {fmtUsd(fact.gross)} → нетто <span className={cn("font-medium", toneOf(fact.net) === "down" ? "text-down" : "text-foreground")}>{fmtUsd(fact.net)}</span>: брокер забрал {usd2(fact.fees)} за {sdeal(fact.trades)}
            {fact.trades ? ` (≈ ${usd2(fact.fees / fact.trades)} на сделку)` : ""}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-[var(--grid-gap)] md:grid-cols-3">
        <Fact
          icon={Target}
          title="Безубыток на акцию"
          value={cents(fact.breakEvenCents)}
          text={
            data?.breakEvenCents != null && data.typicalQty != null
              ? `Столько цена должна пройти в твою сторону, чтобы покрыть комиссию. При типичном размере ${Math.round(data.typicalQty)} акц. — ${cents(data.breakEvenCents)}.`
              : "Столько цена должна пройти в твою сторону, чтобы только покрыть комиссию."
          }
        />
        <Fact
          icon={Scissors}
          title="Съедено комиссией"
          value={isLoading || !data ? "…" : sdeal(data.eatenCount)}
          tone={data?.eatenCount ? "down" : undefined}
          text={data ? `Были в плюсе до комиссии и ушли в минус после.${data.feesOverGrossCount ? ` Ещё в ${data.feesOverGrossCount} ${pluralRu(data.feesOverGrossCount, "сделке", "сделках", "сделках")} комиссия больше всего хода.` : ""}` : "Сделки, которые были в плюсе до комиссии, а после — в минусе."}
        />
        <Fact
          icon={Receipt}
          title="Из чего состоит"
          value={data?.byType[0] ? `${data.byType[0].label} ${pct(data.byType[0].share)}` : "…"}
          text={data?.byType.length ? data.byType.slice(1, 4).map((b) => `${b.label} ${pct(b.share)}`).join(" · ") || "единственная статья" : "Комиссия, ECN и регуляторные сборы."}
        />
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold">Сравнить тарифы на твоих сделках</p>
        <DataTable ariaLabel="Сравнение тарифов">
          <table>
            <thead>
              <tr>
                <th scope="col">Тариф</th>
                <th scope="col" className="text-right">Комиссии</th>
                <th scope="col" className="text-right">Нетто</th>
                <th scope="col" className="text-right">от брутто</th>
                <th scope="col" className="text-right" title="Ход цены на акцию, который покрывает комиссию">Безубыток</th>
                <th scope="col" className="text-right">Разница</th>
                <th scope="col" className="w-0"><span className="sr-only">Действие</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <PlanTr key={row.id} row={row} trades={trades} fact={fact.net} rules={rules} canApply={canApplyPlan} onApply={onApplyPlan} />
              ))}
              <PlanTr
                row={{ id: "custom", label: "Свой тариф", plan: customPlan }}
                trades={trades}
                fact={fact.net}
                rules={rules}
                canApply={canApplyPlan}
                onApply={onApplyPlan}
                editor={
                  <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    $<Input aria-label="Цена за акцию, $" value={custom.perShare} onChange={(e) => setCustom((c) => ({ ...c, perShare: e.target.value }))} className="h-7 w-16 rounded-full px-2 text-xs tabular-nums" inputMode="decimal" />/акц.
                    мин. $<Input aria-label="Минимум за ордер, $" value={custom.minPerOrder} onChange={(e) => setCustom((c) => ({ ...c, minPerOrder: e.target.value }))} className="h-7 w-14 rounded-full px-2 text-xs tabular-nums" inputMode="decimal" />
                    ECN $<Input aria-label="ECN за акцию, $" value={custom.ecnPerShare} onChange={(e) => setCustom((c) => ({ ...c, ecnPerShare: e.target.value }))} className="h-7 w-16 rounded-full px-2 text-xs tabular-nums" inputMode="decimal" />
                  </span>
                }
              />
            </tbody>
          </table>
        </DataTable>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Регуляторные сборы (SEC, TAF и т. п.) остаются как были. Ордеров на сделку — по числу исполнений, минимум два. «Применить» добавляет тариф в сценарий выше.
        </p>
      </div>

      {data?.recommendations.length ? (
        <ul className="flex flex-col gap-1.5 text-sm">
          {data.recommendations.map((r, i) => <li key={i} className="rounded-xl bg-[var(--glass-bg)] px-3 py-2">{r}</li>)}
        </ul>
      ) : null}

      <FeeDetails data={data} isLoading={isLoading} />
    </div>
  );
}

function Fact({ icon: Icon, title, value, text, tone }: { icon: typeof Target; title: string; value: string; text: string; tone?: "down" }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl bg-[var(--glass-bg)] p-3">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="h-3.5 w-3.5" aria-hidden="true" />{title}</span>
      <span className={cn("text-lg font-semibold tabular-nums", tone === "down" ? "text-down" : "text-foreground")}>{value}</span>
      <span className="text-xs leading-snug text-muted-foreground">{text}</span>
    </div>
  );
}

function PlanTr({
  row, trades, fact, rules, canApply, onApply, editor,
}: {
  row: PlanRow; trades: PreviewTrade[]; fact: number; rules: Rule[]; canApply: boolean; onApply: (r: CommissionPlan) => void; editor?: ReactNode;
}) {
  const s = useMemo(() => planSummary(trades, row.plan), [trades, row.plan]);
  const d = row.plan ? s.net - fact : null;
  const rule: CommissionPlan | null = row.plan ? { type: "commissionPlan", ...row.plan, keepRegulatory: row.plan.keepRegulatory ?? true } : null;
  const applied = rule ? isApplied(rules, rule) : false;
  return (
    <tr className={cn("[&>td:not(:first-child)]:whitespace-nowrap", !row.plan && "bg-[var(--glass-bg)]")}>
      <td>
        <span className="font-medium">{row.label}</span>
        {row.note && <span className="block text-xs text-muted-foreground">{row.note}</span>}
        {editor}
      </td>
      <td className="text-right">{usd2(s.fees)}</td>
      <td className={cn("text-right font-medium", s.net > 0 ? "text-up" : s.net < 0 ? "text-down" : "")}>{fmtUsd(s.net)}</td>
      <td className="text-right">{s.gross > 0 ? pct(s.feePctOfGross) : "—"}</td>
      <td className="text-right">{cents(s.breakEvenCents)}</td>
      <td className={cn("text-right", d == null ? "text-muted-foreground" : d > 0 ? "text-up" : d < 0 ? "text-down" : "")}>{d == null ? "—" : fmtUsd(d)}</td>
      <td className="text-right">
        {rule && canApply && (
          <button
            type="button"
            disabled={applied}
            onClick={() => onApply(rule)}
            className={cn("inline-flex min-h-7 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-xs font-medium", applied ? "text-primary" : "chip")}
            aria-label={applied ? `Тариф «${row.label}» уже в сценарии` : `Применить тариф «${row.label}»`}
          >
            {applied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
            {applied ? "В сценарии" : "Применить"}
          </button>
        )}
      </td>
    </tr>
  );
}

type GroupRow = FeeGroupRow & { order: number };
const GROUP_ACCESSORS = {
  // Hidden key: server order (price / size / hold / hour buckets go in their natural order).
  order: (r: GroupRow) => r.order,
  key: (r: GroupRow) => r.key,
  trades: (r: GroupRow) => r.trades,
  gross: (r: GroupRow) => r.gross,
  fees: (r: GroupRow) => r.fees,
  net: (r: GroupRow) => r.net,
  feePct: (r: GroupRow) => r.feePctOfGross,
  breakEven: (r: GroupRow) => r.breakEvenCents,
  eaten: (r: GroupRow) => r.eatenWinners,
} as const;

function GroupTable({ title, rows, description, keyLabel, defaultSort = "order", maxHeight = 440 }: {
  title: string; rows: FeeGroupRow[]; description?: string; keyLabel: string; defaultSort?: "order" | "fees"; maxHeight?: number | string;
}) {
  const data = useMemo(() => rows.filter((r) => r.trades > 0).map((r, order) => ({ ...r, order })), [rows]);
  const { rows: sorted, thProps } = useTableSort(data, GROUP_ACCESSORS, defaultSort, defaultSort === "order" ? "asc" : "desc");
  return (
    <Panel title={title} description={description} padded={false} bodyClassName="p-2 sm:p-3">
      {data.length ? (
        <DataTable maxHeight={maxHeight} ariaLabel={title}>
          <table>
            <thead>
              <tr>
                <SortableTh {...thProps("key")}>{keyLabel}</SortableTh>
                <SortableTh {...thProps("trades")} align="right">Сделок</SortableTh>
                <SortableTh {...thProps("gross")} align="right">Брутто</SortableTh>
                <SortableTh {...thProps("fees")} align="right">Комиссии</SortableTh>
                <SortableTh {...thProps("net")} align="right">Нетто</SortableTh>
                <SortableTh {...thProps("feePct")} align="right"><span title="Комиссии / |брутто|">от брутто</span></SortableTh>
                <SortableTh {...thProps("breakEven")} align="right"><span title="Ход цены на акцию, который покрывает комиссию">Безубыток</span></SortableTh>
                <SortableTh {...thProps("eaten")} align="right"><span title="Были в плюсе до комиссии, после — в минусе">Съедено</span></SortableTh>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.key}>
                  <td className="whitespace-nowrap font-medium">{r.key}</td>
                  <td className="text-right">{r.trades}</td>
                  <td className={cn("text-right", r.gross > 0 ? "text-up" : r.gross < 0 ? "text-down" : "")}>{fmtUsd(r.gross)}</td>
                  <td className="text-right">{usd2(r.fees)}</td>
                  <td className={cn("text-right font-medium", r.net > 0 ? "text-up" : r.net < 0 ? "text-down" : "")}>{fmtUsd(r.net)}</td>
                  <td className="text-right" style={{ backgroundColor: heat(r.feePctOfGross) }}>{pct(r.feePctOfGross)}</td>
                  <td className="text-right">{cents(r.breakEvenCents)}</td>
                  <td className="text-right">{r.eatenWinners || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
      ) : (
        <p className="px-3 py-6 text-center text-sm text-muted-foreground">Нет данных</p>
      )}
    </Panel>
  );
}

function FeeDetails({ data, isLoading }: { data: FeesResponse | undefined; isLoading: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="inline-flex items-center gap-1.5 rounded-full px-1 text-sm font-medium text-primary hover:underline">
        <ChevronDown className={cn("h-4 w-4 transition-transform duration-[var(--dur-1)]", open && "rotate-180")} aria-hidden="true" />
        {open ? "Скрыть подробности" : "Где комиссии съедают больше всего — по цене, размеру, удержанию, часу и тикеру"}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3">
        {isLoading || !data ? (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-64 rounded-2xl" />)}</div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <GroupTable title="По цене акции" keyLabel="Цена входа" rows={data.byPrice} description="У дешёвых акций сборы съедают больше хода" />
              <GroupTable title="По размеру позиции" keyLabel="Размер" rows={data.bySize} description="Минимум за ордер бьёт по маленьким позициям" />
              <GroupTable title="По времени удержания" keyLabel="Удержание" rows={data.byHold} description="Короткие сделки: ход маленький, комиссия та же" />
              <GroupTable title="По часу входа (ET)" keyLabel="Час" rows={data.byHour} />
            </div>
            <GroupTable title="По тикеру (топ-25 по комиссиям)" keyLabel="Тикер" rows={data.byTicker} defaultSort="fees" maxHeight="60vh" />
            <Panel
              title="Сделки, которые съела комиссия"
              icon={Scissors}
              description={`${sdeal(data.eatenCount)}: в плюсе до комиссии, в минусе после${data.eatenCount > data.eaten.length ? ` (показаны ${data.eaten.length})` : ""}`}
              padded={false}
              bodyClassName="p-2 sm:p-3"
            >
              {data.eaten.length ? (
                <EatenTable rows={data.eaten} />
              ) : (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">Таких сделок нет</p>
              )}
            </Panel>
          </div>
        )}
        {data && data.byType.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {data.byType.map((b) => <Pill key={b.key} tone="neutral">{b.label} {usd2(b.amount)} · {pct(b.share)}</Pill>)}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

const EATEN_ACCESSORS = {
  day: (e: EatenRow) => e.day,
  ticker: (e: EatenRow) => e.ticker,
  qty: (e: EatenRow) => e.qty,
  gross: (e: EatenRow) => e.gross,
  fees: (e: EatenRow) => e.fees,
  net: (e: EatenRow) => e.net,
} as const;

function EatenTable({ rows }: { rows: EatenRow[] }) {
  const { rows: sorted, thProps } = useTableSort(rows, EATEN_ACCESSORS, "day");
  return (
    <DataTable maxHeight="60vh" ariaLabel="Сделки, съеденные комиссией">
      <table>
        <thead>
          <tr>
            <SortableTh {...thProps("day")}>Дата</SortableTh>
            <SortableTh {...thProps("ticker")}>Тикер</SortableTh>
            <SortableTh {...thProps("qty")} align="right">Акций</SortableTh>
            <SortableTh {...thProps("gross")} align="right">Брутто</SortableTh>
            <SortableTh {...thProps("fees")} align="right">Комиссии</SortableTh>
            <SortableTh {...thProps("net")} align="right">Нетто</SortableTh>
          </tr>
        </thead>
        <tbody>
          {sorted.map((e) => (
            <tr key={e.id}>
              <td className="whitespace-nowrap">{e.day}</td>
              <td><Link href={links.trade(e.id)} className="font-medium text-primary underline-offset-4 hover:underline">{e.ticker}</Link></td>
              <td className="text-right">{e.qty ?? "—"}</td>
              <td className="text-right text-up">{fmtUsd(e.gross)}</td>
              <td className="text-right">{usd2(e.fees)}</td>
              <td className="text-right font-medium text-down">{fmtUsd(e.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataTable>
  );
}
