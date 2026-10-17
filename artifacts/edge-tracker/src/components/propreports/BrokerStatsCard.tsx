/**
 * Compact «Брокерская статистика» summary for a trader (latest PropReports Trade Performance report).
 * Renders nothing when the trader has no report, so it can sit on any page (dashboard, analytics,
 * profile, leaderboard) without empty noise. Full report: /stats?trader=<name>.
 */
import { Link } from "wouter";
import { ArrowRight, Building2 } from "lucide-react";
import { Panel, StatCard, StatGrid, type Tone } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { fmtSigned, fmtUsd, usePerformance } from "./api";

const toneOf = (v: number | null | undefined): Tone => (v == null || v === 0 ? "neutral" : v > 0 ? "up" : "down");
const dateRu = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });

/** Latest broker report for a trader (null while loading / none). */
export function useBrokerReport(trader: string | null | undefined) {
  const q = usePerformance(trader || null);
  const latest = trader ? q.data?.latest ?? null : null;
  return { latest, isLoading: q.isLoading };
}

export function BrokerStatsCard({ trader, title, className }: { trader: string | null | undefined; title?: string; className?: string }) {
  const { latest } = useBrokerReport(trader);
  if (!trader || !latest) return null;
  const s = latest.summary;
  const longNet = latest.data?.bySide?.long?.totals?.net ?? null;
  const shortNet = latest.data?.bySide?.short?.totals?.net ?? null;
  return (
    <Panel
      title={title ?? "Брокерская статистика · PropReports"}
      description={`Счёт ${latest.account} · ${dateRu(latest.periodFrom)} — ${dateRu(latest.periodTo)}${latest.traderName ? ` · ${latest.traderName}` : ""}`}
      icon={Building2}
      className={className}
      actions={
        <Button variant="ghost" size="sm" className="rounded-full" asChild>
          <Link href={`/stats?trader=${encodeURIComponent(trader)}`}>
            Полный отчёт <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </Button>
      }
    >
      <StatGrid className="md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="P&L нетто" value={fmtSigned(s.net)} tone={toneOf(s.net)} hint={`брутто ${fmtSigned(s.gross)}`} />
        <StatCard label="Комиссии" value={fmtUsd(s.fees)} tone={s.feesPctOfGross != null && s.feesPctOfGross > 50 ? "warn" : "neutral"}
          hint={s.feesPctOfGross != null ? `${s.feesPctOfGross.toFixed(0)}% от брутто` : undefined} />
        <StatCard label="Сделок" value={s.trades.toLocaleString("ru-RU")} hint={`${s.wins} W / ${s.losses} L`} />
        <StatCard label="Win rate" value={s.winRate != null ? `${s.winRate.toFixed(1)}%` : "—"} tone={s.winRate != null && s.winRate >= 50 ? "up" : "neutral"} />
        <StatCard label="Long нетто" value={fmtSigned(longNet)} tone={toneOf(longNet)} />
        <StatCard label="Short нетто" value={fmtSigned(shortNet)} tone={toneOf(shortNet)} />
      </StatGrid>
    </Panel>
  );
}

export default BrokerStatsCard;
