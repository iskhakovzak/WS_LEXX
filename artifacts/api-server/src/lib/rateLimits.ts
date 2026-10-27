/**
 * Per-user rate limits for the expensive endpoints (speech-to-text, AI text rewrites/summaries, voice uploads).
 * Route-level middleware: the global auth middleware has already run, so the key is the user id when there is a
 * token and the (IPv6-subnet-normalised) IP otherwise. Put the limiter BEFORE multer so a rejected request does
 * not buffer its upload first. In-memory store — per process, reset on restart (good enough for one instance).
 */
import rateLimit, { ipKeyGenerator, type Options } from "express-rate-limit";
import type { Request } from "express";
import { langOf } from "../i18n";
import { AppError, errorBody } from "./http/errors";
import { setting } from "./settings/registry";

export function rateLimitKey(req: Request): string {
  const u = req.authUser;
  if (u && typeof u.id === "number" && u.id > 0) return `u:${u.id}`;
  return `ip:${ipKeyGenerator(req.ip ?? "")}`;
}

/** 429 body in the request language (same shape as every API error). */
export const rateLimitedBody = (req: Request) => errorBody(new AppError("RATE_LIMITED"), langOf(req));

function perUser(windowMs: number, limit: number, extra?: Partial<Options>) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: rateLimitKey,
    message: rateLimitedBody,
    ...extra,
  });
}

/** POST /voice-notes/transcribe — Whisper call per request. */
export const transcribeLimiter = perUser(10 * 60 * 1000, 30);
/** POST /voice-notes — upload to object storage + transcription. */
export const voiceNoteLimiter = perUser(10 * 60 * 1000, 30);
/** AI text endpoints (author-notes improve / weekly-summary / team-summary, junior-notes improve) — one shared bucket. */
export const aiTextLimiter = perUser(10 * 60 * 1000, 20);
/**
 * «Ассистент WS» (POST /ai/assistant/chat and /assist): one bucket per user, the size is the desk setting
 * assistant.requestsPer10Min (read on every request, so an admin change applies at once). Daily token budgets are
 * separate (lib/assistant/store budgetOf).
 */
export const assistantLimiter = perUser(10 * 60 * 1000, 20, { limit: () => setting("assistant.requestsPer10Min") });
/** POST /usage/batch — the web tracker flushes every ~15 s and on page hide; 30 a minute leaves room for tab hops. */
export const usageLimiter = perUser(60 * 1000, 30);

/**
 * Does a /themes write (personal theme or board) change or revive a Finviz screener? Only those writes start a
 * Finviz export; renames, columns, sort, pins and archiving do not and are never limited.
 */
export function changesScreener(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return b.kind === "screener" || b.screener !== undefined || b.order !== undefined || b.top !== undefined || b.active === true;
}

/**
 * Screener-changing /themes writes (routes/themes.ts, routes/themes-boards.ts): each one queues a Finviz export in
 * the one shared ≥ 3 s queue (lib/finviz/client), so one member may not flood it — 20 per 10 minutes.
 */
export const screenerWriteLimiter = perUser(10 * 60 * 1000, 20, { skip: (req) => !changesScreener(req.body) });
