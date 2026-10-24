/**
 * «Экзамены» (prop challenges): profit target, daily loss, static/trailing drawdown, consistency, min days, position size, time window.
 * Trader: own exams with per-rule progress and a day-by-day timeline. Mentor: everyone's exams, create from template, archive.
 * `?id=` opens an exam; `?user=` (staff) pre-filters by student — the «Путь трейдера» report links here.
 */
import * as React from "react";
import { useSearch } from "wouter";
import { Flag, Plus, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { EmptyLink, EmptyState, ErrorState, Page, PageHeader, Panel, Segmented, SplitSkeleton } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { academyPathI18n } from "@/i18n/ns/academyPath";
import { shellI18n } from "@/i18n/ns/shell";
import { comparePersonNames, personName } from "@/i18n";
import { type ChallengeStatus, useChallenges, usePathConfig } from "@/components/academy/path/api";
import { ChallengeCard, ChallengeDetailView, CreateChallengeDialog } from "@/components/academy/path/challenge-views";
import { defaultStageName } from "@/components/academy/path/labels";
import { PersonSelect } from "@/components/people/person-select";
import { cn } from "@/lib/utils";

type Filter = "all" | "active" | "done" | "archived";
const DONE: ChallengeStatus[] = ["passed", "failed", "expired"];

export default function AcademyChallengesPage() {
  const { t } = academyPathI18n.useT();
  const { isCurator, dbUsers } = useAuth();
  const search = useSearch();
  const qc = useQueryClient();
  const params = React.useMemo(() => new URLSearchParams(search), [search]);
  const idParam = React.useMemo(() => { const v = Number(params.get("id")); return Number.isInteger(v) && v > 0 ? v : null; }, [params]);
  const userParam = params.get("user") ?? "";
  const [selected, setSelected] = React.useState<number | null>(idParam);
  React.useEffect(() => { if (idParam) setSelected(idParam); }, [idParam]);
  const [filter, setFilter] = React.useState<Filter>("all");
  const [who, setWho] = React.useState<string>(userParam); // staff: "" = everyone
  React.useEffect(() => { if (userParam) { setWho(userParam); setSelected(null); } }, [userParam]);
  const [createOpen, setCreateOpen] = React.useState(false);

  const list = useChallenges(isCurator ? who || null : null, filter === "archived");
  const config = usePathConfig();
  const people = React.useMemo(() => dbUsers.filter((u) => u.active && !u.banned && u.role !== "guest").map((u) => u.name).sort(comparePersonNames), [dbUsers]);
  const personOptions = React.useMemo(() => people.map((n) => ({ value: n, label: personName(n) })), [people]);
  const pathHref = React.useCallback((u: string) => (isCurator ? `/academy/path?user=${encodeURIComponent(u)}` : "/academy/path"), [isCurator]);

  const items = (list.data?.challenges ?? []).filter((c) =>
    filter === "active" ? c.result.status === "active" || c.result.status === "scheduled" : filter === "done" ? DONE.includes(c.result.status) : true);
  // While a filter change still shows the previous list (placeholder), wait for the real one before auto-picking.
  React.useEffect(() => {
    if (selected == null && items.length && !list.isPlaceholderData) setSelected(items[0].id);
  }, [items, selected, list.isPlaceholderData]);

  return (
    <Page>
      <PageHeader
        title={shellI18n.t("nav.academyChallenges")}
        icon={Flag}
        description={t("page.challengesDescription")}
        actions={
          <>
            <Button variant="ghost" size="sm" aria-label={t("page.refreshData")} title={t("page.refreshData")} onClick={() => void qc.invalidateQueries({ queryKey: ["academy-challenges"] })}><RefreshCw className="h-4 w-4" aria-hidden="true" /></Button>
            {list.data?.canCreate && config.data && (
              <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />{t("page.assignExam")}</Button>
            )}
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<Filter>
            ariaLabel={t("page.filterAria")}
            value={filter}
            onChange={(v) => { setFilter(v); setSelected(null); }}
            options={[
              { value: "all", label: t("page.filters.all") },
              { value: "active", label: t("page.filters.active") },
              { value: "done", label: t("page.filters.done") },
              { value: "archived", label: t("page.filters.archived") },
            ]}
          />
          {isCurator && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{t("page.student")}</span>
              <PersonSelect value={who} onValueChange={(v) => { setWho(v); setSelected(null); }} options={personOptions} allLabel={t("page.allStudents")} ariaLabel={t("page.student")} className="h-9 w-48" />
            </label>
          )}
        </div>
      </PageHeader>

      {list.isLoading ? (
        <SplitSkeleton side="340px" rows={5} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={list.refetch} title={t("page.loadFailed")} />
      ) : !items.length ? (
        <Panel>
          <EmptyState art="laurel" icon={Flag} title={filter === "archived" ? t("page.archiveEmpty") : t("page.noExams")}
            description={isCurator ? t("page.noExamsStaff", { from: defaultStageName("junior"), to: defaultStageName("trader") }) : t("page.noExamsTrader")}
            action={list.data?.canCreate && config.data ? <Button onClick={() => setCreateOpen(true)}>{t("page.assignExam")}</Button> : <EmptyLink href="/academy/learn">{shellI18n.t("nav.academyLearn")}</EmptyLink>} />
        </Panel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
          <nav aria-label={t("page.listAria")} aria-busy={list.isPlaceholderData || undefined} className={cn("flex flex-col gap-2 transition-opacity duration-[var(--dur-2)] ease-[var(--ease)]", list.isPlaceholderData && "pointer-events-none opacity-60")}>
            {items.map((c) => <ChallengeCard key={c.id} c={c} active={c.id === selected} onOpen={() => setSelected(c.id)} showUser={isCurator} templates={config.data?.templates} />)}
          </nav>
          <div className="min-w-0">{selected != null && <ChallengeDetailView id={selected} onArchived={() => setSelected(null)} pathHref={pathHref} />}</div>
        </div>
      )}

      {config.data && (
        <CreateChallengeDialog open={createOpen} onOpenChange={setCreateOpen} templates={config.data.templates} people={people}
          defaultUser={who || null} onCreated={(id) => setSelected(id)} />
      )}
    </Page>
  );
}
