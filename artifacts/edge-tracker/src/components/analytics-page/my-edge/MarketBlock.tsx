/**
 * «Рынок и мой edge» — the trader's results by the market backdrop of the day (SPY / QQQ) and the ticker context,
 * with the same honest statistics; every dimension shows its coverage, missing data is «нет данных», and the footer
 * names the feeds that would sharpen it.
 */
import { useMemo, useState } from "react";
import { Globe2 } from "lucide-react";
import { Panel, Pill } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtRate } from "@/lib/format";
import { myEdgeI18n } from "@/i18n/ns/myEdge";
import type { AnalyticsFilters } from "../metrics";
import type { MarketData, MeCoverage } from "./api";
import { EdgeRow } from "./EdgeRow";
import { bestWorst, bucketLabel, coverageShare, dimLabel, money, scaleOf } from "./model";

const INDEX_DIMS = ["spyTrend", "spyGap", "spyVol", "spyPrevVol", "qqqTrend", "qqqGap"];
const TICKER_DIMS = ["tkGap", "tkAtr", "tkRvol", "earnings", "analyst", "sector", "theme"];
/** Rows shown per dimension before «Ещё N» (sectors / themes can be long). */
const VISIBLE = 4;

function DimCard({ dim, data, filters, cov }: { dim: string; data: MarketData; filters: AnalyticsFilters; cov: MeCoverage | undefined }) {
  const { t } = myEdgeI18n.useT();
  const [open, setOpen] = useState(false);
  const rows = useMemo(
    () => data.rows.filter((r) => r.dim === dim).sort((a, b) => (a.status === "low" ? 1 : 0) - (b.status === "low" ? 1 : 0) || b.trades - a.trades),
    [data.rows, dim],
  );
  const scale = useMemo(() => scaleOf(rows), [rows]);
  const share = coverageShare(cov);
  const eod = data.eodDims.includes(dim);
  const shown = open ? rows : rows.slice(0, VISIBLE);
  return (
    <section className="min-w-0 rounded-xl border border-[var(--glass-border)] p-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-foreground">{dimLabel(dim)}</h4>
        <span className="inline-flex flex-wrap items-center gap-1.5">
          {eod && <Pill tone="neutral" title={t("eodHint")}>{t("eod")}</Pill>}
          {share != null && (
            <Pill tone="neutral" title={t("market.coverageHint", { known: cov!.known, total: cov!.total })}>{t("market.coverage", { pct: fmtRate(share) })}</Pill>
          )}
        </span>
      </header>
      {rows.length ? (
        <ul className="@container divide-y divide-[var(--glass-border)]">
          {shown.map((r) => <EdgeRow key={r.key} row={{ ...r, outcome: false }} scale={scale} filters={filters} typicalDay={null} showDim={false} />)}
        </ul>
      ) : (
        <p className="py-3 text-sm text-muted-foreground">{t("market.noData")}</p>
      )}
      {rows.length > VISIBLE && (
        <Button variant="ghost" size="sm" className="mt-1" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? t("actions.hideAll") : t("actions.more", { count: rows.length - VISIBLE })}
        </Button>
      )}
    </section>
  );
}

function feedLabel(f: string): string {
  const [name, partial] = f.split(":");
  const label = myEdgeI18n.tryT(`feeds.${name}`) ?? name ?? f;
  return partial ? myEdgeI18n.t("market.partial", { feed: label }) : label;
}

export function MarketBlock({ data, isLoading, isError, filters }: { data: MarketData | undefined; isLoading: boolean; isError: boolean; filters: AnalyticsFilters }) {
  const { t } = myEdgeI18n.useT();
  const covOf = (dim: string) => data?.coverage.find((c) => c.dim === dim);
  const bw = data ? bestWorst(data.rows, "spyTrend") : null;
  return (
    <Panel
      icon={Globe2}
      title={t("market.title")}
      description={t("market.description")}
      footer={data?.missingFeeds.length ? (
        <span className="min-w-0">
          <span className="font-medium text-foreground">{t("market.improve")}: </span>
          {data.missingFeeds.map(feedLabel).join(" · ")}
        </span>
      ) : undefined}
    >
      {isLoading ? (
        <div className="flex flex-col gap-3" aria-busy="true"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-48" /></div>
      ) : isError || !data ? (
        <p className="text-sm text-muted-foreground">{t("loadError")}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-base font-medium leading-snug text-foreground text-pretty">
            {bw
              ? t("market.verdict", {
                best: bucketLabel("spyTrend", bw.best.key), bestValue: money(bw.best.perDay.point),
                worst: bucketLabel("spyTrend", bw.worst.key), worstValue: money(bw.worst.perDay.point),
              })
              : t("market.verdictNone")}
          </p>
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("market.index")}</h3>
            <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
              {INDEX_DIMS.map((d) => <DimCard key={d} dim={d} data={data} filters={filters} cov={covOf(d)} />)}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("market.ticker")}</h3>
            <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
              {TICKER_DIMS.map((d) => <DimCard key={d} dim={d} data={data} filters={filters} cov={covOf(d)} />)}
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}
