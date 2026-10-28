/**
 * Academy quiz «на что похоже» (api GET /academy/analogue-quiz, POST …/answer): an anonymised chart of one of the
 * desk's own playbook examples — no ticker, no date, prices rebased to 100 — and 2–4 setups to choose from. The answer
 * is checked on the server; then the case is revealed (ticker, date, note) with a link to the setup, and «Следующий»
 * brings another chart (the ones already seen this session are skipped). The score of the session stays on screen.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Check, Puzzle, X } from "lucide-react";
import { EmptyState, ErrorState, Panel, PanelSkeleton } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { humanizeApiError } from "@/lib/api/errors";
import { fmtDate } from "@/lib/format";
import { links } from "@/lib/links";
import { cn } from "@/lib/utils";
import { CandlesCanvas } from "./candles-canvas";
import { answerQuiz, quizQuery, type QuizAnswer } from "@/components/shared/analogues/api";
import { analoguesI18n } from "@/i18n/ns/analogues";

export function AnalogueQuiz() {
  const { t } = analoguesI18n.useT();
  const { toast } = useToast();
  const [round, setRound] = React.useState(0);
  const [seen, setSeen] = React.useState<string[]>([]);
  const [score, setScore] = React.useState({ right: 0, total: 0 });
  const [answer, setAnswer] = React.useState<(QuizAnswer & { picked: number }) | null>(null);
  const [busy, setBusy] = React.useState(false);
  const q = useQuery(quizQuery(round, seen));
  const question = q.data?.question ?? null;

  const pick = async (setupId: number) => {
    if (!question || answer || busy) return;
    setBusy(true);
    try {
      const a = await answerQuiz(question.ref, setupId);
      setAnswer({ ...a, picked: setupId });
      setScore((s) => ({ right: s.right + (a.correct ? 1 : 0), total: s.total + 1 }));
    } catch (e) {
      toast({ title: t("quiz.loadFailed"), description: humanizeApiError(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  const next = () => {
    if (question) setSeen((s) => [...s, question.ref].slice(-150));
    setAnswer(null);
    setRound((r) => r + 1);
  };

  return (
    <Panel
      icon={Puzzle}
      title={t("quiz.title")}
      description={t("quiz.description")}
      actions={score.total > 0 ? <span className="text-sm text-muted-foreground">{t("quiz.score", score)}</span> : undefined}
    >
      {q.isLoading ? <PanelSkeleton height={260} title={false} /> : q.isError ? (
        <ErrorState compact error={q.error} onRetry={q.refetch} title={t("quiz.loadFailed")} />
      ) : !question ? (
        <EmptyState compact icon={Puzzle} title={t("quiz.empty")} />
      ) : (
        <div className="flex flex-col gap-3">
          <CandlesCanvas bars={question.bars} entryAt={question.entryAt} side={question.side} label={t("quiz.chartAria")} />
          {question.entryAt != null && <p className="text-xs text-muted-foreground">{t("quiz.entry")}</p>}
          <p className="text-sm font-medium text-foreground">{t("quiz.pick")}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {question.choices.map((c) => {
              const isRight = !!answer && c.id === answer.setup.id;
              const isWrongPick = !!answer && c.id === answer.picked && !answer.correct;
              return (
                <Button
                  key={c.id}
                  variant="outline"
                  disabled={busy || (!!answer && !isRight && !isWrongPick)}
                  onClick={() => pick(c.id)}
                  className={cn("h-auto justify-start whitespace-normal py-2 text-left", isRight && "border-[hsl(var(--up))] text-up", isWrongPick && "border-[hsl(var(--down))] text-down")}
                >
                  {isRight ? <Check aria-hidden="true" /> : isWrongPick ? <X aria-hidden="true" /> : null}
                  {c.name}
                </Button>
              );
            })}
          </div>
          {answer && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-[var(--glass-bg)] px-3 py-2 text-sm" role="status">
              <span className={cn("font-medium", answer.correct ? "text-up" : "text-down")}>
                {answer.correct ? t("quiz.right", { setup: answer.setup.name }) : t("quiz.wrong", { setup: answer.setup.name })}
              </span>
              <span className="text-muted-foreground">{t("quiz.reveal", { ticker: answer.ticker, date: fmtDate(answer.day, "medium") })}</span>
              {answer.note && <span className="basis-full text-muted-foreground">{answer.note}</span>}
              <span className="ml-auto flex gap-1.5">
                <Button size="sm" variant="ghost" asChild><Link href={links.setup(answer.setup.id)}>{t("quiz.openSetup")}</Link></Button>
                <Button size="sm" onClick={next} autoFocus>{t("quiz.next")}</Button>
              </span>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
