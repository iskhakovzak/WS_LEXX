/**
 * DEV-06 tier locks, enforced once for every setup route: a setup above the viewer's tier (same rule and gateway
 * unlocks as «Сегодня» / GET /playbook — lib/playbookToday/service viewerLocks) is closed for reading its card,
 * examples, stats, marks, checklist runs… and for writing to it (adding an example, a checklist run, a mark).
 * Staff and anonymous callers are never locked. GET /playbook keeps listing a locked setup as a redacted row.
 *
 *   router.use("/playbook/:id", setupLockGuard)      routes/playbook.ts (mounted before playbook-spaces in routes/index.ts)
 *   await assertSetupUnlocked(req, id)               routes/playbook-spaces.ts setupForRead (also POST /playbook-media)
 *
 * A locked setup answers 403 PLAYBOOK_SETUP_LOCKED (params.name). GET /playbook/:id/children is exempt: it lists the
 * children with their own lock state, redacted per row like the main list.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { pool } from "@workspace/db";
import { viewerLocks, type ViewerLocks } from "./playbookToday/service";
import { AppError } from "./http";

declare global {
  namespace Express {
    interface Request {
      /** Setup ids already checked against the tier locks in this request (the guard runs in two routers). */
      playbookUnlocked?: Set<number>;
      playbookLocks?: Promise<ViewerLocks>;
    }
  }
}

/** Throws 403 PLAYBOOK_SETUP_LOCKED when setup `id` is above the caller's tier; a missing setup is left to the route. */
export async function assertSetupUnlocked(req: Request, id: number): Promise<void> {
  if (req.playbookUnlocked?.has(id)) return;
  const viewer = req.authUser?.name;
  if (viewer) {
    const locks = await (req.playbookLocks ??= viewerLocks(viewer));
    let lock = locks.known.get(id);
    let row: { name: string; minTier: string | null } | undefined;
    if (!lock || lock.locked) {
      const { rows } = await pool.query<{ name: string; minTier: string | null }>(
        `SELECT name, min_tier AS "minTier" FROM playbook WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );
      row = rows[0];
      if (!lock && row) lock = locks.lockOther(row);
    }
    if (lock?.locked) throw new AppError("PLAYBOOK_SETUP_LOCKED", 403, { name: row?.name ?? String(id) });
  }
  (req.playbookUnlocked ??= new Set()).add(id);
}

/** Express middleware for `/playbook/:id` (and everything below it); non-numeric ids (today, tags…) pass through. */
export const setupLockGuard: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  const raw = req.params.id;
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0 || String(id) !== raw) return next();
  if (req.method === "GET" && /^\/children\/?$/.test(req.path)) return next();
  assertSetupUnlocked(req, id).then(() => next(), next);
};

/** Ids of the setups (among `rows`) locked for the caller — the for-trade popover drops them. */
export async function lockedSetupIds(req: Request, rows: readonly { id: number; name: string; minTier?: string | null }[]): Promise<Set<number>> {
  const out = new Set<number>();
  const viewer = req.authUser?.name;
  if (!viewer || !rows.length) return out;
  const locks = await (req.playbookLocks ??= viewerLocks(viewer));
  for (const r of rows) {
    const lock = locks.known.get(r.id) ?? locks.lockOther({ name: r.name, minTier: r.minTier ?? null });
    if (lock.locked) out.add(r.id);
  }
  return out;
}
