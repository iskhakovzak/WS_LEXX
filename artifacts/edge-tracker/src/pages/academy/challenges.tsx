/**
 * «Экзамены» (prop challenges): profit target, daily loss, static/trailing drawdown, consistency, min days, position size, time window.
 * Trader: own exams with per-rule progress and a day-by-day timeline. Mentor: everyone's exams, create from template, archive.
 */
import * as React from "react";
import { useSearch } from "wouter";
import { Flag, Plus, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { EmptyState, Page, PageHeader, Panel, Segmented } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/auth-context";
import { type ChallengeStatus, useChallenges, usePathConfig } from "@/components/academy/path/api";
import { selectCls } from "@/components/academy/path/bits";
import { ChallengeCard, ChallengeDetailView, CreateChallengeDialog } from "@/components/academy/path/challenge-views";
import { PersonSelect } from "@/components/people/person-select";

type Filter = "all" | "active" | "done" | "archived";
const DONE: ChallengeStatus[] = ["passed", "failed", "expired"];

export default function AcademyChallengesPage() {
  const { isCurator, dbUsers } = useAuth();
  const search = useSearch();
  const qc = useQueryClient();
  const idParam = React.useMemo(() => { const v = Number(new URLSearchParams(search).get("id")); return Number.isInteger(v) && v > 0 ? v : null; }, [search]);
  const [selected, setSelected] = React.useState<number | null>(idParam);
  React.useEffect(() => { if (idParam) setSelected(idParam); }, [idParam]);
  const [filter, setFilter] = React.useState<Filter>("all");
  const [who, setWho] = React.useState<string>(""); // staff: "" = everyone
  const [createOpen, setCreateOpen] = React.useState(false);

  const list = useChallenges(isCurator ? who || null : null, filter === "archived");
  const config = usePathConfig();
  const people = React.useMemo(() => dbUsers.filter((u) => u.active && !u.banned && u.role !== "guest").map((u) => u.name).sort((a, b) => a.localeCompare(b, "ru")), [dbUsers]);

  const items = (list.data?.challenges ?? []).filter((c) =>
    filter === "active" ? c.result.status === "active" || c.result.status === "scheduled" : filter === "done" ? DONE.includes(c.result.status) : true);
  React.useEffect(() => {
    if (selected == null && items.length) setSelected(items[0].id);
  }, [items, selected]);

  return (
    <Page>
      <PageHeader
        title="Экзамены"
        icon={Flag}
        description="Челленджи на перевод между ступенями: цель, лимиты и стабильность считаются по реальным сделкам"
        actions={
          <>
            <Button variant="ghost" size="sm" aria-label="Обновить данные" onClick={() => void qc.invalidateQueries({ queryKey: ["academy-challenges"] })}><RefreshCw className="h-4 w-4" aria-hidden="true" /></Button>
            {list.data?.canCreate && config.data && (
              <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Назначить экзамен</Button>
            )}
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<Filter>
            ariaLabel="Фильтр экзаменов"
            value={filter}
            onChange={(v) => { setFilter(v); setSelected(null); }}
            options={[{ value: "all", label: "Все" }, { value: "active", label: "Идут" }, { value: "done", label: "Завершены" }, { value: "archived", label: "Архив" }]}
          />
          {isCurator && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Ученик</span>
              <PersonSelect value={who} onValueChange={(v) => { setWho(v); setSelected(null); }} options={people} allLabel="Все" ariaLabel="Ученик" className="h-9 w-48" />
            </label>
          )}
        </div>
      </PageHeader>

      {list.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-[340px_1fr]"><Skeleton className="h-72 rounded-2xl" /><Skeleton className="h-96 rounded-2xl" /></div>
      ) : list.isError ? (
        <Panel><EmptyState icon={Flag} title="Не удалось загрузить экзамены" description={(list.error as Error).message} /></Panel>
      ) : !items.length ? (
        <Panel>
          <EmptyState icon={Flag} title={filter === "archived" ? "Архив пуст" : "Экзаменов пока нет"}
            description={isCurator ? "Назначьте экзамен из шаблона — например «Перевод Стажёр → Джун»." : "Экзамен назначает наставник, когда вы приближаетесь к переводу на следующую ступень."}
            action={list.data?.canCreate && config.data ? <Button size="sm" onClick={() => setCreateOpen(true)}>Назначить экзамен</Button> : undefined} />
        </Panel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
          <nav aria-label="Список экзаменов" className="flex flex-col gap-2">
            {items.map((c) => <ChallengeCard key={c.id} c={c} active={c.id === selected} onOpen={() => setSelected(c.id)} showUser={isCurator} />)}
          </nav>
          <div className="min-w-0">{selected != null && <ChallengeDetailView id={selected} onArchived={() => setSelected(null)} />}</div>
        </div>
      )}

      {config.data && (
        <CreateChallengeDialog open={createOpen} onOpenChange={setCreateOpen} templates={config.data.templates} people={people}
          defaultUser={who || null} onCreated={(id) => setSelected(id)} />
      )}
    </Page>
  );
}
