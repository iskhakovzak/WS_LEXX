import * as React from "react";
import { Swords } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { humanizeApiError } from "@/lib/api/errors";
import { cn } from "@/lib/utils";
import { fmtDate, localeTag } from "@/lib/format";
import { addDays, nyDate } from "@/lib/trading-date";
import { personName } from "@/i18n";
import { commonI18n } from "@/i18n/ns/common";
import { questsI18n } from "@/i18n/ns/quests";
import { curatorI18n } from "@/i18n/ns/curator";
import type { Quest } from "@/lib/quests/types";
import { MANUAL_TEMPLATE, useAssignQuest, useQuestTemplates, useTraderQuests, type QuestTemplate } from "./api";
import { defaultDeadline, textOf } from "./model";

const tplTitle = (t: QuestTemplate) => textOf(t.title, `quest.${t.template}.title`, { count: t.defaultTarget }) ?? t.template;
const tplDesc = (t: QuestTemplate) => textOf(t.description, `quest.${t.template}.desc`, { count: t.defaultTarget }) ?? "";

/** Weekdays from `today` to `endsOn`, both inclusive (YYYY-MM-DD, NY): the days left to make progress. */
export function remainingTradingDays(today: string, endsOn: string): number {
  if (!today || !endsOn || endsOn < today) return 0;
  let n = 0;
  for (let d = today, i = 0; d <= endsOn && i < 400; d = addDays(d, 1), i++) {
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

/**
 * Target prefill (OLGA-10): a «days» quest gets the trading days left minus 2 (min 1) — a reachable goal, not the
 * hardest possible one; other units keep the catalog default. Always within the template bounds.
 */
export function suggestedTarget(def: Pick<QuestTemplate, "unit" | "defaultTarget" | "minTarget" | "maxTarget">, today: string, endsOn: string): number {
  const raw = def.unit === "days" ? Math.min(def.defaultTarget, Math.max(1, remainingTradingDays(today, endsOn) - 2)) : def.defaultTarget;
  return Math.max(def.minTarget, Math.min(def.maxTarget, raw));
}

/** The trader's active quest of the same template (any scope: the weekly catalog one counts too). Manual tasks never clash. */
export function activeDuplicate(quests: readonly Quest[] | undefined, template: string | null): Quest | null {
  if (!quests || !template || template === MANUAL_TEMPLATE) return null;
  return quests.find((q) => q.template === template && q.status === "active" && !q.cancelled) ?? null;
}

/**
 * «Дать квест»: pick a template (plain-language description), target, deadline (prefilled: Friday), reward points
 * (prefilled from the settings via the catalog) and a note. Progress is tracked by the server from the trader's data.
 */
export function AssignQuestDialog({ open, onOpenChange, trader, today = nyDate() }: { open: boolean; onOpenChange: (v: boolean) => void; trader: string; today?: string }) {
  const { t } = questsI18n.useT();
  const tc = commonI18n.useT().t;
  const { toast } = useToast();
  const q = useQuestTemplates(open);
  const templates = React.useMemo(() => q.data?.templates ?? [], [q.data]);
  const maxPoints = q.data?.maxPoints ?? null;
  const maxEnd = q.data?.maxDeadlineDays != null ? addDays(today, q.data.maxDeadlineDays) : null;
  const [template, setTemplate] = React.useState<string | null>(null);
  const [target, setTarget] = React.useState("");
  const [endsOn, setEndsOn] = React.useState(defaultDeadline(today));
  const [points, setPoints] = React.useState("");
  const [note, setNote] = React.useState("");
  const def = templates.find((x) => x.template === template) ?? null;
  const save = useAssignQuest();
  // The trader's quests: warn about a template they already have running (OLGA-10).
  const existing = useTraderQuests(open ? trader : null).data?.quests;
  const dup = activeDuplicate(existing, template);

  React.useEffect(() => {
    if (!open) return;
    setEndsOn(defaultDeadline(today));
    setNote("");
    setTemplate(null);
  }, [open, today]);
  React.useEffect(() => {
    // Preselect the first template the trader does not already have running.
    if (open && !template && templates.length) setTemplate((templates.find((x) => !activeDuplicate(existing, x.template)) ?? templates[0]).template);
  }, [open, template, templates, existing]);
  React.useEffect(() => {
    if (!def) return;
    setPoints(String(def.defaultPoints));
  }, [def?.template]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (!def) return;
    setTarget(String(suggestedTarget(def, today, endsOn)));
  }, [def?.template, endsOn, today]); // eslint-disable-line react-hooks/exhaustive-deps

  const n = Number(target);
  const p = points === "" ? null : Number(points);
  const targetOk = !!def && Number.isInteger(n) && n >= def.minTarget && n <= def.maxTarget;
  const dateOk = !!endsOn && endsOn >= today && (maxEnd == null || endsOn <= maxEnd);
  // The manual task: the note IS the task (the trader reads it), the target is always 1.
  const manual = def?.template === MANUAL_TEMPLATE;
  const noteOk = !manual || note.trim().length >= 3;
  const valid = targetOk && dateOk && noteOk && (p == null || (Number.isInteger(p) && p >= 0 && (maxPoints == null || p <= maxPoints)));

  const submit = () => {
    if (!valid || !def || save.isPending) return;
    save.mutate(
      { trader, template: def.template, target: n, endsOn, rewardPoints: p ?? undefined, note: note.trim() || undefined },
      {
        onSuccess: () => {
          toast({ title: t("assign.done"), description: t("assign.doneText", { name: personName(trader) }) });
          onOpenChange(false);
        },
        onError: (e) => toast({ title: t("assign.failed"), description: humanizeApiError(e), variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!save.isPending) onOpenChange(v); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Swords className="h-4 w-4 text-primary" aria-hidden="true" />{t("assign.title", { name: personName(trader) })}</DialogTitle>
            <DialogDescription>{t("assign.description")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5" role="radiogroup" aria-label={t("assign.template")}>
            <span className="micro-label">{t("assign.template")}</span>
            {q.isLoading ? <div className="h-32" aria-hidden="true" /> : templates.map((x) => (
              <button
                key={x.template}
                type="button"
                role="radio"
                aria-checked={template === x.template}
                onClick={() => setTemplate(x.template)}
                className={cn("tile flex flex-col items-start gap-0.5 px-3 py-2 text-left", template === x.template && "ring-2 ring-primary")}
              >
                <span className="text-sm font-medium text-foreground">{tplTitle(x)}</span>
                <span className="text-xs leading-snug text-muted-foreground">{tplDesc(x)}</span>
                {activeDuplicate(existing, x.template) && <span className="text-2xs font-medium text-warn">{curatorI18n.t("questAssign.alreadyHas")}</span>}
              </button>
            ))}
            {dup && (
              <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn" role="status">
                {curatorI18n.t(dup.endsOn ? "questAssign.duplicate" : "questAssign.duplicateNoDate", {
                  name: personName(trader), progress: dup.progress, target: dup.target, date: dup.endsOn ? fmtDate(dup.endsOn, "dayMonth") : "",
                })}
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {!manual && <div className="flex flex-col gap-1.5">
              <Label htmlFor="quest-target" className="text-xs text-muted-foreground">{t("assign.target")}{def ? `, ${t(`assign.unit.${def.unit}`)}` : ""}</Label>
              <Input id="quest-target" type="number" inputMode="numeric" min={def?.minTarget} max={def?.maxTarget} value={target} onChange={(e) => setTarget(e.target.value)} className="tabular-nums" aria-invalid={!!def && !targetOk} />
              {def && <span className={cn("text-2xs", targetOk ? "text-muted-foreground" : "text-down")}>{t("assign.targetRange", { min: def.minTarget, max: def.maxTarget })}</span>}
            </div>}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="quest-points" className="text-xs text-muted-foreground">{t("assign.points")}</Label>
              <Input id="quest-points" type="number" inputMode="numeric" min={0} max={maxPoints ?? undefined} value={points} onChange={(e) => setPoints(e.target.value)} className="tabular-nums" />
              {maxPoints != null && <span className={cn("text-2xs", p != null && p > maxPoints ? "text-down" : "text-muted-foreground")}>{t("assign.pointsMax", { max: maxPoints })}</span>}
            </div>
            <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-1">
              <Label htmlFor="quest-due" className="text-xs text-muted-foreground">{t("assign.deadline")}</Label>
              <Input id="quest-due" type="date" lang={localeTag()} value={endsOn} min={today} max={maxEnd ?? undefined} onChange={(e) => setEndsOn(e.target.value)} className="tabular-nums" aria-invalid={!dateOk} />
              {!dateOk && <span className="text-2xs text-down">{endsOn && endsOn >= today && maxEnd ? t("assign.deadlineMax", { date: fmtDate(maxEnd, "dayMonth") }) : t("assign.pastDeadline")}</span>}
            </div>
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="quest-note" className="text-xs text-muted-foreground">{manual ? t("assign.task") : t("assign.note")}</Label>
              <Textarea id="quest-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={manual ? 3 : 2} placeholder={manual ? t("assign.taskPlaceholder") : t("assign.notePlaceholder")} aria-invalid={!noteOk && note.length > 0} />
              {manual && !noteOk && <span className="text-2xs text-muted-foreground">{t("assign.noteRequired")}</span>}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={save.isPending}>{tc("actions.cancel")}</Button>
            <Button type="submit" disabled={!valid || save.isPending}>{save.isPending ? t("assign.saving") : t("assign.submit")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
