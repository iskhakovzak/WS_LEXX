/**
 * The one API error contract.
 *
 *   throw notFound("TRADE_NOT_FOUND");               → 404 { error: "Сделка не найдена", code: "TRADE_NOT_FOUND" }
 *   throw badRequest("INVALID_ID");                  → 400 { error: "Некорректный идентификатор", code: "INVALID_ID" }
 *   throw forbidden("trades.write");                 → 403 { error: "…", code: "FORBIDDEN", details: { capability } }
 *   throw new AppError("CONFLICT", 409, undefined, { field: "name" });
 *
 * Handlers throw; only the error middleware (./middleware.ts) writes the body, translating `code` into the
 * request language (errors namespace, src/i18n/<lang>/errors.ts). `error` stays in the body because the
 * frontend shows it. Codes and their default statuses: ERROR_CODES below, documented in ./CODES.md.
 *
 * `sendError(res, err)` writes the same body without throwing — only for code that must answer inside a
 * try/catch or a helper that returns a boolean. New code throws.
 */
import type { Request, Response } from "express";
import type { Capability } from "../permissionsMatrix";
import { langOf, type Lang, type Params } from "../../i18n";
import { errorsT } from "../../i18n/ns";
import type ruErrors from "../../i18n/ru/errors";

/** Default HTTP status of every code. Keys must match src/i18n/ru/errors.ts exactly (tsc checks both ways). */
export const ERROR_CODES = {
  BAD_REQUEST: 400,
  VALIDATION: 400,
  INVALID_JSON: 400,
  INVALID_ID: 400,
  INVALID_DATE: 400,
  INVALID_TICKER: 400,
  TICKER_REQUIRED: 400,
  INVALID_TRADER: 400,
  TRADER_REQUIRED: 400,
  NO_FIELDS: 400,
  UPLOAD_ERROR: 400,
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  GUEST_READ_ONLY: 403,
  STAFF_ONLY: 403,
  TRADE_FORBIDDEN: 403,
  CORS_REJECTED: 403,
  NOT_FOUND: 404,
  TRADE_NOT_FOUND: 404,
  TRADER_NOT_FOUND: 404,
  USER_NOT_FOUND: 404,
  RESEARCH_NOT_FOUND: 404,
  EVENT_NOT_FOUND: 404,
  FEED_ENTRY_NOT_FOUND: 404,
  DISCUSSION_NOT_FOUND: 404,
  COMMENT_NOT_FOUND: 404,
  IDEA_NOT_FOUND: 404,
  COHORT_NOT_FOUND: 404,
  SESSION_NOT_FOUND: 404,
  CHECKLIST_ITEM_NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  AI_UNAVAILABLE: 502,
  TIMEOUT: 503,
} as const satisfies Record<keyof typeof ruErrors, number>;

export type ErrorCode = keyof typeof ERROR_CODES;

export function isErrorCode(v: unknown): v is ErrorCode {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(ERROR_CODES, v);
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  /** Interpolation values for the message ({name} placeholders in the dictionary). */
  readonly params?: Params;
  /** Machine-readable extras sent as `details` (validation issues, capability, field…). */
  readonly details?: unknown;

  constructor(code: ErrorCode, status?: number, params?: Params, details?: unknown) {
    super(code);
    this.name = "AppError";
    this.code = code;
    this.status = status ?? ERROR_CODES[code];
    this.params = params;
    this.details = details;
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

// ─── Helpers (return the error: `throw notFound()`) ──────────────────────────────────────────────────────

export const badRequest = (code: ErrorCode = "BAD_REQUEST", details?: unknown, params?: Params) =>
  new AppError(code, 400, params, details);

export const notFound = (code: ErrorCode = "NOT_FOUND", params?: Params) => new AppError(code, 404, params);

export const unauthorized = () => new AppError("AUTH_REQUIRED", 401);

/** 403. With a capability the body carries `details.capability` (the frontend can name the missing right). */
export const forbidden = (cap?: Capability, code: ErrorCode = "FORBIDDEN") =>
  new AppError(code, 403, undefined, cap ? { capability: cap } : undefined);

export const conflict = (code: ErrorCode = "CONFLICT", details?: unknown, params?: Params) =>
  new AppError(code, 409, params, details);

export const tooLarge = (code: ErrorCode = "TOO_LARGE") => new AppError(code, 413);

// ─── Body ────────────────────────────────────────────────────────────────────────────────────────────────

export type ErrorBody = { error: string; code: ErrorCode; details?: unknown; requestId?: string };

/** Localized text of a code. */
export function errorMessage(code: ErrorCode, lang: Lang | null | undefined, params?: Params): string {
  return errorsT.tryFor(lang, code, params) ?? code;
}

/** The response body for an AppError in `lang`. `requestId` is added for 5xx (the user can quote it). */
export function errorBody(err: AppError, lang: Lang | null | undefined, requestId?: string): ErrorBody {
  const body: ErrorBody = { error: errorMessage(err.code, lang, err.params), code: err.code };
  if (err.details !== undefined) body.details = err.details;
  if (err.status >= 500 && requestId) body.requestId = requestId;
  return body;
}

/** pino-http request id (string or number) as a string, if any. */
export function requestIdOf(req: Request | undefined): string | undefined {
  const id = (req as (Request & { id?: unknown }) | undefined)?.id;
  return id === undefined || id === null || id === "" ? undefined : String(id);
}

/**
 * Write an AppError as the response (same body as the middleware) and return `res`.
 * Use only where throwing is not possible (inside try/catch that would swallow it, boolean helpers).
 */
export function sendError(res: Response, err: AppError): Response {
  const req = res.req as Request | undefined;
  const lang = req ? langOf(req) : undefined;
  return res.status(err.status).json(errorBody(err, lang, requestIdOf(req)));
}
