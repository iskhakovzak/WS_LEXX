/**
 * The plan-idea slice of the analytics «Эдж» tab (GET /api/ideas/stats): P&L, win rate and count by idea tier and by
 * checklist score band, the authored ideas and the missed tier 1–2 ideas (planned, not traded, moved big). Ends with
 * the way to the plan where ideas are marked. Every number comes from the api (shared $ math).
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Layers3 } from "lucide-react";
import { Panel, QueryState, TableScroll, toneText } from "@/components/ds";
import { cn } from "@/lib/utils";
import { links } from "@/lib/links";
import { fmtDate, fmtPct, fmtRate, fmtUsd } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { sessionFlowI18n } from "@/i18n/ns/sessionFlow";
import type { UsdBlock } from "@/components/shared/strategy/model";
import { ideaStatsQuery } from "./ideas-api";

const tone = (v: number | null | undefined) => (v == null || v === 0 ? "neutral" : v > 0 ? "up" : "down");

function Rows({ first, rows }: { first: string; rows: { key: string; label: string; u: UsdBlock }[] }) {
  const { t } = sessionFlowI18n.useT();
  return (
    <TableScroll>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground [&_th]:py-1 [&_th]:font-medium">
            <th className="text-left">{first}</th>
            <th className="text-right">{t("ideas.col.trades")}</th>
            <th className="text-right">{t("ideas.col.winRate")}</th>
            <th className="text-right">{t("ideas.col.net")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-border/40">
              <td className="py-1.5 font-medium">{r.label}</td>
              <td className="py-1.5 text-right tabular-nums text-muted-foreground">{r.u.n}</td>
              <td className="py-1.5 text-right tabular-nums">{fmtRate(r.u.winrate)}</td>
              <td className={cn("py-1.5 text-right font-medium tabular-nums", toneText(tone(r.u.net)))}>{fmtUsd(r.u.net, { signed: true, decimals: 0 })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

export function IdeasPanel({ trader, from, to }: { trader: string | null; from: string | null; to: string | null }) {
  const { t } = sessionFlowI18n.useT();
  const q = useQuery(ideaStatsQuery(trader, from, to));
  return (
    <Panel title={t("ideas.title")} icon={Layers3} description={t("ideas.hint")}>
      <QueryState query={q} errorCompact errorTitle={t("ideas.loadFailed")}>
        {(s) => !s.marked ? (
          <p className="text-sm text-muted-foreground">
            {t("ideas.empty")}{" "}
            {!trader && <Link href={links.myPlan()} className="font-medium text-primary hover:underline">{t("ideas.toPlan")}</Link>}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <Rows first={t("ideas.col.tier")} rows={s.tiers.map((r) => ({ key: r.tier, label: t(`ideas.tier.${r.tier}`), u: r }))} />
            {s.authored.n > 0 && (
              <p className={cn("text-sm", toneText(tone(s.authored.net)))}>{t("ideas.authored", { trades: commonI18n.t("units.trades", { count: s.authored.n }), net: fmtUsd(s.authored.net, { signed: true, decimals: 0 }) })}</p>
            )}
            {s.bands.some((b) => b.band !== "none") && <Rows first={t("ideas.col.band")} rows={s.bands.map((r) => ({ key: r.band, label: t(`ideas.band.${r.band}`), u: r }))} />}
            {s.missed.length > 0 && (
              <section className="flex flex-col gap-1">
                <h3 className="text-xs font-semibold text-muted-foreground">{t("ideas.missed")}</h3>
                <ul className="flex flex-col gap-0.5 text-sm tabular-nums">
                  {s.missed.slice(0, 5).map((m) => (
                    <li key={`${m.day}-${m.ticker}`}>{t("ideas.missedRow", { day: fmtDate(m.day, "dayMonth"), ticker: m.ticker, tier: m.tier, move: fmtPct(m.movePct, 1) })}</li>
                  ))}
                </ul>
              </section>
            )}
            {!trader && <Link href={links.myPlan()} className="text-sm font-medium text-primary hover:underline">{t("ideas.toPlan")}</Link>}
          </div>
        )}
      </QueryState>
    </Panel>
  );
}
