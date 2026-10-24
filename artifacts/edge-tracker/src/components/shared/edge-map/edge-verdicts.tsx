/**
 * Edge map rows (roadmap R4): «где зарабатывает / где теряет» as at most 3 cards per side, each with $ per trading day
 * and its 80% interval — never a raw slice table. Used by «Мой разбор» (own map, inside /api/my-review), the curator
 * profile and the analytics «Эдж» tab (GET /api/edge/map).
 */
import { Map as MapIcon, TrendingDown, TrendingUp } from "lucide-react";
import { Panel, QueryState, toneText } from "@/components/ds";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/format";
import { commonI18n } from "@/i18n/ns/common";
import { coachI18n } from "@/i18n/ns/coach";
import { useEdgeMap, type EdgeVerdict } from "./api";
import { intervalText, perDayText, sliceLabel } from "./model";

/** One side of the map as a list (rows ≥ 44 px, phone-first). */
export function EdgeVerdictList({ rows, kind }: { rows: readonly EdgeVerdict[]; kind: "earn" | "lose" }) {
  const { t } = coachI18n.useT();
  if (!rows.length) return <p className="text-sm text-muted-foreground">{t(kind === "earn" ? "edgeMap.emptyEarn" : "edgeMap.emptyLose")}</p>;
  return (
    <ul className="flex flex-col" aria-label={t(kind === "earn" ? "edgeMap.earn" : "edgeMap.lose")}>
      {rows.map((r) => (
        <li key={r.sliceKey} className="flex min-h-11 items-center gap-3 rounded-xl px-2 py-1.5">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-foreground [overflow-wrap:anywhere]">{sliceLabel(r.sliceKey)}</span>
            <span className="block text-xs tabular-nums text-muted-foreground">
              {t("edgeMap.meta", { trades: commonI18n.t("units.trades", { count: r.n }), days: t("edgeMap.days", { count: r.days }) })}
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-end">
            <span className={cn("text-sm font-semibold tabular-nums", toneText(kind === "earn" ? "up" : "down"))}>{perDayText(r)}</span>
            <span className="text-xs tabular-nums text-muted-foreground">{intervalText(r)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Both sides with the «how to read» note and the as-of date. `trader` null = the viewer's own map. */
export function EdgeMapPanel({ trader, className, title }: { trader: string | null; className?: string; title?: string }) {
  const { t } = coachI18n.useT();
  const q = useEdgeMap(trader);
  return (
    <Panel title={title ?? t("edgeMap.title")} icon={MapIcon} description={t("edgeMap.hint")} className={className}>
      <QueryState query={q} errorCompact errorTitle={t("edgeMap.loadFailed")}>
        {(v) => (v.asOf == null ? (
          <p className="text-sm text-muted-foreground">{t("edgeMap.notComputed")}</p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <section className="flex min-w-0 flex-col gap-1">
                <h3 className="flex items-center gap-1.5 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />{t("edgeMap.earn")}</h3>
                <EdgeVerdictList rows={v.earn} kind="earn" />
              </section>
              <section className="flex min-w-0 flex-col gap-1">
                <h3 className="flex items-center gap-1.5 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />{t("edgeMap.lose")}</h3>
                <EdgeVerdictList rows={v.lose} kind="lose" />
              </section>
            </div>
            <p className="px-2 text-xs text-muted-foreground">{t("edgeMap.asOf", { date: fmtDate(v.asOf, "dayMonth") })}</p>
          </div>
        ))}
      </QueryState>
    </Panel>
  );
}
