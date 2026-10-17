/**
 * Owner-or-staff guard for shared desk rows that carry `created_by` (big7 levels / catalysts / tickers, watchlist).
 * The rule itself is pure (accessRules.canModifyOwnedRow, unit-tested); this file only resolves the actor
 * (role from the DB, inactive/banned → null) and sends the 401/403.
 */
import type { Request, Response } from "express";
import { resolveActor } from "./permissions";
import { canModifyOwnedRow } from "./accessRules";

export const NOT_OWNER = {
  error: "Изменять или удалять запись может только её автор или куратор",
  code: "NOT_OWNER",
} as const;

/** Name to stamp into created_by on insert (the resolved, active member), or null for guest/anonymous. */
export async function creatorName(req: Request): Promise<string | null> {
  const actor = await resolveActor(req);
  return actor && !actor.guest ? actor.name : null;
}

/** Non-sending check (e.g. to filter a bulk action). */
export async function mayModifyRow(req: Request, createdBy: string | null | undefined): Promise<boolean> {
  return canModifyOwnedRow(await resolveActor(req), createdBy);
}

/** Sends 401 (no active actor) / 403 NOT_OWNER and returns false when the caller may not edit/delete the row. */
export async function requireRowOwnerOrStaff(req: Request, res: Response, createdBy: string | null | undefined): Promise<boolean> {
  const actor = await resolveActor(req);
  if (!actor) { res.status(401).json({ error: "Требуется вход", code: "AUTH_REQUIRED" }); return false; }
  if (!canModifyOwnedRow(actor, createdBy)) { res.status(403).json(NOT_OWNER); return false; }
  return true;
}
