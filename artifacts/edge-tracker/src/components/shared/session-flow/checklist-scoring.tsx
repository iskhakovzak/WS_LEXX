/**
 * «Вес и порог» of a setup's checklist: each condition gets a weight (×1 … ×3) and, optionally, what fills it by itself
 * (gap, relative volume, a strong catalyst mark, an analyst action), and the setup gets the score it needs («второй
 * день: 5 факторов, нужно 4»). Saved at once (optimistic). The trader then ticks the conditions per ticker in the plan.
 * Read-only for anyone but the setup's editor; nothing renders for a setup without checklist items.
 */
import * as React from "react";
import { Gauge, Minus, Plus } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { http } from "@/lib/api/http";
import { optimistic, toastMutationError } from "@/hooks/optimistic";
import { sessionFlowI18n } from "@/i18n/ns/sessionFlow";
import type { AutoKind } from "./ideas-api";

type Item = { id: string; text: string; weight?: number; auto?: AutoKind | null };
const AUTO: readonly AutoKind[] = ["gap", "rvol", "catalyst", "analyst"];
const NONE = "__none";
const w = (i: Item) => (i.weight && i.weight >= 1 ? i.weight : 1);

function useSaveScoring(setupId: number) {
  const qc = useQueryClient();
  type Vars = { checklistItems?: Item[]; checklistThreshold?: number | null };
  return useMutation({
    mutationFn: (b: Vars) => http.patch<unknown>(`/api/playbook/${setupId}`, b),
    ...optimistic<Vars, unknown>(qc, {
      queryKey: ["playbook"],
      update: (old, b) => (Array.isArray(old) ? old.map((e) => (e && typeof e === "object" && (e as { id?: number }).id === setupId ? { ...e, ...b } : e)) : old),
      invalidate: [["playbook-children"], ["ideas"]],
      onError: (err) => toastMutationError(err, sessionFlowI18n.t("scoring.saveFailed")),
    }),
  });
}

export function ChecklistScoring({ setupId, items, threshold, canEdit, className }: {
  setupId: number; items: readonly Item[] | null | undefined; threshold: number | null | undefined; canEdit: boolean; className?: string;
}) {
  const { t } = sessionFlowI18n.useT();
  const save = useSaveScoring(setupId);
  const list = React.useMemo(() => [...(items ?? [])], [items]);
  if (!list.length) return null;
  const max = list.reduce((a, i) => a + w(i), 0);
  const thr = threshold != null && threshold > 0 ? Math.min(threshold, max) : max;
  const setItem = (id: string, p: Partial<Item>) => save.mutate({ checklistItems: list.map((i) => (i.id === id ? { ...i, ...p } : i)) });
  const setThr = (v: number) => save.mutate({ checklistThreshold: Math.max(1, Math.min(max, v)) });
  return (
    <section className={cn("flex min-w-0 flex-col gap-2", className)} aria-label={t("scoring.title")}>
      <p className="flex items-center gap-1.5 text-xs font-medium text-foreground"><Gauge className="h-3.5 w-3.5" aria-hidden="true" />{t("scoring.title")}</p>
      {canEdit && <p className="text-xs text-muted-foreground">{t("scoring.hint")}</p>}
      <ul className="flex flex-col gap-1.5">
        {list.map((i) => (
          <li key={i.id} className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate" title={i.text}>{i.text}</span>
            <span role="group" aria-label={t("scoring.weightAria", { item: i.text })} className="inline-flex gap-1">
              {[1, 2, 3].map((k) => (
                <button key={k} type="button" disabled={!canEdit} aria-pressed={w(i) === k} onClick={() => setItem(i.id, { weight: k })}
                  className={cn("h-6 min-w-8 rounded-full border px-1.5 text-xs tabular-nums", w(i) === k ? "border-primary/60 bg-primary/15 font-medium" : "border-[var(--field-border)] text-muted-foreground")}>
                  ×{k}
                </button>
              ))}
            </span>
            {canEdit ? (
              <Select value={i.auto ?? NONE} onValueChange={(v) => setItem(i.id, { auto: v === NONE ? null : (v as AutoKind) })}>
                <SelectTrigger aria-label={t("scoring.autoAria", { item: i.text })} className="h-7 w-auto min-w-[8rem] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("scoring.auto.none")}</SelectItem>
                  {AUTO.map((a) => <SelectItem key={a} value={a}>{t(`scoring.auto.${a}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : i.auto ? <span className="text-xs text-muted-foreground">{t(`scoring.auto.${i.auto}`)}</span> : null}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2 text-sm" role="status">
        <span className="text-xs text-muted-foreground">{t("scoring.threshold")}</span>
        {canEdit && <Button type="button" size="icon" variant="outline" className="h-7 w-7" aria-label={t("scoring.less")} onClick={() => setThr(thr - 1)} disabled={thr <= 1}><Minus aria-hidden="true" /></Button>}
        <span className="font-medium tabular-nums">{t("scoring.of", { thr, max })}</span>
        {canEdit && <Button type="button" size="icon" variant="outline" className="h-7 w-7" aria-label={t("scoring.more")} onClick={() => setThr(thr + 1)} disabled={thr >= max}><Plus aria-hidden="true" /></Button>}
      </div>
    </section>
  );
}
