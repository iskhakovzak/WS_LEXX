/**
 * Per-user rate limits for the expensive endpoints (speech-to-text, AI text rewrites/summaries, voice uploads).
 * Route-level middleware: the global auth middleware has already run, so the key is the user id when there is a
 * token and the (IPv6-subnet-normalised) IP otherwise. Put the limiter BEFORE multer so a rejected request does
 * not buffer its upload first. In-memory store — per process, reset on restart (good enough for one instance).
 */
import rateLimit, { ipKeyGenerator, type Options } from "express-rate-limit";
import type { Request } from "express";

export function rateLimitKey(req: Request): string {
  const u = req.authUser;
  if (u && typeof u.id === "number" && u.id > 0) return `u:${u.id}`;
  return `ip:${ipKeyGenerator(req.ip ?? "")}`;
}

const RATE_LIMITED = { error: "Слишком много запросов, попробуйте позже", code: "RATE_LIMITED" } as const;

function perUser(windowMs: number, limit: number, extra?: Partial<Options>) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: rateLimitKey,
    message: RATE_LIMITED,
    ...extra,
  });
}

/** POST /voice-notes/transcribe — Whisper call per request. */
export const transcribeLimiter = perUser(10 * 60 * 1000, 30);
/** POST /voice-notes — upload to object storage + transcription. */
export const voiceNoteLimiter = perUser(10 * 60 * 1000, 30);
/** AI text endpoints (author-notes improve / weekly-summary / team-summary, junior-notes improve) — one shared bucket. */
export const aiTextLimiter = perUser(10 * 60 * 1000, 20);
