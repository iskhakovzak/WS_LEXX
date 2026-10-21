/**
 * Academy on the permission matrix (wave 1, item 1.6; audit team.md P1 «правило „куратор видит только своих“ здесь не
 * включить»). Academy routes used to test the role (isStaffRole); they now ask the matrix, so a curator whose scope is
 * «assigned» (or a group — item 1.19) reaches only their own people:
 *
 *   ACADEMY_MENTOR_CAP   mentor work: review queue and grading, the students' progress matrix, the course editor,
 *                        drafts. Person-scoped where a person is involved (`{ trader }`).
 *   ACADEMY_READ_CAP     reading another person's academy data (/academy/my?user=, idp, one-on-ones, attendance).
 *
 * Both are existing team capabilities (curator / admin by default), so nothing changes for a desk with default rights.
 */
import type { Request, Response } from "express";
import { can, readScope, requireCap, type Capability } from "./permissions";

export const ACADEMY_MENTOR_CAP: Capability = "journal.review";
export const ACADEMY_READ_CAP: Capability = "team.read";

/** Mentor (curator / admin by default) — not tied to one person (drafts, editor, menus). */
export function isAcademyMentor(req: Request): Promise<boolean> {
  return can(req, ACADEMY_MENTOR_CAP);
}

/** 401 / 403 STAFF_ONLY unless the caller holds the mentor capability (for `trader` when given). */
export function requireAcademyMentor(req: Request, res: Response, trader?: string | null): Promise<boolean> {
  return requireCap(req, res, ACADEMY_MENTOR_CAP, trader ? { trader } : null, "STAFF_ONLY");
}

/** Whose people a mentor list may show: null = everyone (desk scope), else these names. */
export function academyMentorScope(req: Request): Promise<string[] | null> {
  return readScope(req, ACADEMY_MENTOR_CAP);
}

/** Filter names by a scope from academyMentorScope. */
export function inAcademyScope(scope: readonly string[] | null, name: string): boolean {
  return scope === null || scope.includes(name);
}

/**
 * The person an academy read is about: `requested` when the caller may read that person's data
 * (`can(req, ACADEMY_READ_CAP, { trader })` — scope-aware), otherwise the caller (`me`). No name → the caller.
 */
export async function academySubject(req: Request, me: string, requested: string | null | undefined): Promise<string> {
  const want = requested?.trim();
  if (!want || want === me) return me;
  return (await can(req, ACADEMY_READ_CAP, { trader: want })) ? want : me;
}
