/**
 * Sections closed per ladder stage (desk setting access.sections: web nav href → blocked stages; {} = everything open,
 * the default). The web hides a closed section from every menu and shows «Раздел закрыт» on its URL (GET
 * /permissions/me → nav.blocked); this module is the server half: ONE table maps the API paths of a section's main data
 * endpoints to its href, and ONE middleware (routes/index.ts, before the routers) answers 403 SECTION_BLOCKED for a
 * viewer whose stage is closed there. Staff (curator / admin) are never blocked.
 *
 * Cost: with nothing closed (the default) the middleware returns before resolving anybody. Otherwise only a request
 * to a closed section's path resolves the actor (cached on the request) and the stage (cached per name, 60 s).
 *
 * Not blocked on purpose: /dailyfeed/stream (the automatic desk stream also feeds the dashboard and the day plan) — a
 * `null` section in the table wins as the longer prefix.
 */
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../http/errors";
import { resolveActor } from "../permissions";
import { setting } from "../settings/registry";
import { viewerStage, type AccessStage } from "./stage";

/** API path prefix (relative to /api) → the web section it serves; null = never blocked. Longest prefix wins. */
export const SECTION_API: readonly (readonly [prefix: string, section: string | null])[] = [
  ["/top", "/top-results"],
  ["/leaderboard", "/ratings"],
  ["/discussions", "/discussions"],
  ["/dailyfeed", "/dailyfeed"],
  ["/dailyfeed/stream", null],
  ["/desk-day", "/desk-day"],
  ["/office-stats", "/office"],
  ["/benchmark", "/benchmark"],
  ["/trade-ideas", "/trade-ideas"],
  ["/trade-ideas/stats", "/trade-idea-stats"],
  ["/activity", "/activity"],
];

const BY_LENGTH = [...SECTION_API].sort((a, b) => b[0].length - a[0].length);

/** The section an API path belongs to (null: none, or explicitly never blocked). */
export function sectionOfApiPath(path: string): string | null {
  for (const [prefix, section] of BY_LENGTH) if (path === prefix || path.startsWith(prefix + "/")) return section;
  return null;
}

type SectionMap = Readonly<Record<string, readonly AccessStage[]>>;

/** Hrefs closed for `stage` (null = staff → nothing). */
export function blockedSectionsFor(stage: AccessStage | null, map: SectionMap = setting("access.sections")): string[] {
  if (!stage) return [];
  return Object.keys(map).filter((href) => map[href]?.includes(stage)).sort();
}

/** Is `section` closed for `stage`? Staff (stage null) never. */
export function isSectionBlocked(section: string | null, stage: AccessStage | null, map: SectionMap = setting("access.sections")): boolean {
  return !!section && !!stage && !!map[section]?.includes(stage);
}

/** Express middleware: 403 SECTION_BLOCKED on a closed section's endpoints (see the header). */
export async function sectionAccessMiddleware(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const map = setting("access.sections");
    if (!Object.keys(map).length) return next();
    const section = sectionOfApiPath(req.path);
    if (!section || !map[section]?.length) return next();
    const actor = await resolveActor(req);
    if (!actor || actor.role === "curator" || actor.role === "admin") return next(); // signed-out: the route answers 401
    const stage = actor.guest ? "junior" : await viewerStage(actor.name);
    if (isSectionBlocked(section, stage, map)) return next(new AppError("SECTION_BLOCKED", undefined, undefined, { section, stage }));
    next();
  } catch (err) {
    next(err);
  }
}
