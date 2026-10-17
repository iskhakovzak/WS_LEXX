import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Quote, RefreshCw, Sparkles } from "lucide-react";
import { Panel } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { AuthorMarkdown } from "./author-reader";
import {
  AN_KEYS, addDays, api, fmtDayShort, fmtWeekday, localToday, moodOf, weekStartOf,
  type AuthorNote, type WeeklySummary,
} from "./author-model";

export function AuthorWeeklyCard({
  trader,
  date,
  notes,
  selectedDate,
  onPickDate,
  canGenerate,
  beforeGenerate,
}: {
  trader: string;
  date: string;
  notes: AuthorNote[];
  selectedDate: string;
  onPickDate: (d: string) => void;
  canGenerate: boolean;
  beforeGenerate?: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const week = weekStartOf(date);
  const today = localToday();
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const byDate = React.useMemo(() => new Map(notes.map((n) => [n.note_date.slice(0, 10), n])), [notes]);
  const written = days.filter((d) => byDate.get(d)?.raw_text?.trim()).length;
  const weekdaysSoFar = days.slice(0, 5).filter((d) => d <= today).length;

  const q = useQuery({
    queryKey: AN_KEYS.weekly(trader, week),
    queryFn: async () => {
      const d = await api<WeeklySummary | null>(`/author-notes/weekly-summary?trader=${encodeURIComponent(trader)}&week_start=${week}`);
      return d && typeof d.summary === "string" ? d : null;
    },
    enabled: !!trader,
    staleTime: 60_000,
  });

  const gen = useMutation({
    mutationFn: () => api<WeeklySummary>(`/author-notes/weekly-summary`, { method: "POST", body: JSON.stringify({ week_start: week }) }),
    onSuccess: (data) => {
      qc.setQueryData(AN_KEYS.weekly(trader, week), data);
      toast({ title: "Сводка недели готова" });
      setOpen(true);
    },
    onError: (e: Error) => toast({ title: "Не удалось собрать сводку", description: e.message, variant: "destructive" }),
  });

  const summary = q.data;
  const generate = () => {
    beforeGenerate?.();
    gen.mutate();
  };

  return (
    <Panel
      title="Неделя"
      description={`${fmtDayShort(week)} — ${fmtDayShort(addDays(week, 6))}`}
      icon={BarChart3}
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-7 gap-1" role="group" aria-label="Дни недели">
          {days.map((d) => {
            const n = byDate.get(d);
            const mood = moodOf(n?.mood);
            const has = !!n?.raw_text?.trim();
            const future = d > today;
            return (
              <button
                key={d}
                type="button"
                disabled={future}
                onClick={() => onPickDate(d)}
                aria-pressed={d === selectedDate}
                aria-label={`${fmtDayShort(d)}${has ? ", есть запись" : ", нет записи"}${mood ? `, ${mood.label}` : ""}`}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl text-xs transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
                  d === selectedDate ? "bg-primary/15 text-foreground ring-1 ring-primary/40" : "hover:bg-[var(--glass-hover-bg)]",
                )}
              >
                <span className="capitalize text-muted-foreground">{fmtWeekday(d)}</span>
                <span className="text-base leading-none" aria-hidden="true">
                  {mood ? mood.emoji : has ? <span className="inline-block h-2 w-2 rounded-full bg-primary" /> : <span className="inline-block h-2 w-2 rounded-full bg-[var(--field-border)]" />}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span className="text-muted-foreground">Записей за неделю</span>
          <span className="font-semibold tabular-nums">
            {written}
            <span className="text-muted-foreground"> / {Math.max(weekdaysSoFar, 1)}</span>
          </span>
        </div>

        {q.isLoading ? (
          <Skeleton className="h-20 w-full rounded-xl" />
        ) : q.isError ? (
          <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
            Не удалось загрузить сводку
            <Button variant="ghost" size="sm" onClick={() => q.refetch()}>Повторить</Button>
          </div>
        ) : summary ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="lift flex flex-col gap-1.5 rounded-xl bg-[var(--glass-bg)] p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {summary.quote_of_week ? (
              <span className="flex gap-2 text-sm italic text-foreground">
                <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                «{summary.quote_of_week}»
              </span>
            ) : (
              <span className="line-clamp-3 text-sm text-foreground/90">{summary.summary.replace(/\*\*/g, "")}</span>
            )}
            <span className="text-xs text-primary">Открыть разбор недели</span>
          </button>
        ) : (
          <p className="text-sm text-muted-foreground">
            AI-разбор недели ещё не собран. Он найдёт повторяющиеся паттерны в твоих записях и сделках.
          </p>
        )}

        {canGenerate && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 self-start"
            onClick={generate}
            disabled={gen.isPending || written === 0}
            title={written === 0 ? "Нет записей за эту неделю" : undefined}
          >
            {gen.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
            {gen.isPending ? "AI анализирует неделю…" : summary ? "Пересобрать разбор" : "Собрать разбор недели"}
          </Button>
        )}
      </div>

      <Sheet open={open && !!summary} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>Разбор недели</SheetTitle>
            <SheetDescription>
              {fmtDayShort(week)} — {fmtDayShort(addDays(week, 6))}
              {summary ? ` · собран ${new Date(summary.created_at).toLocaleDateString("ru-RU")}` : ""}
            </SheetDescription>
          </SheetHeader>
          {summary && (
            <div className="mt-4 flex flex-col gap-4">
              {summary.quote_of_week && (
                <blockquote className="glass-panel flex gap-2 rounded-xl p-3 text-sm italic">
                  <Quote className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  «{summary.quote_of_week}»
                </blockquote>
              )}
              <AuthorMarkdown text={summary.summary} />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </Panel>
  );
}
