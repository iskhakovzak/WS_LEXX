/**
 * «Корректировки брокера»: PropReports cash adjustments of one trader (or the desk) by day — fees outside the fills,
 * transfers, other P&L items — and the net P&L / equity change including them. Small card, one line to mount:
 *   <BrokerAdjustmentsCard trader={name} from={from} to={to} />
 * (trader omitted: the viewer's own book; staff may pass any trader or null for the whole desk).
 */
import * as React from "react";
import { Receipt } from "lucide-react";
import { DataTable, EmptyState, Panel, Pill, Segmented, StatCard, StatGrid, toneOf, type Tone } from "@/components/ds";
import { fmtDate, fmtUsd } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { propreportsAccuracyI18n } from "@/i18n/ns/propreportsAccuracy";
import { useAdjustmentDays, type AdjustmentKind } from "./reconcile-broker-api";

const KIND_TONE: Record<AdjustmentKind, Tone> = { fee: "warn", transfer: "accent", other: "neutral" };

type Tab = "days" | "items";

export function BrokerAdjustmentsCard({ trader, from, to }: { trader?: string | null; from?: string | null; to?: string | null }) {
  const { t } = propreportsAccuracyI18n.useT();
  const [tab, setTab] = React.useState<Tab>("days");
  const q = useAdjustmentDays({ trader, from, to });
  const data = q.data;
  const totals = data?.totals;
  const daysWithAdj = (data?.days ?? []).filter((d) => d.count > 0);
  return (
    <Panel title={t("adjustments.title")} description={t("adjustments.description")} icon={Receipt}>
      <StatGrid min="9rem">
        <StatCard label={t("adjustments.tradeNet")} value={fmtUsd(totals?.tradeNet, { signed: true })} tone={toneOf(totals?.tradeNet)} loading={q.isLoading} />
        <StatCard label={t("adjustments.fees")} value={fmtUsd(totals?.fees, { signed: true })} tone={toneOf(totals?.fees)} hint={t("adjustments.feesHint")} loading={q.isLoading} />
        <StatCard label={t("adjustments.netWithAdj")} value={fmtUsd(totals?.netWithAdjustments, { signed: true })} tone={toneOf(totals?.netWithAdjustments)} loading={q.isLoading} />
        <StatCard label={t("adjustments.transfers")} value={fmtUsd(totals?.transfers, { signed: true })} hint={t("adjustments.transfersHint")} loading={q.isLoading} />
        <StatCard label={t("adjustments.equity")} value={fmtUsd(totals?.equityDelta, { signed: true })} tone={toneOf(totals?.equityDelta)} loading={q.isLoading} />
      </StatGrid>

      {q.isLoading ? (
        <div className="py-6 text-center text-sm text-muted-foreground">{commonI18n.t("states.loading")}</div>
      ) : !data?.items.length ? (
        <EmptyState icon={Receipt} title={t("adjustments.empty")} description={t("adjustments.emptyHint")} />
      ) : (
        <div className="mt-3 grid gap-2">
          <Segmented<Tab>
            size="sm"
            ariaLabel={t("adjustments.title")}
            value={tab}
            onChange={setTab}
            options={[{ value: "days", label: t("adjustments.days") }, { value: "items", label: t("adjustments.items") }]}
          />
          {tab === "days" ? (
            <DataTable maxHeight="50vh" ariaLabel={t("adjustments.days")} className="[&_tbody_td]:px-2 [&_thead_th]:px-2">
              <table>
                <thead>
                  <tr>
                    <th className="text-left">{t("adjustments.col.date")}</th>
                    <th className="text-right">{t("adjustments.tradeNet")}</th>
                    <th className="text-right">{t("adjustments.fees")}</th>
                    <th className="text-right">{t("adjustments.other")}</th>
                    <th className="text-right">{t("adjustments.netWithAdj")}</th>
                    <th className="text-right">{t("adjustments.transfers")}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...daysWithAdj].reverse().map((d) => (
                    <tr key={d.date}>
                      <td className="whitespace-nowrap">{fmtDate(d.date, "short")}</td>
                      <td className="text-right tabular-nums">{fmtUsd(d.tradeNet, { signed: true })}</td>
                      <td className="text-right tabular-nums">{fmtUsd(d.fees, { signed: true })}</td>
                      <td className="text-right tabular-nums">{fmtUsd(d.other, { signed: true })}</td>
                      <td className="text-right font-medium tabular-nums">{fmtUsd(d.netWithAdjustments, { signed: true })}</td>
                      <td className="text-right tabular-nums">{fmtUsd(d.transfers, { signed: true })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataTable>
          ) : (
            <DataTable maxHeight="50vh" ariaLabel={t("adjustments.items")} className="[&_tbody_td]:px-2 [&_thead_th]:px-2">
              <table>
                <thead>
                  <tr>
                    <th className="text-left">{t("adjustments.col.date")}</th>
                    <th className="text-left">{t("adjustments.col.account")}</th>
                    <th className="text-left">{t("adjustments.col.category")}</th>
                    <th className="text-left">{t("adjustments.col.kind")}</th>
                    <th className="text-right">{t("adjustments.col.amount")}</th>
                    <th className="text-left">{t("adjustments.col.comment")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((a) => (
                    <tr key={a.id}>
                      <td className="whitespace-nowrap">{fmtDate(a.date, "short")}</td>
                      <td className="whitespace-nowrap">{a.account}</td>
                      <td>{a.category}{a.symbol ? ` · ${a.symbol}` : ""}</td>
                      <td><Pill tone={KIND_TONE[a.kind]}>{t(`adjustments.kind.${a.kind}`)}</Pill></td>
                      <td className="text-right tabular-nums">{fmtUsd(a.amount, { signed: true })}</td>
                      <td className="max-w-[16rem] truncate text-muted-foreground" title={a.comment ?? undefined}>{a.comment ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataTable>
          )}
          {data.itemsTruncated && <p className="text-2xs text-muted-foreground">{t("adjustments.truncated", { count: data.items.length })}</p>}
        </div>
      )}
    </Panel>
  );
}
