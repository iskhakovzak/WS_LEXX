/**
 * /stats — the broker block (PropReports Trade Performance + reconciliation) of one person. Its scope is the whole
 * broker report, not the period window of the page — the heading says so (design audit wave 2B: two rows of figures
 * with different scopes side by side read as a contradiction).
 */
import { PerformanceReportPanel } from "./PerformanceReportPanel";
import { ReconcilePanel } from "./ReconcilePanel";
import { statsI18n } from "@/i18n/ns/stats";

export function StatsBrokerBlock({ trader }: { trader: string }) {
  const { t } = statsI18n.useT();
  return (
    <section aria-labelledby="stats-broker" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1">
        <h2 id="stats-broker" className="text-sm font-semibold text-foreground">{t("broker.title")}</h2>
        <p className="text-xs text-muted-foreground">{t("broker.scope")}</p>
      </div>
      <PerformanceReportPanel trader={trader} />
      <ReconcilePanel trader={trader} compact />
    </section>
  );
}
