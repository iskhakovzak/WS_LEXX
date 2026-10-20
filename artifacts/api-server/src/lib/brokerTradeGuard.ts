/**
 * Broker-sourced trades (PropReports) are the desk's money truth: ratings, risk, quests and levels read them.
 * Their broker-owned columns (lib/propreports/sync.ts "Ownership of trade columns") change only through the sync,
 * or by an admin (owner decision, Wave 0: not curators, not any grantable staff capability) — expressed as the
 * admin-only capability `settings.manage` (permissionsMatrix: adminOnly, never granted below admin). Everyone else keeps
 * the review layer of their own trade: setup, playbook link, tags, notes, grade, conviction, screenshots, stop / risk.
 *
 * Used by routes/trades.ts (PATCH / DELETE / bulk / POST) and routes/executions.ts (fills of a broker trade).
 */
import type { Request } from "express";
import { can } from "./permissions";
import { AppError } from "./http";

/** The capability that may change a broker trade's numbers, delete it or edit its fills (admin-only). */
export const BROKER_EDIT_CAP = "settings.manage" as const;

/**
 * Body keys of PATCH /trades/:id that the PropReports sync owns (overwritten on every sync), plus the owner.
 * `trader` stays here too: reassigning a broker trade moves its P&L between books.
 */
export const BROKER_OWNED_FIELDS = [
  "ticker", "date", "side", "entry", "exit", "qty", "fees", "pnl", "result",
  "session", "horizon", "exitDate", "holdTime", "trader",
] as const;

/** Raw-body keys that would mark a new trade as broker-sourced. */
const BROKER_MARKERS = ["source", "externalId", "external_id", "brokerAccount", "broker_account", "syncedAt", "synced_at"] as const;

type TradeLike = { source?: string | null; contextSnapshot?: unknown; context_snapshot?: unknown };

/** Broker-sourced: source = 'propreports', or a legacy admin-XLS row (context_snapshot.source = 'propreports'). */
export function isBrokerTrade(t: TradeLike | null | undefined): boolean {
  if (!t) return false;
  if (t.source === "propreports") return true;
  const snap = (t.contextSnapshot ?? t.context_snapshot) as { source?: unknown } | null | undefined;
  return !!snap && typeof snap === "object" && snap.source === "propreports";
}

/** SQL predicate of the same rule (alias = trades table alias, or the bare table). */
export function brokerTradeSql(alias?: string): string {
  const a = alias ? `${alias}.` : "";
  return `(${a}source = 'propreports' OR ${a}context_snapshot ->> 'source' = 'propreports')`;
}

export async function canEditBrokerTrades(req: Request): Promise<boolean> {
  return can(req, BROKER_EDIT_CAP);
}

/** 403 BROKER_TRADE_READ_ONLY (details name the capability and, for a PATCH, the refused fields). */
export function brokerReadOnly(fields?: readonly string[]): AppError {
  return new AppError("BROKER_TRADE_READ_ONLY", 403, undefined, fields?.length ? { capability: BROKER_EDIT_CAP, fields } : { capability: BROKER_EDIT_CAP });
}

const numLike = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Same value as stored? (pg numerics come back as strings; dates as 'YYYY-MM-DD' or a Date.) */
function sameValue(stored: unknown, sent: unknown): boolean {
  if (stored == null || stored === "") return sent == null || sent === "";
  const a = numLike(stored), b = numLike(sent);
  if (a !== null && b !== null && typeof sent === "number") return Math.abs(a - b) < 0.00005;
  const s = stored instanceof Date ? stored.toISOString().slice(0, 10) : String(stored);
  return s.trim().toLowerCase() === String(sent ?? "").trim().toLowerCase();
}

/**
 * Broker-owned keys of a PATCH body whose value differs from the stored row (a form that re-sends the unchanged
 * numbers is not a change). `result` compares canonical codes.
 */
export function changedBrokerFields(body: Record<string, unknown>, existing: Record<string, unknown>, normResult: (r: string) => string | null): string[] {
  const out: string[] = [];
  for (const f of BROKER_OWNED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, f)) continue;
    let sent = body[f];
    let stored = existing[f];
    if (f === "result") {
      sent = typeof sent === "string" ? (normResult(sent) ?? sent) : sent;
      stored = typeof stored === "string" ? (normResult(stored) ?? stored) : stored;
    }
    if (!sameValue(stored, sent)) out.push(f);
  }
  return out;
}

/** Does a raw POST /trades body try to mark the new trade as broker-sourced? */
export function claimsBrokerSource(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  if (b.source === "propreports") return true;
  for (const k of BROKER_MARKERS) if (k !== "source" && b[k] != null && b[k] !== "") return true;
  const snap = b.contextSnapshot ?? b.context_snapshot;
  return !!snap && typeof snap === "object" && (snap as { source?: unknown }).source === "propreports";
}
