/**
 * Chart-lab «Тренировка»: where random tasks come from and which ones — a popover next to «Случайная задача».
 * Source (own trades / the desk's trades / any ticker-day), the finest bars a task must have (with how many tasks
 * each option has, from GET /api/training/pool) and filters (side, result, ticker, period). Settings live in this
 * browser. A task never reveals the trader, side or result before the reveal — the filters only narrow the pool.
 */
import * as React from "react";
import { Dices, SlidersHorizontal } from "lucide-react";
import { Segmented } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  DEFAULT_TASK_SETTINGS, RES_LABEL, SOURCE_LABEL, activeFilterCount, countFor, noTasksMessage,
  type PoolCounts, type TaskRes, type TaskSettings, type TaskSource,
} from "@/lib/training-tasks";

function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-2xs leading-snug text-muted-foreground">{hint}</span>}
    </div>
  );
}

const SHORT_SOURCE: Record<TaskSource, string> = { mine: "Мои", desk: "Деск", day: "Тикер-день" };

export function TaskSettingsButton({
  settings, onChange, counts, member, loading, error, onPick, picking,
}: {
  settings: TaskSettings;
  onChange: (patch: Partial<TaskSettings>) => void;
  counts: PoolCounts | null;
  /** Signed-in member (trade sources available); false for guests. */
  member: boolean;
  loading: boolean;
  /** The pool could not be loaded (e.g. the API server lacks /api/training). */
  error?: string | null;
  onPick: () => void;
  picking: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const filters = activeFilterCount(settings);
  const available = countFor(counts, settings.res);
  const dayOnly = settings.source === "day";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-9 shrink-0 gap-1.5 px-2.5" aria-label="Настройки задач" title="Откуда брать задачи и какие">
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          <span className="hidden md:inline">{SHORT_SOURCE[settings.source]}</span>
          {filters > 0 && <span className="grid h-4 min-w-4 place-items-center rounded-full bg-primary/15 px-1 text-2xs font-semibold tabular-nums text-primary">{filters}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-[min(22rem,calc(100vw-1.5rem))] flex-col gap-3 p-3">
        <Row label="Задачи из">
          <Segmented
            size="sm" ariaLabel="Источник задач" value={settings.source} onChange={(v) => onChange({ source: v })} className="w-full"
            options={(["mine", "desk", "day"] as TaskSource[]).map((s) => ({
              value: s, label: SOURCE_LABEL[s].replace("Любой тикер-день", "Любой день"),
              disabled: s !== "day" && !member, title: s !== "day" && !member ? "Сделки — после входа" : undefined,
            }))}
          />
        </Row>
        <p className="-mt-1.5 text-2xs leading-snug text-muted-foreground">
          {settings.source === "mine" ? "Твои закрытые сделки." : settings.source === "desk" ? "Сделки всех трейдеров. Чужие — в ценах и R, без долларов и размера; кто торговал — покажем после «Показать, как было»." : "Тикер и день без сделки: просто рынок, сравнение — только с идеальным ходом."}
        </p>

        <Row label="Бары" hint="Мельче 5 минут — только дни, где есть такие бары: 1-минутки Yahoo хранит 7 дней, 5-минутки — 60 (или если день сохранён в кэше).">
          <Segmented
            size="sm" ariaLabel="Самые крупные бары задачи" value={settings.res} onChange={(v) => onChange({ res: v })} className="w-full"
            options={(["1m", "5m", "any"] as TaskRes[]).map((r) => ({ value: r, label: RES_LABEL[r], count: counts ? countFor(counts, r) : undefined }))}
          />
        </Row>

        <div className="grid grid-cols-[5.5rem_1fr] items-center gap-x-2 gap-y-2">
          <span className={cn("text-2xs font-semibold uppercase tracking-wide text-muted-foreground", dayOnly && "opacity-50")}>Сторона</span>
          <Segmented
            size="sm" ariaLabel="Сторона сделки" value={settings.side ?? "any"} onChange={(v) => onChange({ side: v === "any" ? null : (v as "long" | "short") })}
            options={[{ value: "any", label: "все", disabled: dayOnly }, { value: "long", label: "лонг", disabled: dayOnly }, { value: "short", label: "шорт", disabled: dayOnly }]}
            className="justify-self-start"
          />
          <span className={cn("text-2xs font-semibold uppercase tracking-wide text-muted-foreground", dayOnly && "opacity-50")}>Результат</span>
          <Segmented
            size="sm" ariaLabel="Результат сделки" value={settings.result ?? "any"} onChange={(v) => onChange({ result: v === "any" ? null : (v as "win" | "loss") })}
            options={[{ value: "any", label: "все", disabled: dayOnly }, { value: "win", label: "плюс", disabled: dayOnly }, { value: "loss", label: "минус", disabled: dayOnly }]}
            className="justify-self-start"
          />
          <label htmlFor="task-ticker" className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Тикер</label>
          <Input id="task-ticker" className="h-8 w-28 uppercase placeholder:normal-case" placeholder="любой" value={settings.ticker} maxLength={11} onChange={(e) => onChange({ ticker: e.target.value.toUpperCase().replace(/[^A-Z0-9.\-]/g, "") })} />
          <span className="col-span-2 -mb-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Период</span>
          <div className="col-span-2 flex min-w-0 items-center gap-1">
            <Input type="date" aria-label="С даты" className="h-8 min-w-0 flex-1 px-1.5 text-xs" value={settings.from} max={settings.to || undefined} onChange={(e) => onChange({ from: e.target.value })} />
            <span className="text-muted-foreground" aria-hidden="true">–</span>
            <Input type="date" aria-label="По дату" className="h-8 min-w-0 flex-1 px-1.5 text-xs" value={settings.to} min={settings.from || undefined} onChange={(e) => onChange({ to: e.target.value })} />
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-[var(--glass-border)] pt-2.5">
          <span className="min-w-0 flex-1 text-xs text-muted-foreground" role="status">
            {loading ? "Считаем…" : error ? <span className="text-destructive">{error}</span> : available ? <>Подходит: <b className="tabular-nums text-foreground">{available}</b></> : <span className="text-[hsl(var(--chart-3))]">{noTasksMessage(settings, counts)}</span>}
          </span>
          <Button variant="ghost" size="sm" className="h-8 shrink-0 px-2" onClick={() => onChange({ ...DEFAULT_TASK_SETTINGS, source: member ? DEFAULT_TASK_SETTINGS.source : "day" })}>Сбросить</Button>
          <Button size="sm" className="h-8 shrink-0 gap-1.5" disabled={(!available && !error) || picking} onClick={() => { setOpen(false); onPick(); }}>
            <Dices className="h-4 w-4" aria-hidden="true" /> Задача
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
