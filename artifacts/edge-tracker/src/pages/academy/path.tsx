/**
 * «Путь трейдера»: ladder Стажёр → Джун → Трейдер → Сеньор with objective, staff-configurable promotion criteria.
 * Trader: own readiness report («Готов к переводу: X из Y»), advice per criterion, promotion request, history.
 * Mentor (curator/admin): funnel by stage, any trader's report, request queue with approve/reject, criteria editor.
 */
import * as React from "react";
import { useSearchParam } from "@/hooks/use-search-param";
import { GraduationCap, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Page, PageHeader, SectionTabs } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { academyPathI18n } from "@/i18n/ns/academyPath";
import { shellI18n } from "@/i18n/ns/shell";
import { comparePersonNames, personName } from "@/i18n";
import { pathKeys, usePathConfig, useRequests } from "@/components/academy/path/api";
import { ladderText } from "@/components/academy/path/labels";
import { PersonView } from "@/components/academy/path/person-view";
import { CriteriaEditor, FunnelView, RequestsView } from "@/components/academy/path/staff-views";
import { PersonSelect } from "@/components/people/person-select";
import { PageHint } from "@/components/shared/page-hint";

type View = "person" | "funnel" | "requests" | "criteria";
const VIEWS: readonly View[] = ["person", "funnel", "requests", "criteria"];

export default function AcademyPathPage() {
  const { t } = academyPathI18n.useT();
  const { user, isCurator, dbUsers } = useAuth();
  const me = user && user.role !== "guest" ? user.traderName : null;
  const qc = useQueryClient();
  // ?user= (whose path) and ?view= live in the URL (read and written): a reload keeps the person and the view.
  const [userParam, setTarget] = useSearchParam("user", "");
  const target = userParam || null;
  const [viewParam, setView] = useSearchParam("view", "", { allowed: VIEWS });
  const view: View = (viewParam as View) || (isCurator && !target ? "funnel" : "person");

  const config = usePathConfig();
  const pending = useRequests("pending", isCurator);
  const people = React.useMemo(() => {
    const names = dbUsers.filter((u) => u.active && !u.banned && u.role !== "guest").map((u) => u.name).sort(comparePersonNames);
    return (me ? [me, ...names.filter((n) => n !== me)] : names).map((n) => ({ value: n, label: personName(n) }));
  }, [dbUsers, me]);
  const open = (u: string) => { setTarget(u); setView("person"); };

  return (
    <Page>
      <PageHeader
        title={shellI18n.t("nav.academyPath")}
        icon={GraduationCap}
        description={t("page.pathDescription", { ladder: ladderText() })}
        actions={<>
          <Button variant="ghost" size="sm" onClick={() => void qc.invalidateQueries({ queryKey: pathKeys.all })} aria-label={t("page.refreshData")} title={t("page.refreshData")}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </Button>
        </>}
      >
        {isCurator && (
          <div className="flex flex-col gap-3">
            {/* The page's views are tabs (SectionTabs); Segmented is for filters and modes only (design audit). */}
            <SectionTabs<View>
              ariaLabel={t("page.sectionAria")}
              value={view}
              onChange={setView}
              tabs={[
                { value: "funnel", label: t("page.views.funnel") },
                { value: "person", label: t("page.views.person") },
                { value: "requests", label: t("page.views.requests"), count: pending.data?.requests.length || undefined },
                { value: "criteria", label: t("page.views.criteria") },
              ]}
            />
            {view === "person" && (
              <label className="flex items-center gap-2 self-start text-sm text-muted-foreground">
                <span>{t("page.student")}</span>
                <PersonSelect value={target ?? me ?? ""} onValueChange={(v) => setTarget(v || null)} options={people} self={me}
                  placeholder={t("page.student")} ariaLabel={t("page.student")} className="h-9 w-56" />
              </label>
            )}
          </div>
        )}
      </PageHeader>
      <PageHint id="academy" />

      {view === "person" && <PersonView user={isCurator ? target ?? me : null} config={config.data} isStaff={isCurator} me={me} />}
      {view === "funnel" && isCurator && <FunnelView onOpen={open} />}
      {view === "requests" && isCurator && <RequestsView config={config.data} me={me} onOpen={open} />}
      {view === "criteria" && isCurator && config.data && <CriteriaEditor config={config.data} />}
    </Page>
  );
}
