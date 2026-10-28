/**
 * «Торговые поды» in the curator cabinet («Мои трейдеры»): per group the curator leads (an admin: every group) the
 * pods with their members; «Новый под» = a name and a pick of 2–4 traders of the group (those already in another pod
 * are shown, not pickable); a pod can be edited or disbanded. Renders nothing for a curator without a group.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Pencil, Plus, UsersRound } from "lucide-react";
import { Panel, Pill } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { humanizeApiError } from "@/lib/api/errors";
import { personName } from "@/i18n";
import { podsI18n } from "@/i18n/ns/pods";
import { podsHomeQuery, usePodMutations, type ManagedGroup, type Pod } from "./api";

type Draft = { podId: number | null; groupId: number; name: string; memberIds: number[] };

function PodForm({ draft, group, pods, limits, onClose }: { draft: Draft; group: ManagedGroup; pods: Pod[]; limits: { min: number; max: number }; onClose: () => void }) {
  const { t } = podsI18n.useT();
  const { toast } = useToast();
  const mut = usePodMutations(null);
  const [f, setF] = React.useState(draft);
  const taken = new Map<number, string>();
  for (const p of pods) if (p.id !== f.podId) for (const m of p.members) taken.set(m.id, p.name);
  const toggle = (id: number) => setF((x) => ({ ...x, memberIds: x.memberIds.includes(id) ? x.memberIds.filter((i) => i !== id) : [...x.memberIds, id] }));
  const valid = !!f.name.trim() && f.memberIds.length >= limits.min && f.memberIds.length <= limits.max;
  const opts = {
    onSuccess: () => { toast({ title: t("manage.saved") }); onClose(); },
    onError: (e: unknown) => toast({ title: t("manage.saveFailed"), description: humanizeApiError(e), variant: "destructive" }),
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    if (f.podId == null) mut.create.mutate({ groupId: f.groupId, name: f.name.trim(), memberIds: f.memberIds }, opts);
    else mut.update.mutate({ id: f.podId, name: f.name.trim(), memberIds: f.memberIds }, opts);
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-xl border border-dashed border-border p-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor={`pod-name-${group.id}`}>{t("manage.name")}</Label>
        <Input id={`pod-name-${group.id}`} value={f.name} maxLength={60} placeholder={t("manage.namePlaceholder")} autoFocus onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} />
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium">{t("manage.members", { count: f.memberIds.length })}</legend>
        <p className="text-xs text-muted-foreground">{t("manage.pickHint", limits)}</p>
        {!group.traders.length && <p className="text-sm text-muted-foreground">{t("manage.noTraders")}</p>}
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {group.traders.map((tr) => {
            const other = taken.get(tr.id);
            return (
              <label key={tr.id} className="flex items-center gap-2 text-sm">
                <Checkbox checked={f.memberIds.includes(tr.id)} disabled={!!other} onCheckedChange={() => toggle(tr.id)} />
                <span>{personName(tr.name)}</span>
                {other && <span className="text-xs text-muted-foreground">{t("manage.inOther", { pod: other })}</span>}
              </label>
            );
          })}
        </div>
      </fieldset>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!valid || mut.create.isPending || mut.update.isPending}>{f.podId == null ? t("manage.create") : t("manage.save")}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>{t("manage.cancel")}</Button>
      </div>
    </form>
  );
}

export function PodsManager() {
  const { t } = podsI18n.useT();
  const { toast } = useToast();
  const q = useQuery(podsHomeQuery());
  const mut = usePodMutations(null);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const managed = q.data?.managed;
  if (!managed) return null;
  const limits = q.data!.limits;
  const disband = (p: Pod) => mut.update.mutate({ id: p.id, archived: true }, {
    onSuccess: () => toast({ title: t("manage.archived") }),
    onError: (e) => toast({ title: t("manage.saveFailed"), description: humanizeApiError(e), variant: "destructive" }),
  });
  return (
    <Panel icon={UsersRound} title={t("manage.title")} description={t("manage.description", limits)}>
      <div className="flex flex-col gap-4">
        {managed.groups.map((g) => {
          const pods = managed.pods.filter((p) => p.groupId === g.id);
          return (
            <section key={g.id} aria-label={t("manage.group", { name: g.name })} className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold text-foreground">{t("manage.group", { name: g.name })}</h4>
                {draft?.groupId !== g.id && g.traders.length >= limits.min && (
                  <Button size="sm" variant="outline" className="ml-auto" onClick={() => setDraft({ podId: null, groupId: g.id, name: "", memberIds: [] })}><Plus aria-hidden="true" />{t("manage.add")}</Button>
                )}
              </div>
              {draft?.groupId === g.id && <PodForm draft={draft} group={g} pods={pods} limits={limits} onClose={() => setDraft(null)} />}
              {!pods.length && draft?.groupId !== g.id && <p className="text-sm text-muted-foreground">{t("manage.empty")}</p>}
              <ul className="flex flex-col gap-1.5">
                {pods.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-[var(--glass-border)] px-3 py-2 text-sm">
                    <span className="font-medium text-foreground">{p.name}</span>
                    {p.members.map((m) => <Pill key={m.id} tone="neutral">{personName(m.name)}</Pill>)}
                    <span className="ml-auto flex gap-1">
                      <Button size="sm" variant="ghost" className="h-7" onClick={() => setDraft({ podId: p.id, groupId: g.id, name: p.name, memberIds: p.members.map((m) => m.id) })}><Pencil aria-hidden="true" />{t("manage.edit")}</Button>
                      <Button size="sm" variant="ghost" className="h-7" disabled={mut.update.isPending} onClick={() => disband(p)}>{t("manage.archive")}</Button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </Panel>
  );
}
