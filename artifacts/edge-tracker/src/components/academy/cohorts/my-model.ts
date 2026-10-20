/**
 * /academy/my — which course and which step a learner sees first (wave 1, item 1.6: no dead end for a trader who is not
 * in a cohort yet). The same progress model as /academy/learn (server Progress: pct, done / total, `next` item).
 * Pure; tested in __tests__/my-model.test.ts.
 */
import type { CatalogProgram, Progress } from "@/components/academy/content/api";

export type NextStepMode = "start" | "continue" | "done";

export interface NextStep {
  program: CatalogProgram;
  next: Progress["next"];
  mode: NextStepMode;
  /** Other courses the learner can open (for «Все курсы (N)»). */
  others: number;
}

/** First unfinished course with content (catalog order), else the first course; null without courses. */
export function nextStepOf(programs: readonly CatalogProgram[]): NextStep | null {
  const program = programs.find((x) => x.progress.pct < 100 && x.progress.total > 0) ?? programs[0];
  if (!program) return null;
  const next = program.progress.next;
  const mode: NextStepMode = !next ? "done" : program.progress.done > 0 ? "continue" : "start";
  return { program, next, mode, others: programs.length - 1 };
}
