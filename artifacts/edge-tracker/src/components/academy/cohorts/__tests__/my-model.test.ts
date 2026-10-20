import { describe, expect, it } from "vitest";
import type { CatalogProgram } from "@/components/academy/content/api";
import { nextStepOf } from "../my-model";

const program = (id: number, done: number, total: number, next: CatalogProgram["progress"]["next"]): CatalogProgram => ({
  id, title: `P${id}`, published: true, stage: null, description: null, modules: 1,
  counts: { lessons: total, quizzes: 0, assignments: 0 }, durationMin: 10,
  progress: {
    total, done, pct: total ? (done / total) * 100 : 0, modules: [], next,
    byKind: { lesson: { total, done }, quiz: { total: 0, done: 0 }, assignment: { total: 0, done: 0 } },
  },
} as unknown as CatalogProgram);
const lesson = (id: number, title: string) => ({ kind: "lesson" as const, id, title });

describe("academy my-page: next step", () => {
  it("no courses → null (the page says so instead of a dead end)", () => {
    expect(nextStepOf([])).toBeNull();
  });
  it("a fresh learner starts with the first lesson of the first course", () => {
    const s = nextStepOf([program(1, 0, 6, lesson(11, "Риск и R"))])!;
    expect(s).toMatchObject({ mode: "start", next: { id: 11, title: "Риск и R" }, others: 0 });
    expect(s.program.id).toBe(1);
  });
  it("skips a finished course and continues the unfinished one", () => {
    const s = nextStepOf([program(1, 6, 6, null), program(2, 2, 4, lesson(23, "VWAP"))])!;
    expect(s).toMatchObject({ mode: "continue", next: { id: 23 }, others: 1 });
    expect(s.program.id).toBe(2);
  });
  it("everything done → the first course, mode done", () => {
    const s = nextStepOf([program(1, 6, 6, null), program(2, 0, 0, null)])!;
    expect(s).toMatchObject({ mode: "done", next: null });
    expect(s.program.id).toBe(1);
  });
});
