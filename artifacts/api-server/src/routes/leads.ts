/**
 * Public landing lead form (artifacts/landing).
 *
 *   POST /leads   public; per-IP limiter (5 per 15 min), 16 KB body; validates (lib/leads/schema), stores a row in
 *                 `leads`, tells the owner in Telegram (lib/leads/notify, fire-and-forget) -> 201 { ok: true }
 *
 * A filled honeypot (`website`) answers 201 and stores nothing. The landing is served same-origin through Caddy
 * (docs/DEPLOY.md); a landing on another origin needs LEADS_ALLOWED_ORIGINS (CORS for this one path, app.ts).
 */
import { Router, type IRouter, type RequestHandler } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { pool } from "@workspace/db";
import { route } from "../lib/http";
import { rateLimitedBody } from "../lib/rateLimits";
import { LeadBody, type Lead } from "../lib/leads/schema";
import { notifyLeadOwner } from "../lib/leads/notify";
import { logger } from "../lib/logger";

/** Per IP: 5 submissions per 15 minutes (a person sends one; a retry after an error fits). */
export function leadsLimiter(limit = 5): RequestHandler {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => `lead:${ipKeyGenerator(req.ip ?? "")}`,
    message: rateLimitedBody,
  });
}

async function insertLead(l: Lead, userAgent: string | null): Promise<number> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO leads (segment, name, company, traders_count, platform, email, locale, message, source_page, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [l.segment, l.name, l.company ?? null, l.tradersCount ?? null, l.platform ?? null, l.email, l.locale,
      l.message ?? null, l.page ?? null, userAgent ? userAgent.slice(0, 400) : null],
  );
  return Number(rows[0]!.id);
}

export function createLeadsRouter(limiter: RequestHandler = leadsLimiter()): IRouter {
  const router: IRouter = Router();
  router.post("/leads", limiter, route({ body: LeadBody }, async ({ body, req, res }) => {
    const { website, ...lead } = body;
    if (website?.trim()) {
      res.status(201).json({ ok: true });
      return;
    }
    const id = await insertLead(lead, req.get("user-agent") ?? null);
    void notifyLeadOwner(id, lead).catch((err) => logger.warn({ err: (err as Error)?.message }, "lead notice failed"));
    res.status(201).json({ ok: true });
  }));
  return router;
}

export default createLeadsRouter();
