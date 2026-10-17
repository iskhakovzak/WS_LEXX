/**
 * Quiz player: single / multiple choice and numeric answers, auto-graded by the server
 * (POST /academy/content/quizzes/:id/attempts). Correct answers and explanations are shown only after a pass
 * or when attempts are exhausted (server decides: state.revealAnswers).
 */
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, RotateCcw, Send, XCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel, Pill, ProgressRing, StatCard, StatGrid } from "@/components/ds";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Markdown } from "./markdown";
import { api, invalidateAcademy, type AttemptState, type Feedback, type GradeSummary, type PublicQuestion, type QuizResponse } from "./api";
import { DualTime } from "./time";
import { pluralRu } from "@/lib/format";

const ptsText = (n: number) => `${n} ${pluralRu(n, "балл", "балла", "баллов")}`;

type Answers = Record<string, string | string[]>;

function answered(q: PublicQuestion, a: Answers): boolean {
  const v = a[q.id];
  return Array.isArray(v) ? v.length > 0 : typeof v === "string" && v.trim() !== "";
}

function fromSaved(raw: Record<string, unknown> | undefined): Answers {
  const out: Answers = {};
  for (const [k, v] of Object.entries(raw ?? {})) out[k] = Array.isArray(v) ? v.map(String) : v == null ? "" : String(v);
  return out;
}

export function QuizRunner({ data, canAnswer }: { data: QuizResponse; canAnswer: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { quiz } = data;
  const [answers, setAnswers] = useState<Answers>({});
  const [result, setResult] = useState<{ grade: GradeSummary; feedback: Feedback[]; state: AttemptState; answers: Answers } | null>(null);
  const [busy, setBusy] = useState(false);

  // Show the last attempt in review mode when the page opens.
  useEffect(() => {
    if (data.last) setResult({ grade: data.last.grade, feedback: data.last.feedback, state: data.state, answers: fromSaved(data.last.answers) });
    else setResult(null);
  }, [data.last?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const state = result?.state ?? data.state;
  const reviewing = !!result;
  const shown = reviewing ? result!.answers : answers;
  const fb = useMemo(() => new Map((result?.feedback ?? []).map((f) => [f.id, f])), [result]);
  const unanswered = quiz.questions.filter((q) => !answered(q, answers)).length;

  const submit = async () => {
    if (unanswered > 0 && !window.confirm(`Без ответа: ${unanswered}. Отправить всё равно?`)) return;
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {};
      for (const q of quiz.questions) if (answers[q.id] !== undefined) payload[q.id] = answers[q.id];
      const r = await api.attempt(quiz.id, payload);
      setResult({ grade: r.grade, feedback: r.feedback, state: r.state, answers });
      toast({ title: r.grade.passed ? "Тест сдан" : "Тест не сдан", description: `${r.grade.score} из ${r.grade.maxScore} ${pluralRu(r.grade.maxScore, "балла", "баллов", "баллов")} (${Math.round(r.grade.pct)}%)` });
      void invalidateAcademy(qc);
      document.getElementById("main-content")?.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      toast({ title: "Не удалось отправить", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const retry = () => { setAnswers({}); setResult(null); };

  return (
    <div className="flex flex-col gap-4">
      <StatGrid>
        <StatCard label="Проходной балл" value={`${quiz.passPct}%`} />
        <StatCard label="Вопросов" value={quiz.questions.length} hint={ptsText(quiz.questions.reduce((s, q) => s + q.points, 0))} />
        <StatCard label="Попытки" value={quiz.maxAttempts ? `${state.attempts} / ${quiz.maxAttempts}` : state.attempts} hint={quiz.maxAttempts ? (state.attemptsLeft ? `осталось ${state.attemptsLeft}` : "попытки закончились") : "без ограничений"} />
        <StatCard label="Лучший результат" value={state.bestPct != null ? `${Math.round(state.bestPct)}%` : "—"} tone={state.passed ? "up" : state.bestPct != null ? "down" : "neutral"} hint={state.passed ? "зачтено" : state.bestPct != null ? "ещё не зачтено" : undefined} />
      </StatGrid>

      {result && (
        <Panel aria-live="polite">
          <div className="flex flex-wrap items-center gap-4">
            <ProgressRing value={result.grade.pct} size={64} stroke={6} tone={result.grade.passed ? "up" : "down"} ariaLabel="Результат попытки" />
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold text-foreground">{result.grade.passed ? "Тест сдан" : "Тест не сдан"}</p>
              <p className="text-sm text-muted-foreground tabular-nums">
                {result.grade.score} из {result.grade.maxScore} {pluralRu(result.grade.maxScore, "балла", "баллов", "баллов")} · нужно {quiz.passPct}%
              </p>
              {!result.state.revealAnswers && <p className="mt-1 text-xs text-muted-foreground">Правильные ответы откроются после сдачи теста или когда закончатся попытки.</p>}
            </div>
            {canAnswer && state.canAttempt && (
              <Button variant="outline" onClick={retry}><RotateCcw aria-hidden="true" />Пройти ещё раз</Button>
            )}
          </div>
        </Panel>
      )}

      <ol className="flex flex-col gap-3" aria-label="Вопросы теста">
        {quiz.questions.map((q, idx) => (
          <li key={q.id}>
            <QuestionCard
              n={idx + 1}
              q={q}
              value={shown[q.id]}
              onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
              disabled={reviewing || !canAnswer || busy}
              feedback={fb.get(q.id)}
            />
          </li>
        ))}
      </ol>

      {!reviewing && canAnswer && (
        <div className="sticky bottom-3 z-sticky flex flex-wrap items-center justify-between gap-2 rounded-2xl glass-panel bg-[var(--sticky-bg)] p-3">
          <span className="text-sm text-muted-foreground tabular-nums">Отвечено {quiz.questions.length - unanswered} из {quiz.questions.length}</span>
          <Button onClick={submit} disabled={busy || !state.canAttempt}>
            {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
            Отправить ответы
          </Button>
        </div>
      )}
      {!canAnswer && <p className="text-sm text-muted-foreground">Режим просмотра: отвечать может только сам ученик.</p>}

      {data.attempts.length > 0 && (
        <Panel title="История попыток">
          <ul className="flex flex-col divide-y divide-border/50 text-sm">
            {data.attempts.slice().reverse().map((a, i) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                <span className="text-muted-foreground tabular-nums">#{data.attempts.length - i} · <DualTime iso={a.submittedAt} /></span>
                <span className="flex items-center gap-2 tabular-nums">
                  {a.score} / {a.maxScore}
                  <Pill tone={a.passed ? "up" : "down"}>{Math.round(a.pct ?? 0)}%</Pill>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function QuestionCard({ n, q, value, onChange, disabled, feedback }: {
  n: number; q: PublicQuestion; value: string | string[] | undefined; onChange: (v: string | string[]) => void; disabled: boolean; feedback?: Feedback;
}) {
  const headingId = `q-${q.id}-h`;
  const expectedOpts = feedback?.expected && "options" in feedback.expected ? new Set(feedback.expected.options) : null;
  return (
    <fieldset
      className={cn("glass-panel rounded-2xl p-4", feedback && (feedback.correct ? "ring-1 ring-up/40" : "ring-1 ring-down/40"))}
      aria-labelledby={headingId}
    >
      <legend className="sr-only">Вопрос {n}</legend>
      <div className="flex items-start justify-between gap-3">
        <div id={headingId} className="min-w-0 text-sm font-medium text-foreground">
          <span className="mr-1.5 tabular-nums text-muted-foreground">{n}.</span>
          <Markdown source={q.prompt} className="inline-block max-w-none align-top [&_p]:mt-0" />
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          {feedback && (feedback.correct
            ? <CheckCircle2 className="h-4 w-4 text-up" aria-label="Верно" role="img" />
            : <XCircle className="h-4 w-4 text-down" aria-label="Неверно" role="img" />)}
          <span className="text-xs text-muted-foreground tabular-nums">
            {feedback ? `${feedback.earned}/${feedback.points}` : q.points} {pluralRu(q.points, "балл", "балла", "баллов")}
          </span>
        </span>
      </div>

      {q.kind === "numeric" ? (
        <div className="mt-3 flex items-center gap-2">
          <Input
            inputMode="decimal"
            className="w-44 tabular-nums"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            aria-label={`Ответ на вопрос ${n}`}
            placeholder="Число, напр. 2.4"
          />
          {q.unit && <span className="text-sm text-muted-foreground">{q.unit}</span>}
          {feedback?.expected && "answer" in feedback.expected && (
            <span className="text-sm text-muted-foreground tabular-nums">
              Ответ: <b className="text-foreground">{feedback.expected.answer}</b>
              {feedback.expected.tolerance ? ` ± ${feedback.expected.tolerance}${feedback.expected.tolerancePct ? "%" : ""}` : ""}
              {feedback.expected.unit ? ` ${feedback.expected.unit}` : ""}
            </span>
          )}
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-1.5" role={q.multiple ? "group" : "radiogroup"} aria-labelledby={headingId}>
          {q.multiple && <p className="text-xs text-muted-foreground">Можно выбрать несколько вариантов</p>}
          {q.options.map((o) => {
            const list = Array.isArray(value) ? value : typeof value === "string" && value ? [value] : [];
            const checked = list.includes(o.id);
            const isRight = expectedOpts?.has(o.id);
            return (
              <label
                key={o.id}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-xl border border-transparent px-3 py-2 text-sm transition-colors hover:bg-[var(--glass-bg)]",
                  checked && "border-[var(--field-border)] bg-[var(--glass-bg)]",
                  expectedOpts && isRight && "border-up/40 bg-up/10",
                  expectedOpts && checked && !isRight && "border-down/40 bg-down/10",
                  disabled && "cursor-default",
                )}
              >
                <input
                  type={q.multiple ? "checkbox" : "radio"}
                  name={`q-${q.id}`}
                  className="mt-0.5 accent-[hsl(var(--primary))]"
                  checked={checked}
                  disabled={disabled}
                  onChange={(e) => {
                    if (!q.multiple) return onChange([o.id]);
                    onChange(e.target.checked ? [...list, o.id] : list.filter((x) => x !== o.id));
                  }}
                />
                <span className="min-w-0">{o.text}</span>
              </label>
            );
          })}
        </div>
      )}

      {feedback?.explanation && (
        <div className="mt-3 rounded-xl bg-[var(--glass-bg)] px-3 py-2 text-sm text-muted-foreground">
          <Markdown source={feedback.explanation} className="max-w-none" />
        </div>
      )}
    </fieldset>
  );
}
