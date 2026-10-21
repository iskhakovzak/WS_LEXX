/**
 * The watchlist caller (lib/watchlist/scope rules need the senior flag: ladder stage from lib/people/stage) and the
 * remembered list choice in users.settings.watchlistView («Свой / Деска», like themesView).
 */
import type { Request } from "express";
import { pool } from "@workspace/db";
import { resolveActor } from "../permissions";
import { isStaffRoleName } from "../accessRules";
import { stageOf } from "../people/stage";
import { logger } from "../logger";
import { normalizeWatchView, type WatchActor, type WatchView } from "./scope";

const memo = new WeakMap<Request, Promise<WatchActor | null>>();

/** The active member behind the request with his senior flag (one lookup per request). */
export function watchActor(req: Request): Promise<WatchActor | null> {
  let p = memo.get(req);
  if (!p) {
    p = (async () => {
      const a = await resolveActor(req);
      if (!a) return null;
      let senior = false;
      if (!a.guest && !isStaffRoleName(a.role)) {
        try { senior = (await stageOf(a.name)) === "senior"; } catch (err) { logger.warn({ err }, "watchlist: stage lookup failed"); }
      }
      return { id: Number(a.id), name: a.name, role: a.role, guest: a.guest, senior };
    })();
    memo.set(req, p);
  }
  return p;
}

export async function readWatchView(userId: number): Promise<WatchView> {
  try {
    const { rows } = await pool.query<{ v: unknown }>(`SELECT settings->'watchlistView' AS v FROM users WHERE id = $1`, [userId]);
    return normalizeWatchView(rows[0]?.v);
  } catch (err) {
    logger.warn({ err }, "watchlist: view read failed");
    return normalizeWatchView(null);
  }
}

export async function writeWatchView(userId: number, view: WatchView): Promise<WatchView> {
  const { rows } = await pool.query<{ v: unknown }>(
    `UPDATE users SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('watchlistView', $2::jsonb)
      WHERE id = $1 RETURNING settings->'watchlistView' AS v`,
    [userId, JSON.stringify(view)],
  );
  return normalizeWatchView(rows[0]?.v);
}
