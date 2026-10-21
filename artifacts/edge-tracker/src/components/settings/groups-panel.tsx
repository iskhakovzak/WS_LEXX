/**
 * Пульт → Настройки деска → «Группы» (Волна 1 п. 1.19, owner decision 3): the desk split into groups — each with its
 * curator and traders. Add / rename / change the curator / archive a group, move a trader with one select (his
 * assigned curator follows the group's). A curator sees his group by default everywhere («Моя группа / Все»).
 * Admins edit (settings.manage); staff read. Mounted by pages/admin.tsx (settings tab).
 */
import * as React from "react";
import { Archive, Pencil, Plus, Users } from "lucide-react";
import { EmptyState, ListSkeleton, Panel, Pill } from "@/components/ds";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { personName } from "@/i18n";
import { deskGroupsI18n } from "@/i18n/ns/deskGroups";
import { NONE, groupNameProblem, moveTargets, useDeskGroups, useDeskGroupsChange, type DeskGroupsState, type GroupMember } from "./groups-api";

export function DeskGroupsPanel({ enabled = true }: { enabled?: boolean }) {
  const { t } = deskGroupsI18n.useT();
  const q = useDeskGroups(enabled);
  if (!enabled) return null;
  if (q.isLoading) return <Panel title={t("title")} icon={Users}><ListSkeleton rows={4} /></Panel>;
  if (q.isError || !q.data) return <QueryError error={q.error} title={t("loadFailed")} onRetry={() => q.refetch()} />;
  return <GroupsBoard state={q.data} />;
}

function GroupsBoard({ state }: { state: DeskGroupsState }) {
  const { t } = deskGroupsI18n.useT();
  const edit = !!state.canEdit;
  return (
    <Panel id="desk-groups" title={t("title")} icon={Users} description={t("description")}>
      <div className="flex flex-col gap-4">
        {edit ? <AddGroup state={state} /> : <p className="text-xs text-muted-foreground">{t("readOnly")}</p>}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {state.groups.map((g) => (
            <GroupCard key={g.id} state={state} edit={edit} group={g} />
          ))}
          <section className="tile flex flex-col gap-2 p-3" aria-label={t("ungrouped")}>
            <header className="flex items-center gap-2">
              <span className="font-medium text-foreground">{t("ungrouped")}</span>
              <Pill tone={state.ungrouped.length ? "warn" : "neutral"}>{state.ungrouped.length}</Pill>
            </header>
            <p className="text-xs text-muted-foreground">{t("ungroupedHint")}</p>
            <Members state={state} edit={edit} members={state.ungrouped} groupId={null} />
          </section>
        </div>
        {!state.groups.length && !edit && <EmptyState icon={Users} title={t("title")} description={t("empty")} />}
      </div>
    </Panel>
  );
}

function useChange() {
  const { t } = deskGroupsI18n.useT();
  const { toast } = useToast();
  const change = useDeskGroupsChange();
  const run = (c: Parameters<typeof change.mutate>[0], done?: () => void) =>
    change.mutate(c, {
      onSuccess: () => { toast({ title: t("saved") }); done?.(); },
      onError: (e) => toast({ title: t("saveFailed"), description: (e as Error).message, variant: "destructive" }),
    });
  return { run, pending: change.isPending };
}

function CuratorSelect({ state, value, onChange, disabled, label }: { state: DeskGroupsState; value: number | null; onChange: (id: number | null) => void; disabled?: boolean; label: string }) {
  const { t } = deskGroupsI18n.useT();
  return (
    <Select value={value == null ? NONE : String(value)} onValueChange={(v) => onChange(v === NONE ? null : Number(v))} disabled={disabled}>
      <SelectTrigger className="h-8 min-w-0 text-sm" aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{t("noCurator")}</SelectItem>
        {state.curators.map((c) => <SelectItem key={c.id} value={String(c.id)}>{personName(c.name)}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function AddGroup({ state }: { state: DeskGroupsState }) {
  const { t } = deskGroupsI18n.useT();
  const { run, pending } = useChange();
  const [name, setName] = React.useState("");
  const [curatorId, setCuratorId] = React.useState<number | null>(null);
  const problem = name.trim() ? groupNameProblem(name, state.groups) : null;
  const submit = () => {
    if (groupNameProblem(name, state.groups) || pending) return;
    run({ op: "create", name: name.trim(), curatorId }, () => { setName(""); setCuratorId(null); });
  };
  return (
    <form className="flex flex-col gap-2 sm:flex-row sm:items-center" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <Input className="h-9 sm:max-w-xs" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("newName")} aria-label={t("newName")} aria-invalid={problem === "taken" || undefined} />
      <div className="sm:w-48"><CuratorSelect state={state} value={curatorId} onChange={setCuratorId} label={t("curator")} /></div>
      <Button type="submit" size="sm" disabled={!name.trim() || !!problem || pending}><Plus className="mr-1 h-4 w-4" aria-hidden="true" />{t("add")}</Button>
    </form>
  );
}

function GroupCard({ state, edit, group }: { state: DeskGroupsState; edit: boolean; group: DeskGroupsState["groups"][number] }) {
  const { t } = deskGroupsI18n.useT();
  const { run, pending } = useChange();
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = React.useState(false);
  const renameProblem = renaming != null ? groupNameProblem(renaming, state.groups, group.id) : null;
  return (
    <section className="tile flex flex-col gap-2 p-3" aria-label={group.name}>
      <header className="flex flex-wrap items-center gap-2">
        {renaming != null ? (
          <form className="flex min-w-0 flex-1 gap-1" onSubmit={(e) => { e.preventDefault(); if (!renameProblem) run({ op: "update", id: group.id, name: renaming.trim() }, () => setRenaming(null)); }}>
            <Input className="h-8 min-w-0 flex-1" maxLength={60} value={renaming} onChange={(e) => setRenaming(e.target.value)} autoFocus aria-label={t("rename")} />
            <Button type="submit" size="sm" disabled={!!renameProblem || pending}>{t("save")}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(null)}>{t("cancel")}</Button>
          </form>
        ) : (
          <>
            <span className="min-w-0 truncate font-medium text-foreground">{group.name}</span>
            <Pill tone="neutral">{t("members", { count: group.members.length })}</Pill>
            {edit && (
              <span className="ml-auto flex gap-1">
                <Button type="button" size="icon" variant="ghost" className="h-7 w-7" title={t("rename")} aria-label={t("rename")} onClick={() => setRenaming(group.name)}><Pencil className="h-3.5 w-3.5" aria-hidden="true" /></Button>
                <Button
                  type="button" size="sm" variant={confirmArchive ? "destructive" : "ghost"} className="h-7 px-2 text-xs" disabled={pending}
                  onClick={() => (confirmArchive ? run({ op: "update", id: group.id, archived: true }) : setConfirmArchive(true))}
                  onBlur={() => setConfirmArchive(false)}
                  title={t("archiveConfirm")}
                >
                  <Archive className="mr-1 h-3.5 w-3.5" aria-hidden="true" />{confirmArchive ? t("archiveConfirm") : t("archive")}
                </Button>
              </span>
            )}
          </>
        )}
      </header>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="shrink-0">{t("curator")}</span>
        {edit ? (
          <span className="min-w-0 flex-1"><CuratorSelect state={state} value={group.curatorId} disabled={pending} label={t("curator")} onChange={(id) => run({ op: "update", id: group.id, curatorId: id })} /></span>
        ) : (
          <span className="text-sm text-foreground">{group.curatorName ? personName(group.curatorName) : t("noCurator")}</span>
        )}
      </label>
      <Members state={state} edit={edit} members={group.members} groupId={group.id} />
    </section>
  );
}

function Members({ state, edit, members, groupId }: { state: DeskGroupsState; edit: boolean; members: GroupMember[]; groupId: number | null }) {
  const { t } = deskGroupsI18n.useT();
  const { run, pending } = useChange();
  if (!members.length) return <p className="text-xs text-muted-foreground">{t("empty")}</p>;
  const targets = moveTargets(state, groupId);
  return (
    <ul className="flex flex-col gap-1">
      {members.map((m) => (
        <li key={m.id} className="flex items-center gap-2 text-sm">
          <span className="min-w-0 flex-1 truncate">{personName(m.name)}</span>
          {edit && (
            <Select value={groupId == null ? NONE : String(groupId)} disabled={pending} onValueChange={(v) => { const to = targets.find((x) => x.value === v); if (to && to.groupId !== groupId) run({ op: "move", userId: m.id, groupId: to.groupId }); }}>
              <SelectTrigger className="h-7 w-40 text-xs" aria-label={t("moveTo", { name: personName(m.name) })}><SelectValue /></SelectTrigger>
              <SelectContent>
                {targets.map((x) => <SelectItem key={x.value} value={x.value}>{x.name ?? t("ungrouped")}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </li>
      ))}
    </ul>
  );
}
