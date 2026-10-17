/**
 * «Путь трейдера»: ladder Стажёр → Джун → Трейдер → Сеньор with objective, staff-configurable promotion criteria.
 * Trader: own readiness report («Готов к переводу: X из Y»), advice per criterion, promotion request, history.
 * Mentor (curator/admin): funnel by stage, any trader's report, request queue with approve/reject, criteria editor.
 */
import * as React from "react";
import { useSearch } from "wouter";
import { RefreshCw, Route as RouteIcon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Page, PageHeader, Segmented } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { pathKeys, usePathConfig, useRequests } from "@/components/academy/path/api";
import { selectCls } from "@/components/academy/path/bits";
import { PersonView } from "@/components/academy/path/person-view";
import { CriteriaEditor, FunnelView, RequestsView } from "@/components/academy/path/staff-views";

type View = "person" | "funnel" | "requests" | "criteria";

export default function AcademyPathPage() {
  const { user, isCurator, dbUsers } = useAuth();
  const me = user && user.role !== "guest" ? user.traderName : null;
  const search = useSearch();
  const qc = useQueryClient();
  const initialUser = React.useMemo(() => new URLSearchParams(search).get("user"), [search]);
  const [target, setTarget] = React.useState<string | null>(initialUser);
  const [view, setView] = React.useState<View>(isCurator && !initialUser ? "funnel" : "person");
  React.useEffect(() => { if (initialUser) { setTarget(initialUser); setView("person"); } }, [initialUser]);

  const config = usePathConfig();
  const pending = useRequests("pending", isCurator);
  const people = React.useMemo(() => dbUsers.filter((u) => u.active && !u.banned && u.role !== "guest").map((u) => u.name).sort((a, b) => a.localeCompare(b, "ru")), [dbUsers]);
  const open = (u: string) => { setTarget(u); setView("person"); };

  return (
    <Page>
      <PageHeader
        title="Путь трейдера"
        icon={RouteIcon}
        description="Стажёр → Джун → Трейдер → Сеньор: объективные критерии перевода, отчёт готовности и решение наставника"
        actions={
          <Button variant="ghost" size="sm" onClick={() => void qc.invalidateQueries({ queryKey: pathKeys.all })} aria-label="Обновить данные">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </Button>
        }
      >
        {isCurator && (
          <div className="flex flex-wrap items-center gap-2">
            <Segmented<View>
              ariaLabel="Раздел"
              value={view}
              onChange={setView}
              options={[
                { value: "funnel", label: "Воронка" },
                { value: "person", label: "Отчёт ученика" },
                { value: "requests", label: "Заявки", count: pending.data?.requests.length || undefined },
                { value: "criteria", label: "Критерии" },
              ]}
            />
            {view === "person" && (
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>Ученик</span>
                <select className={selectCls} value={target ?? me ?? ""} onChange={(e) => setTarget(e.target.value || null)}>
                  {me && <option value={me}>{me} (я)</option>}
                  {people.filter((n) => n !== me).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            )}
          </div>
        )}
      </PageHeader>

      {view === "person" && <PersonView user={isCurator ? target ?? me : null} config={config.data} isStaff={isCurator} me={me} />}
      {view === "funnel" && isCurator && <FunnelView onOpen={open} />}
      {view === "requests" && isCurator && <RequestsView config={config.data} me={me} onOpen={open} />}
      {view === "criteria" && isCurator && config.data && <CriteriaEditor config={config.data} />}
    </Page>
  );
}
