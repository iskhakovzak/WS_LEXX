import { Check, Eye, GraduationCap, Hand, RotateCcw, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd, Pill } from "@/components/ds";
import { cn } from "@/lib/utils";
import type { TrainingResult } from "../types";
import { fmtEtTime, formatDuration } from "../lib/time";
import { fmtMoney, fmtPrice } from "../lib/format";
import { scoreVerdict } from "../lib/training";

type Step = "watch" | "decide" | "compare";
const STEPS: { id: Step; label: string; icon: typeof Eye }[] = [
  { id: "watch", label: "Смотри", icon: Eye },
  { id: "decide", label: "Реши", icon: Hand },
  { id: "compare", label: "Сравни с фактом", icon: Scale },
];

/**
 * Training flow «смотри → реши → сравни с фактом». Watch: play until the entry (exits are hidden).
 * Decide: while in the position press «Я бы вышел здесь» (Enter). Compare: chosen vs real exit, the $
 * difference and a 0–100 score (where the chosen exit sits between the worst and best close available).
 * Fixed minimum height so the page below does not jump between steps.
 */
export function TrainingPanel({ result, canExit, inPosition, onExitHere, onRestart, className }: {
  result: TrainingResult | null;
  canExit: boolean;
  inPosition: boolean;
  onExitHere: () => void;
  onRestart: () => void;
  className?: string;
}) {
  const step: Step = result ? "compare" : inPosition ? "decide" : "watch";
  const activeIdx = STEPS.findIndex((s) => s.id === step);
  return (
    <section
      aria-label="Тренировка"
      className={cn("flex min-h-[7.5rem] flex-col gap-3 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3", className)}
    >
      <div className="flex flex-wrap items-center gap-2">
        <GraduationCap className="h-4 w-4 text-primary" aria-hidden="true" />
        <span className="text-sm font-semibold">Тренировка</span>
        <ol className="ml-1 flex flex-wrap items-center gap-1" aria-label="Шаги тренировки">
          {STEPS.map((s, i) => {
            const done = i < activeIdx;
            const active = i === activeIdx;
            const Icon = done ? Check : s.icon;
            return (
              <li key={s.id} className="flex items-center gap-1">
                {i > 0 && <span className={cn("h-px w-4", done || active ? "bg-primary" : "bg-[hsl(var(--muted-foreground)/0.3)]")} aria-hidden="true" />}
                <span
                  aria-current={active ? "step" : undefined}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors duration-[var(--dur-1)]",
                    active ? "bg-primary/15 text-primary" : done ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {i + 1}. {s.label}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      {!result ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">
            {step === "watch"
              ? "Будущее и реальный выход скрыты. Запусти проигрывание и дойди до входа — дальше решай сам."
              : "Ты в позиции. Проигрывай дальше и останови там, где вышел бы, — потом сравним с тем, что было на самом деле."}
          </p>
          <Button
            className="h-10 gap-2 rounded-full bg-primary-solid px-5"
            onClick={onExitHere}
            disabled={!canExit}
            title={!inPosition ? "Сначала дойди до входа" : "Я бы вышел здесь — Enter"}
          >
            Я бы вышел здесь <Kbd className="border-white/30 bg-white/10 text-primary-foreground">Enter</Kbd>
          </Button>
        </div>
      ) : (
        <TrainingResultView result={result} onRestart={onRestart} />
      )}
    </section>
  );
}

function TrainingResultView({ result, onRestart }: { result: TrainingResult; onRestart: () => void }) {
  const better = result.diffUsd != null ? result.diffUsd > 0 : null;
  const verdict = scoreVerdict(result.score);
  return (
    <div className="flex flex-wrap items-stretch gap-3 tabular-nums">
      {result.score != null && (
        <div className="flex min-w-[8.5rem] flex-col justify-center rounded-xl bg-[var(--glass-bg)] px-3 py-2" title="Где твой выход между худшим (0) и лучшим (100) закрытием бара от входа до позднего из двух выходов">
          <span className="text-xs text-muted-foreground">Оценка выхода</span>
          <span className="text-2xl font-semibold leading-tight">
            {result.score}<span className="text-sm font-normal text-muted-foreground">/100</span>
          </span>
          {verdict && <span className={cn("text-xs", verdict.tone === "up" ? "text-up" : verdict.tone === "down" ? "text-down" : verdict.tone === "warn" ? "text-warn" : "text-muted-foreground")}>{verdict.label}</span>}
        </div>
      )}
      <Compare label="Твой выход" price={result.userExitPrice} time={result.userExitTime} pnl={result.userPnlUsd} />
      <Compare label="Реальный выход" price={result.actualExitPrice} time={result.actualExitTime} pnl={result.actualPnlUsd} />
      <div className="flex min-w-[9rem] flex-col justify-center gap-1">
        {result.diffUsd != null ? (
          <Pill tone={better ? "up" : result.diffUsd === 0 ? "neutral" : "down"}>
            {better ? "лучше факта на" : result.diffUsd === 0 ? "ровно как факт" : "хуже факта на"} {result.diffUsd !== 0 && fmtMoney(Math.abs(result.diffUsd)).replace(/^\+/, "")}
          </Pill>
        ) : (
          <Pill tone="neutral">размер позиции неизвестен — разница в $ недоступна</Pill>
        )}
        {result.diffSeconds != null && result.diffSeconds !== 0 && (
          <span className="text-xs text-muted-foreground">{result.diffSeconds < 0 ? "раньше на" : "позже на"} {formatDuration(Math.abs(result.diffSeconds))}</span>
        )}
      </div>
      <Button variant="outline" size="sm" className="ml-auto h-9 gap-1 self-center rounded-full" onClick={onRestart}><RotateCcw /> Ещё раз</Button>
    </div>
  );
}

function Compare({ label, price, time, pnl }: { label: string; price: number | null; time: number | null; pnl: number | null }) {
  return (
    <div className="flex min-w-[9rem] flex-col justify-center rounded-xl bg-[var(--glass-bg)] px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{fmtPrice(price)}{time != null && <span className="font-normal text-muted-foreground"> · {fmtEtTime(time)} ET</span>}</span>
      <span className={cn("text-base font-semibold", pnl == null ? "text-muted-foreground" : pnl >= 0 ? "text-up" : "text-down")}>{pnl == null ? "—" : fmtMoney(pnl)}</span>
    </div>
  );
}
