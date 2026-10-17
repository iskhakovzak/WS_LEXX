import { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { Receipt, RefreshCw } from "lucide-react";
import { Panel, StatCard, StatGrid, Segmented, EmptyState, SortableTh, TableScroll, toneOf, useTableSort } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { type AnalyticsFilters, fmtUsd, fmtPct, sdeal, CHART_TOOLTIP_STYLE, CHART_CURSOR, AXIS, GRID } from "./metrics";
import { type EdgeCostGroup, type EdgeCostRow, useEdgeCosts, edgeKeyLabel } from "./edge-api";

const GROUP_LABEL: Record<EdgeCostGroup, string> = { trader: "Трейдер", account: "Счёт", month: "Месяц", setup: "Сетап", horizon: "Горизонт" };

const money = (v: number | null | undefined, digits = 2) => (v == null || !Number.isFinite(v) ? "—" : `$${Math.abs(v).toFixed(digits)}`);

export function CostsTab({ filters, isCurator }: { filters: AnalyticsFilters; isCurator: boolean }) {
  const [group, setGroup] = useState<EdgeCostGroup>(isCurator ? "trader" : "account");
  const { data, isLoading, isError, refetch } = useEdgeCosts(filters, group);
  const groups = (Object.keys(GROUP_LABEL) as EdgeCostGroup[]).filter((g) => isCurator || g !== "trader");

  const t = data?.total;
  const noPnl = !!data && t && t.tradesWithPnl === 0;

  return (
    <div className="flex flex-col gap-4">
      {isError ? (
        <Panel><EmptyState icon={Receipt} title="Не удалось загрузить издержки" description="Сервер не ответил." action={<Button variant="outline" onClick={() => void refetch()}><RefreshCw aria-hidden="true" /> Повторить</Button>} /></Panel>
      ) : isLoading || !data || !t ? (
        <StatGrid>{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[96px] rounded-2xl" />)}</StatGrid>
      ) : noPnl ? (
        <Panel>
          <EmptyState icon={Receipt} title="Нет сделок с P&L" description="Издержки считаются по сделкам с P&L и комиссиями. Пока таких сделок под фильтры нет." />
        </Panel>
      ) : (
        <>
          <StatGrid>
            <StatCard label="P&L брутто" value={fmtUsd(t.gross)} tone={toneOf(t.gross)} hint={`${sdeal(t.tradesWithPnl)} с P&L`} />
            <StatCard label="Комиссии" value={t.fees ? `−${money(t.fees, 0)}` : "$0"} tone={t.fees ? "down" : "neutral"} hint={t.tradesWithFees ? `${sdeal(t.tradesWithFees)} с комиссией` : "комиссии не заполнены"} />
            <StatCard label="P&L нетто" value={fmtUsd(t.net)} tone={toneOf(t.net)} hint="брутто − комиссии" />
            <StatCard label="Съедено от прибыли" value={fmtPct(t.feePctOfGrossWins, 1)} tone={t.feePctOfGrossWins == null ? "neutral" : t.feePctOfGrossWins > 0.3 ? "down" : t.feePctOfGrossWins > 0.15 ? "warn" : "up"} hint={t.feePctOfGrossWins == null ? "нет прибыльных сделок" : `комиссии / Σ прибыльных брутто · от |итога| ${fmtPct(t.feePctOfGross, 1)}`} />
            <StatCard label="На сделку / на акцию" value={`${money(t.feePerTrade)} · ${t.feePerShare != null ? `${(t.feePerShare * 100).toFixed(2)}¢` : "—"}`} hint={t.shares ? `${Math.round(t.shares).toLocaleString("en-US")} акций` : "объём (qty) не заполнен"} />
            <StatCard label="Проскальзывание" value={t.slippageAvg != null ? `${t.slippageAvg.toFixed(2)}` : "—"} hint={t.slippageN ? `среднее по ${sdeal(t.slippageN)} · Σ ${t.slippageSum.toFixed(2)}` : "поле slippage пустое"} />
          </StatGrid>

          <Panel title="Брутто против нетто" description="Сколько комиссии забирают из результата в каждой группе" icon={Receipt}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Segmented<EdgeCostGroup> ariaLabel="Группировка" size="sm" options={groups.map((g) => ({ value: g, label: GROUP_LABEL[g] }))} value={group} onChange={setGroup} />
            </div>
            {data.items.length === 0 ? (
              <EmptyState icon={Receipt} title="Нет данных" description="Под фильтры не попало ни одной сделки." />
            ) : (
              <>
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.items.map((r) => ({ key: edgeKeyLabel(group, r.key, 30), Брутто: r.gross, Нетто: r.net, Комиссии: -r.fees }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke={GRID} vertical={false} />
                      <XAxis dataKey="key" {...AXIS} interval={0} angle={data.items.length > 8 ? -20 : 0} height={data.items.length > 8 ? 48 : 24} />
                      <YAxis {...AXIS} tickFormatter={(v: number) => fmtUsd(v)} width={64} />
                      <Tooltip contentStyle={CHART_TOOLTIP_STYLE} cursor={CHART_CURSOR} formatter={(v: number) => fmtUsd(v)} />
                      <ReferenceLine y={0} stroke={GRID} />
                      <Bar dataKey="Брутто" fill="hsl(var(--muted-foreground) / 0.45)" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Нетто" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="Комиссии" fill="hsl(var(--down))" radius={[0, 0, 4, 4]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <CostsTable key={group} group={group} items={data.items} />
              </>
            )}
            <p className="mt-2 text-2xs text-muted-foreground">Нетто = брутто − |комиссии|. «% от прибыли» — комиссии относительно суммы прибыльных сделок до комиссий: сколько заработанного уходит брокеру. Сделки без P&L в суммы не входят.</p>
          </Panel>
        </>
      )}
    </div>
  );
}

type CostRow = EdgeCostRow & { order: number };
const COST_ACCESSORS = {
  // Hidden key: server order (chronological for months, natural for horizons).
  order: (r: CostRow) => r.order,
  key: (r: CostRow) => r.key,
  trades: (r: CostRow) => r.tradesWithPnl,
  gross: (r: CostRow) => r.gross,
  fees: (r: CostRow) => r.fees,
  net: (r: CostRow) => r.net,
  feePct: (r: CostRow) => r.feePctOfGrossWins,
  perTrade: (r: CostRow) => r.feePerTrade,
  perShare: (r: CostRow) => r.feePerShare,
  slippage: (r: CostRow) => r.slippageAvg,
} as const;

const TH = "px-2 py-1.5 font-medium";

/** Gross vs net per group; sortable headers (months / horizons keep their natural order until a header is clicked). */
function CostsTable({ group, items }: { group: EdgeCostGroup; items: EdgeCostRow[] }) {
  const indexed = useMemo(() => items.map((r, order) => ({ ...r, order })), [items]);
  const natural = group === "month" || group === "horizon";
  const { rows, thProps } = useTableSort(indexed, COST_ACCESSORS, natural ? "order" : "net", natural ? "asc" : "desc");
  return (
    <TableScroll className="mt-3">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground">
            <SortableTh {...thProps("key")} className={cn(TH, "text-left")}>{GROUP_LABEL[group]}</SortableTh>
            <SortableTh {...thProps("trades")} align="right" className={TH}>Сделок</SortableTh>
            <SortableTh {...thProps("gross")} align="right" className={TH}>Брутто</SortableTh>
            <SortableTh {...thProps("fees")} align="right" className={TH}>Комиссии</SortableTh>
            <SortableTh {...thProps("net")} align="right" className={TH}>Нетто</SortableTh>
            <SortableTh {...thProps("feePct")} align="right" className={TH}>% от прибыли</SortableTh>
            <SortableTh {...thProps("perTrade")} align="right" className={TH}>$/сделка</SortableTh>
            <SortableTh {...thProps("perShare")} align="right" className={TH}>¢/акция</SortableTh>
            <SortableTh {...thProps("slippage")} align="right" className={TH}>Проскальз.</SortableTh>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-border/50 tabular-nums">
              <td className="px-2 py-1.5 font-medium">{edgeKeyLabel(group, r.key, 30)}</td>
              <td className="px-2 py-1.5 text-right text-muted-foreground">{r.tradesWithPnl}<span className="text-muted-foreground/60"> / {r.trades}</span></td>
              <td className={cn("px-2 py-1.5 text-right", toneOf(r.gross) === "up" ? "text-up" : toneOf(r.gross) === "down" ? "text-down" : "text-muted-foreground")}>{fmtUsd(r.gross)}</td>
              <td className="px-2 py-1.5 text-right text-muted-foreground">{r.fees ? `−${money(r.fees, r.fees >= 100 ? 0 : 2)}` : "—"}</td>
              <td className={cn("px-2 py-1.5 text-right font-medium", toneOf(r.net) === "up" ? "text-up" : toneOf(r.net) === "down" ? "text-down" : "text-muted-foreground")}>{fmtUsd(r.net)}</td>
              <td className={cn("px-2 py-1.5 text-right", r.feePctOfGrossWins != null && r.feePctOfGrossWins > 0.3 ? "text-down" : "text-muted-foreground")}>{fmtPct(r.feePctOfGrossWins, 1)}</td>
              <td className="px-2 py-1.5 text-right text-muted-foreground">{money(r.feePerTrade)}</td>
              <td className="px-2 py-1.5 text-right text-muted-foreground">{r.feePerShare != null ? (r.feePerShare * 100).toFixed(2) : "—"}</td>
              <td className="px-2 py-1.5 text-right text-muted-foreground">{r.slippageAvg != null ? r.slippageAvg.toFixed(2) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}
