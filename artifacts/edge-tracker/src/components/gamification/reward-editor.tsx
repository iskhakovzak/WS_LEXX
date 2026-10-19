import { useEffect, useState } from "react";
import { Gift, Pencil, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QueryError } from "@/components/query-error";
import { ListSkeleton, Panel, Pill } from "@/components/ds";
import { levelName } from "@/components/shared/badges";
import { masteryLevelName, setupShortName } from "@/components/shared/gamification-labels";
import { useToast } from "@/hooks/use-toast";
import { humanizeApiError } from "@/lib/api/errors";
import { cn } from "@/lib/utils";
import type { RewardItem } from "@/lib/gamification/types";
import { gamificationI18n } from "@/i18n/ns/gamification";
import { useRewardCatalog, useSaveRewardItem, type RewardOptions } from "./api";
import {
  ACH_TIERS, CONDITION_KINDS, KNOWN_ACHIEVEMENTS, PROBLEM_FIELD, achievementName, bodyOf, conditionText, draftOf, tierHint, tierName, tierOption, withActive,
  type ConditionKind, type DraftProblem, type RewardDraft,
} from "./model";

const ANY = "__any__";
const FIELD = "flex min-w-0 flex-col gap-1.5";

function optionsOf(o: RewardOptions | undefined): RewardOptions {
  return {
    achievements: o?.achievements?.length ? o.achievements : KNOWN_ACHIEVEMENTS.map((id) => ({ id, tiers: [...ACH_TIERS] })),
    levels: o?.levels && o.levels > 0 ? o.levels : 5,
    setups: o?.setups ?? [],
  };
}

/** The condition part of the form: kind → its own fields (achievement + tier, level, season place, setup + mastery level). */
/** A field's own problem, right under it (OWNER-32: not at the bottom of the form). */
function FieldError({ id, text }: { id: string; text: string | null }) {
  return text ? <p id={id} className="text-xs text-down" role="alert">{text}</p> : null;
}

function ConditionFields({ d, set, options }: { d: RewardDraft; set: (p: Partial<RewardDraft>) => void; options: RewardOptions }) {
  const { t } = gamificationI18n.useT();
  const line = options.achievements.find((a) => a.id === d.ref);
  const tiersOf = line?.tiers ?? [...ACH_TIERS];
  const targetOf = (tier: string) => line?.targets?.[tiersOf.indexOf(tier)];
  const pickedTarget = d.tier ? targetOf(d.tier) : undefined;
  const pickedHint = d.tier && pickedTarget != null ? tierHint(d.ref, pickedTarget) : "";
  const onKind = (k: ConditionKind) => {
    if (k === "achievement") set({ kind: k, ref: options.achievements[0]?.id ?? "", tier: "" });
    else if (k === "level") set({ kind: k, ref: "2", tier: "" });
    else if (k === "season_rank") set({ kind: k, ref: "season", rank: d.rank || "3", tier: "" });
    else set({ kind: k, ref: "", tier: "4" });
  };
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className={FIELD}>
        <Label htmlFor="rw-kind">{t("editor.fieldKind")}</Label>
        <Select value={d.kind} onValueChange={(v) => onKind(v as ConditionKind)}>
          <SelectTrigger id="rw-kind"><SelectValue /></SelectTrigger>
          <SelectContent>{CONDITION_KINDS.map((k) => <SelectItem key={k} value={k}>{t(`editor.kind.${k}`)}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {d.kind === "achievement" && (
        <>
          <div className={FIELD}>
            <Label htmlFor="rw-ref">{t("editor.fieldRef")}</Label>
            <Select value={d.ref || undefined} onValueChange={(v) => set({ ref: v, tier: "" })}>
              <SelectTrigger id="rw-ref"><SelectValue placeholder={t("editor.refRequired")} /></SelectTrigger>
              <SelectContent>{options.achievements.map((a) => <SelectItem key={a.id} value={a.id}>{achievementName(a.id)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className={FIELD}>
            <Label htmlFor="rw-tier">{t("editor.fieldTier")}</Label>
            <Select value={d.tier || ANY} onValueChange={(v) => set({ tier: v === ANY ? "" : v })}>
              <SelectTrigger id="rw-tier"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>{t("editor.anyTier")}</SelectItem>
                {tiersOf.map((x) => <SelectItem key={x} value={x}>{tierOption(x, targetOf(x))}</SelectItem>)}
              </SelectContent>
            </Select>
            {pickedHint && <span className="text-xs text-muted-foreground">{t("editor.tierTarget", { tier: tierName(d.tier), hint: pickedHint })}</span>}
          </div>
        </>
      )}
      {d.kind === "level" && (
        <div className={FIELD}>
          <Label htmlFor="rw-level">{t("editor.fieldLevel")}</Label>
          <Select value={d.ref || "2"} onValueChange={(v) => set({ ref: v })}>
            <SelectTrigger id="rw-level"><SelectValue /></SelectTrigger>
            <SelectContent>{Array.from({ length: options.levels }, (_, i) => <SelectItem key={i} value={String(i)}>{levelName(i)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      )}
      {d.kind === "season_rank" && (
        <div className={FIELD}>
          <Label htmlFor="rw-rank">{t("editor.fieldRank")}</Label>
          <Input id="rw-rank" type="number" inputMode="numeric" min={1} max={50} value={d.rank} onChange={(e) => set({ rank: e.target.value })} />
        </div>
      )}
      {d.kind === "mastery" && (
        <>
          <div className={FIELD}>
            <Label htmlFor="rw-setup">{t("editor.fieldSetup")}</Label>
            {options.setups.length ? (
              <Select value={d.ref || ANY} onValueChange={(v) => set({ ref: v === ANY ? "" : v })}>
                <SelectTrigger id="rw-setup"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>{t("editor.anySetup")}</SelectItem>
                  {options.setups.map((s) => <SelectItem key={s.id} value={s.code ?? String(s.id)}>{s.code ? `${s.code} ${setupShortName(s.code, s.name)}` : s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <Input id="rw-setup" value={d.ref} placeholder={t("editor.fieldSetupPlaceholder")} maxLength={20} onChange={(e) => set({ ref: e.target.value })} />
            )}
          </div>
          <div className={FIELD}>
            <Label htmlFor="rw-mlevel">{t("editor.fieldMasteryLevel")}</Label>
            <Select value={d.tier || "4"} onValueChange={(v) => set({ tier: v })}>
              <SelectTrigger id="rw-mlevel"><SelectValue /></SelectTrigger>
              <SelectContent>{[1, 2, 3, 4].map((l) => <SelectItem key={l} value={String(l)}>{masteryLevelName(l)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </>
      )}
    </div>
  );
}

function ItemDialog({ open, onOpenChange, item, options }: { open: boolean; onOpenChange: (v: boolean) => void; item: RewardItem | null; options: RewardOptions }) {
  const { t } = gamificationI18n.useT();
  const { toast } = useToast();
  const save = useSaveRewardItem();
  const [d, setD] = useState<RewardDraft>(() => draftOf(item));
  const [problem, setProblem] = useState<DraftProblem | null>(null);
  useEffect(() => {
    if (!open) return;
    const base = draftOf(item);
    setD(item ? base : { ...base, ref: options.achievements[0]?.id ?? "" });
    setProblem(null);
  }, [open, item, options.achievements]);
  const set = (p: Partial<RewardDraft>) => { setProblem(null); setD((x) => ({ ...x, ...p })); };
  const submit = () => {
    const r = bodyOf(d, item?.stock ?? null);
    if (!r.ok) {
      setProblem(r.problem);
      const field = PROBLEM_FIELD[r.problem];
      document.getElementById(field === "condition" ? "rw-kind" : `rw-${field}`)?.focus();
      return;
    }
    save.mutate({ id: item?.id ?? null, body: r.body }, {
      onSuccess: () => { toast({ title: t("editor.saved") }); onOpenChange(false); },
      onError: (e) => toast({ title: t("editor.failed"), description: humanizeApiError(e), variant: "destructive" }),
    });
  };
  const errorAt = (field: "title" | "condition" | "stock") => (problem && PROBLEM_FIELD[problem] === field ? t(`editor.${problem}`) : null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{item ? t("editor.editTitle", { title: item.title }) : t("editor.newTitle")}</DialogTitle>
          <DialogDescription>{t("editor.description")}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div className={FIELD}>
            <Label htmlFor="rw-title">{t("editor.fieldTitle")}</Label>
            <Input
              id="rw-title" value={d.title} maxLength={120} placeholder={t("editor.fieldTitlePlaceholder")} onChange={(e) => set({ title: e.target.value })}
              aria-invalid={!!errorAt("title")} aria-describedby={errorAt("title") ? "rw-title-error" : undefined}
            />
            <FieldError id="rw-title-error" text={errorAt("title")} />
          </div>
          <div className={FIELD}>
            <Label htmlFor="rw-desc">{t("editor.fieldDescription")}</Label>
            <Textarea id="rw-desc" rows={2} maxLength={500} value={d.description} placeholder={t("editor.fieldDescriptionPlaceholder")} onChange={(e) => set({ description: e.target.value })} />
          </div>
          <ConditionFields d={d} set={set} options={options} />
          <FieldError id="rw-condition-error" text={errorAt("condition")} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className={FIELD}>
              <Label htmlFor="rw-stock">{t("editor.fieldStock")}</Label>
              <Input
                id="rw-stock" type="number" inputMode="numeric" min={1} step={1} value={d.stock} placeholder={t("editor.unlimited")} onChange={(e) => set({ stock: e.target.value })}
                aria-invalid={!!errorAt("stock")} aria-describedby={errorAt("stock") ? "rw-stock-error" : undefined}
              />
              {errorAt("stock") ? <FieldError id="rw-stock-error" text={errorAt("stock")} /> : <span className="text-xs text-muted-foreground">{t("editor.fieldStockHint")}</span>}
            </div>
            <div className="flex min-w-0 items-start justify-between gap-3 sm:pt-6">
              <span className="flex min-w-0 flex-col">
                <Label htmlFor="rw-active">{t("editor.fieldActive")}</Label>
                <span className="text-xs text-muted-foreground">{t("editor.fieldActiveHint")}</span>
              </span>
              <Switch id="rw-active" checked={d.active} onCheckedChange={(v) => set({ active: v })} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{t("editor.cancel")}</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending ? t("editor.saving") : t("editor.save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Presentational list for the admin: title, condition, stock, inactive mark, the on/off switch, «Изменить». */
export function RewardItemsList({ items, onEdit, onToggle, busy = false }: {
  items: readonly RewardItem[];
  onEdit: (item: RewardItem) => void;
  /** Inline on/off (OWNER-19); without it no switch is shown. */
  onToggle?: (item: RewardItem, active: boolean) => void;
  busy?: boolean;
}) {
  const { t } = gamificationI18n.useT();
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{t("editor.empty")}</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((it) => (
        <li key={it.id} className={cn("tile flex min-w-0 items-center gap-3 px-3 py-2", !it.active && "opacity-70")}>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2">
              <span className="min-w-0 truncate text-sm font-semibold text-foreground">{it.title}</span>
              {!it.active && <Pill tone="neutral">{t("editor.inactive")}</Pill>}
            </span>
            <span className="text-xs text-muted-foreground">
              {conditionText(it.condition)} · {it.stock == null ? t("editor.unlimited") : t("rewards.stock", { count: it.stock })}
            </span>
          </div>
          {onToggle && (
            <Switch
              checked={it.active}
              disabled={busy}
              onCheckedChange={(v) => onToggle(it, v)}
              aria-label={t(it.active ? "editor.toggleOff" : "editor.toggleOn", { title: it.title })}
            />
          )}
          <Button type="button" size="sm" variant="ghost" onClick={() => onEdit(it)} aria-label={`${t("editor.edit")}: ${it.title}`}>
            <Pencil aria-hidden="true" />
            <span className="hidden sm:inline">{t("editor.edit")}</span>
          </Button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Admin console → «Настройки деска» → «Каталог наград»: real prizes with a condition (achievement / level / season place /
 * setup mastery), stock and an active switch. Requests are granted from the curator «Сегодня» list.
 */
export function RewardsEditorPanel({ enabled = true }: { enabled?: boolean }) {
  const { t } = gamificationI18n.useT();
  const q = useRewardCatalog(enabled);
  const { toast } = useToast();
  const save = useSaveRewardItem();
  const [dialog, setDialog] = useState<{ open: boolean; item: RewardItem | null }>({ open: false, item: null });
  const toggle = (item: RewardItem, active: boolean) =>
    save.mutate({ id: item.id, body: withActive(item, active) }, {
      onSuccess: () => toast({ title: t("editor.toggled") }),
      onError: (e) => toast({ title: t("editor.failed"), description: humanizeApiError(e), variant: "destructive" }),
    });
  if (!enabled) return null;
  if (q.isLoading) return <Panel title={t("editor.title")} icon={Gift}><ListSkeleton rows={3} /></Panel>;
  if (q.isError) return <QueryError error={q.error} title={t("editor.loadFailed")} onRetry={() => q.refetch()} />;
  if (!q.data) return null; // an older API without the catalog
  const options = optionsOf(q.data.options);
  const pending = q.data.pending ?? 0;
  return (
    <Panel
      title={t("editor.title")}
      icon={Gift}
      description={t("editor.description")}
      actions={
        <div className="flex items-center gap-2">
          {pending > 0 && <Pill tone="warn">{t("editor.requests", { count: pending })}</Pill>}
          <Button type="button" size="sm" onClick={() => setDialog({ open: true, item: null })} aria-label={t("editor.add")}>
            <Plus aria-hidden="true" />
            <span className="hidden sm:inline">{t("editor.add")}</span>
          </Button>
        </div>
      }
    >
      <RewardItemsList items={q.data.items} onEdit={(item) => setDialog({ open: true, item })} onToggle={toggle} busy={save.isPending} />
      <ItemDialog open={dialog.open} onOpenChange={(v) => setDialog((s) => ({ ...s, open: v }))} item={dialog.item} options={options} />
    </Panel>
  );
}
