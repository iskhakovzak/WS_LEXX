/**
 * Details under the cheat sheet (collapsed by default, open for preparation): the structured card (context, ideal
 * conditions, management, notes / mistakes), examples, stats with the linked trades, history. Read-only unless the
 * viewer may edit the setup — the same pieces as the library card, without the curator header.
 */
import { useSearchParam } from "@/hooks/use-search-param";
import { useMemo, useState } from "react";
import { FileText, History, ListChecks, Trophy } from "lucide-react";
import { SectionTabs } from "@/components/ds";
import { QueryError } from "@/components/query-error";
import { playbookTodayI18n } from "@/i18n/ns/playbookToday";
import { usePlaybookEntries, usePlaybookSummary, usePlaybookViewer } from "../api";
import { ExamplesBoard } from "../examples-board";
import { LinkedTradesSection } from "../linked-trades-section";
import { accessOf } from "../model";
import { SetupStatsPanel } from "../setup-stats";
import { HistoryPanel } from "../setup-view";
import { StructuredDescription } from "../structured-editor";
import { TradePickerDialog } from "../trade-picker-dialog";

type Tab = "about" | "examples" | "stats" | "history";
const TABS: readonly Tab[] = ["about", "examples", "stats", "history"];

export function SetupDetails({ setupId }: { setupId: number }) {
  const { t } = playbookTodayI18n.useT();
  const [tabRaw, setTab] = useSearchParam("stab", "about", { allowed: TABS }); // ?stab= — kept on reload
  const tab = tabRaw as Tab;
  const [picker, setPicker] = useState(false);
  const entriesQ = usePlaybookEntries();
  const summary = usePlaybookSummary().map;
  const viewer = usePlaybookViewer();
  const entries = useMemo(() => entriesQ.data ?? [], [entriesQ.data]);
  const entry = entries.find((e) => e.id === setupId) ?? null;
  const targets = useMemo(() => entries.filter((e) => accessOf(e, viewer).canAddExamples), [entries, viewer]);
  if (entriesQ.isLoading) return <div className="h-40 animate-pulse rounded-xl bg-[var(--glass-bg)] motion-reduce:animate-none" aria-busy="true" />;
  if (entriesQ.isError && !entry) return <QueryError compact error={entriesQ.error} onRetry={() => void entriesQ.refetch()} />;
  if (!entry) return <p className="text-sm text-muted-foreground">{t("details.missing")}</p>;
  const access = accessOf(entry, viewer);
  const live = viewer.live || !!entry.access;
  return (
    <section aria-label={t("details.aria")} className="flex min-w-0 flex-col gap-[var(--grid-gap)]">
      <SectionTabs<Tab>
        ariaLabel={t("details.aria")}
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "about", label: t("details.tabs.about"), icon: FileText },
          { value: "examples", label: t("details.tabs.examples"), icon: Trophy },
          { value: "stats", label: t("details.tabs.stats"), icon: ListChecks },
          { value: "history", label: t("details.tabs.history"), icon: History },
        ]}
      />
      {tab === "about" && <StructuredDescription entry={entry} canEdit={access.canEdit} live={live} />}
      {tab === "examples" && <ExamplesBoard entry={entry} access={access} viewerName={viewer.name} targets={targets} onAddExamples={() => setPicker(true)} />}
      {tab === "stats" && (
        <SetupStatsPanel setupId={entry.id} summary={summary.get(entry.id)}>
          <LinkedTradesSection entry={entry} />
        </SetupStatsPanel>
      )}
      {tab === "history" && <HistoryPanel entry={entry} />}
      {picker && <TradePickerDialog open onOpenChange={(v) => { if (!v) setPicker(false); }} entry={entry} />}
    </section>
  );
}
