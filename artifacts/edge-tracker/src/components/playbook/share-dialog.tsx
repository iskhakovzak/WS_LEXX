/**
 * «Поделиться» — a senior (or curator) opens their personal setup to everyone, to specific people or to a cohort.
 * Readers see the author and can copy it into «Мой». «Только я» revokes access. POST /api/playbook/:id/share.
 */
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Globe2, Loader2, Lock, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { invalidatePlaybook, notLiveMessage, useShareTargets } from "./api";
import { http } from "@/lib/api/http";
import type { PlaybookEntry, Visibility } from "./model";
import { fmtDate } from "@/lib/format";

const OPTIONS: { value: Visibility; label: string; hint: string; icon: typeof Lock }[] = [
  { value: "private", label: "Только я", hint: "Видите вы и кураторы", icon: Lock },
  { value: "all", label: "Весь офис", hint: "Все трейдеры видят сетап и эталоны", icon: Globe2 },
  { value: "custom", label: "Выбранные", hint: "Конкретные люди и потоки академии", icon: Users },
];

export function ShareDialog({ open, onOpenChange, entry }: { open: boolean; onOpenChange: (v: boolean) => void; entry: PlaybookEntry }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const targets = useShareTargets(open);
  const [vis, setVis] = React.useState<Visibility>("private");
  const [users, setUsers] = React.useState<Set<string>>(new Set());
  const [cohorts, setCohorts] = React.useState<Set<number>>(new Set());
  const [filter, setFilter] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setVis((entry.visibility as Visibility) ?? "private");
    setUsers(new Set(entry.sharedWith?.users ?? []));
    setCohorts(new Set(entry.sharedWith?.cohorts ?? []));
    setFilter("");
  }, [open, entry]);

  const toggle = <T,>(set: Set<T>, v: T) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n; };
  const nothingPicked = vis === "custom" && users.size === 0 && cohorts.size === 0;

  async function save() {
    setSaving(true);
    try {
      await http.post(`/api/playbook/${entry.id}/share`, { visibility: nothingPicked ? "private" : vis, users: [...users], cohorts: [...cohorts] });
      invalidatePlaybook(qc, entry.id);
      toast({ title: vis === "private" || nothingPicked ? "Доступ закрыт — сетап снова личный" : vis === "all" ? "Сетап открыт всему офису" : "Доступ выдан выбранным" });
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Не удалось изменить доступ", description: notLiveMessage(e) ?? (e as Error)?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const people = (targets.data?.users ?? []).filter((u) => !filter.trim() || u.name.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] max-w-xl flex-col overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Поделиться «{entry.name}»</DialogTitle>
          <DialogDescription>Читатели видят вас как автора и могут скопировать сетап к себе. Править его можете только вы.</DialogDescription>
        </DialogHeader>

        <div role="radiogroup" aria-label="Кто видит" className="grid gap-2">
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={vis === o.value}
              onClick={() => setVis(o.value)}
              className={cn(
                "flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors duration-[var(--dur-1)]",
                vis === o.value ? "border-primary/60 bg-primary/5" : "border-border/60 hover:bg-[var(--glass-hover-bg)]",
              )}
            >
              <o.icon className={cn("mt-0.5 h-4 w-4 shrink-0", vis === o.value ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
              <span>
                <span className="block text-sm font-medium text-foreground">{o.label}</span>
                <span className="block text-xs text-muted-foreground">{o.hint}</span>
              </span>
            </button>
          ))}
        </div>

        {vis === "custom" && (
          <div className="flex flex-col gap-3">
            {targets.isLoading ? (
              <div className="h-32 animate-pulse rounded-xl bg-[var(--glass-bg)] motion-reduce:animate-none" />
            ) : targets.isError ? (
              <p className="text-sm text-down">{notLiveMessage(targets.error) ?? (targets.error as Error)?.message}</p>
            ) : (
              <>
                {(targets.data?.cohorts.length ?? 0) > 0 && (
                  <fieldset>
                    <legend className="mb-1.5 text-xs text-muted-foreground">Потоки академии</legend>
                    <div className="flex flex-wrap gap-1.5">
                      {targets.data!.cohorts.map((c) => (
                        <button key={c.id} type="button" aria-pressed={cohorts.has(c.id)} onClick={() => setCohorts((s) => toggle(s, c.id))} className="chip min-h-8 px-3 text-xs">
                          {c.name} <span className="tabular-nums text-muted-foreground">{c.members}</span>
                        </button>
                      ))}
                    </div>
                  </fieldset>
                )}
                <fieldset>
                  <legend className="mb-1.5 text-xs text-muted-foreground">Люди{users.size > 0 ? ` · выбрано ${users.size}` : ""}</legend>
                  <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Найти по имени" aria-label="Найти по имени" className="mb-2 h-9" />
                  <ul className="flex max-h-[min(45dvh,360px)] flex-col gap-1 overflow-y-auto">
                    {people.map((u) => (
                      <li key={u.name} className="flex min-h-9 items-center gap-2 rounded-lg px-1 text-sm hover:bg-[var(--glass-hover-bg)]">
                        <Checkbox id={`sh-${u.name}`} checked={users.has(u.name)} onCheckedChange={() => setUsers((s) => toggle(s, u.name))} />
                        <label htmlFor={`sh-${u.name}`} className="flex min-h-9 flex-1 cursor-pointer items-center">{u.name}</label>
                        <span className="text-xs text-muted-foreground">{u.role === "curator" ? "куратор" : u.role === "admin" ? "админ" : ""}</span>
                      </li>
                    ))}
                    {people.length === 0 && <li className="px-1 py-3 text-sm text-muted-foreground">Никого не найдено</li>}
                  </ul>
                </fieldset>
                {nothingPicked && <p className="text-xs text-[hsl(var(--chart-3))]">Выберите людей или поток — иначе сетап останется личным.</p>}
              </>
            )}
          </div>
        )}

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {entry.sharedAt && entry.visibility !== "private" ? `Открыт ${fmtDate(entry.sharedAt, "short")}` : ""}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              {vis === "private" || nothingPicked ? "Сделать личным" : "Открыть доступ"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
