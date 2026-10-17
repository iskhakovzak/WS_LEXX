import * as React from "react";
import { CheckCircle2, RotateCcw, XCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Pill, type Tone } from "@/components/ds";
import { cn } from "@/lib/utils";
import type { TradeIdea } from "./model";

type Decision = "approved" | "needs_work" | "rejected";

const DECISIONS: { key: Decision; label: string; icon: React.ElementType; tone: Tone; cls: string }[] = [
  { key: "approved", label: "Одобрить", icon: CheckCircle2, tone: "up", cls: "aria-pressed:bg-up/20 aria-pressed:text-up hover:text-up" },
  { key: "needs_work", label: "На доработку", icon: RotateCcw, tone: "warn", cls: "aria-pressed:bg-[hsl(var(--chart-3)/0.2)] aria-pressed:text-[hsl(var(--chart-3))] hover:text-[hsl(var(--chart-3))]" },
  { key: "rejected", label: "Отклонить", icon: XCircle, tone: "down", cls: "aria-pressed:bg-down/20 aria-pressed:text-down hover:text-down" },
];

const QUICK_NOTES: Record<Decision, string[]> = {
  approved: ["Чёткий план", "Хороший R:R", "Сильный катализатор"],
  needs_work: ["Уточни уровень входа", "Стоп слишком широкий", "Нет катализатора", "Слабый R:R", "Добавь скриншот"],
  rejected: ["Против тренда рынка", "Низкая ликвидность", "Нет преимущества", "Дубль идеи"],
};

export const REVIEW_LABEL: Record<string, { label: string; tone: Tone }> = {
  approved: { label: "Одобрена", tone: "up" },
  needs_work: { label: "На доработку", tone: "warn" },
  rejected: { label: "Отклонена", tone: "down" },
};

/** Current review verdict (visible to everyone). */
export function ReviewVerdict({ idea }: { idea: TradeIdea }) {
  if (!idea.review_status) return null;
  const v = REVIEW_LABEL[idea.review_status];
  if (!v) return null;
  return (
    <div className={cn(
      "rounded-xl border p-3 text-sm",
      v.tone === "up" ? "border-up/30 bg-up/10" : v.tone === "down" ? "border-down/30 bg-down/10" : "border-[hsl(var(--chart-3)/0.3)] bg-[hsl(var(--chart-3)/0.1)]",
    )}>
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={v.tone}><ShieldCheck className="h-3 w-3" aria-hidden="true" />{v.label}</Pill>
        {idea.reviewed_by && <span className="text-xs text-muted-foreground">{idea.reviewed_by}{idea.reviewed_at ? ` · ${new Date(idea.reviewed_at).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}` : ""}</span>}
      </div>
      {idea.review_reason && <p className="mt-1.5 whitespace-pre-wrap text-foreground">{idea.review_reason}</p>}
    </div>
  );
}

/** Curator decision: pick verdict → optional note (quick chips) → confirm. */
export function ReviewActions({
  idea,
  onSubmit,
  pending,
}: {
  idea: TradeIdea;
  onSubmit: (status: Decision, reason: string) => void;
  pending: boolean;
}) {
  const [decision, setDecision] = React.useState<Decision | null>(null);
  const [note, setNote] = React.useState("");
  const noteId = React.useId();

  React.useEffect(() => { setDecision(null); setNote(""); }, [idea.id]);

  const addQuick = (q: string) => setNote((n) => (n.includes(q) ? n : n ? `${n.trim()}; ${q}` : q));

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Решение куратора" className="grid grid-cols-3 gap-2">
        {DECISIONS.map((d) => {
          const Icon = d.icon;
          const current = idea.review_status === d.key;
          return (
            <button
              key={d.key}
              type="button"
              aria-pressed={decision === d.key}
              onClick={() => setDecision(decision === d.key ? null : d.key)}
              className={cn(
                "chip flex min-h-10 flex-col items-center justify-center gap-0.5 px-2 py-1.5 text-xs font-medium sm:flex-row sm:gap-1.5",
                d.cls,
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span>{d.label}</span>
              {current && <span className="sr-only">(текущий статус)</span>}
            </button>
          );
        })}
      </div>

      {decision && (
        <div className="flex flex-col gap-2">
          <label htmlFor={noteId} className="text-xs text-muted-foreground">
            {decision === "approved" ? "Комментарий (необязательно)" : decision === "needs_work" ? "Что доработать" : "Причина отклонения"}
          </label>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_NOTES[decision].map((q) => (
              <button key={q} type="button" onClick={() => addQuick(q)} className="chip min-h-7 px-2.5 text-xs">+ {q}</button>
            ))}
          </div>
          <Textarea
            id={noteId}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && (decision === "approved" || note.trim())) { e.preventDefault(); onSubmit(decision, note.trim()); } }}
            rows={2}
            maxLength={2000}
            placeholder="Автор получит уведомление с этим комментарием"
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setDecision(null); setNote(""); }}>Отмена</Button>
            <Button
              size="sm"
              onClick={() => onSubmit(decision, note.trim())}
              disabled={pending || (decision !== "approved" && !note.trim())}
            >
              {pending ? "Сохраняем…" : DECISIONS.find((d) => d.key === decision)!.label}
            </Button>
          </div>
          {decision !== "approved" && !note.trim() && (
            <p className="text-2xs text-muted-foreground">Для доработки и отклонения нужен комментарий — автору важно знать причину.</p>
          )}
        </div>
      )}
    </div>
  );
}
