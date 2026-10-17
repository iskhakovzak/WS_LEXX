import * as React from "react";
import { ArrowUpRight, ArrowDownRight, Flag, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import type { Tier, TraderEval } from "./use-scaling";
import { useAssignTier, useCreateProposal } from "./use-scaling";
import { ACTION_META } from "./format";

/** «Предложить» — turns the current recommendation into a proposal (curator). */
export function ProposeButton({ row, size = "sm" }: { row: TraderEval; size?: "sm" | "default" }) {
  const { toast } = useToast();
  const create = useCreateProposal();
  const a = row.recommendation.action;
  if (row.pendingProposal || a === "hold" || a === "assign" || !row.recommendation.toTier) return null;
  const Icon = a === "promote" ? ArrowUpRight : ArrowDownRight;
  const submit = async () => {
    try {
      await create.mutateAsync({ trader: row.trader });
      toast({ title: `Предложение создано: ${row.trader}`, description: `${ACTION_META[a].label} → ${row.recommendation.toTier?.name}` });
    } catch (e) {
      toast({ title: "Не удалось создать предложение", description: (e as Error).message, variant: "destructive" });
    }
  };
  return (
    <Button size={size} variant={a === "promote" ? "default" : "outline"} onClick={submit} disabled={create.isPending} aria-label={`${ACTION_META[a].verb} ${row.trader}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {ACTION_META[a].verb}
    </Button>
  );
}

/**
 * «Назначить тир» — direct assignment or a manual proposal to any tier, with a comment.
 * `mode="assign"` writes limits immediately (initial setup); `mode="propose"` goes through the approval queue.
 */
export function TierPopover({
  row,
  tiers,
  mode,
  size = "sm",
  variant = "outline",
}: {
  row: TraderEval;
  tiers: Tier[];
  mode: "assign" | "propose";
  size?: "sm" | "default";
  variant?: "outline" | "ghost" | "default";
}) {
  const [open, setOpen] = React.useState(false);
  const [tierKey, setTierKey] = React.useState<string>(row.recommendation.toTier?.key ?? row.nextTier?.key ?? tiers[0]?.key ?? "");
  const [comment, setComment] = React.useState("");
  const { toast } = useToast();
  const assign = useAssignTier();
  const create = useCreateProposal();
  const busy = assign.isPending || create.isPending;
  React.useEffect(() => {
    if (open) setTierKey(row.recommendation.toTier?.key ?? row.nextTier?.key ?? tiers[0]?.key ?? "");
  }, [open, row, tiers]);

  const submit = async () => {
    if (!tierKey) return;
    try {
      if (mode === "assign") {
        await assign.mutateAsync({ trader: row.trader, tierKey, comment: comment.trim() || undefined });
        toast({ title: `Тир назначен: ${row.trader}`, description: "Лимиты тира записаны в риск-лимиты" });
      } else {
        await create.mutateAsync({ trader: row.trader, toTier: tierKey, comment: comment.trim() || undefined });
        toast({ title: `Предложение создано: ${row.trader}` });
      }
      setOpen(false);
      setComment("");
    } catch (e) {
      toast({ title: "Не удалось сохранить", description: (e as Error).message, variant: "destructive" });
    }
  };
  const label = mode === "assign" ? "Назначить тир" : "Предложить тир";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size={size} variant={variant} aria-label={`${label}: ${row.trader}`}>
          {mode === "assign" ? <Flag className="h-3.5 w-3.5" aria-hidden="true" /> : <Send className="h-3.5 w-3.5" aria-hidden="true" />}
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-sm font-semibold text-foreground">{label}: {row.trader}</p>
            <p className="text-xs text-muted-foreground">
              {mode === "assign" ? "Лимиты выбранного тира сразу запишутся в риск-лимиты трейдера." : "Предложение попадёт в очередь на одобрение."}
            </p>
          </div>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Тир
            <Select value={tierKey} onValueChange={setTierKey}>
              <SelectTrigger aria-label="Тир"><SelectValue placeholder="Выберите тир" /></SelectTrigger>
              <SelectContent>
                {tiers.map((t) => (
                  <SelectItem key={t.key} value={t.key} disabled={t.key === row.tierKey}>
                    {t.name}{t.key === row.tierKey ? " (текущий)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Комментарий
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} maxLength={2000} placeholder="Почему" />
          </label>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Отмена</Button>
            <Button size="sm" onClick={submit} disabled={busy || !tierKey || tierKey === row.tierKey}>{busy ? "Сохраняем…" : mode === "assign" ? "Назначить" : "Предложить"}</Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
