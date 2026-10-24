/**
 * Cascading rename of a desk person. users.name is the plain-text key of everything the person owns or did
 * (trades.trader, journal, academy, notifications …): a rename moves every reference listed in ./renameUserColumns.ts
 * to the new name in ONE transaction, together with users.name (and optionally users.name_latin), bumps the token
 * version (the name is signed into the token, so every session signs in again) and writes one audit entry
 * «user.rename» {from, to, rows, tables} in the same transaction.
 *
 *   renameUser(pool, { userId, newName, actor })                 → RenameReport (committed)
 *   renameUser(pool, { userId, newName, actor, dryRun: true })   → same report, rolled back (exact per-table counts)
 *   renameUserInTx(client, …)                                    → inside a caller's BEGIN … COMMIT (PATCH /users/:id)
 *
 * Refused (RenameError, nothing written):
 *   INVALID_FIELD          the name is empty or longer than 100 characters (same rule as POST / PATCH /users)
 *   NOT_FOUND              no user with that id
 *   USER_NAME_TAKEN        another user is called that, or signs in with it as a Latin name — compared the way the
 *                          sign-in compares names (lib/security/loginGuard normalizeLoginName: case, ё/е, spaces)
 *   RENAME_DATA_CONFLICT   rows already carry the new name (orphans of an earlier person, an import under that name):
 *                          merging them silently could break unique keys or mix two people — clean them up first
 *
 * Tables or columns that don't exist on this database (an older schema) are skipped and listed in `missing`.
 * In-process caches are the caller's job after the commit (latin names, settings, quests, token-version cache).
 */
import { normalizeLoginName } from "../security/loginGuard";
import { RENAME_TARGETS, type RenameKind, type RenameTarget } from "./renameUserColumns";

type QueryResult = { rows: any[]; rowCount: number | null };
export interface RenameClient {
  query(sql: string, params?: unknown[]): Promise<QueryResult>;
}
export interface RenamePool {
  connect(): Promise<RenameClient & { release(err?: Error | boolean): void }>;
}

export type RenameOptions = {
  userId: number;
  newName: string;
  /** Who renames (audit actor). */
  actor: string;
  /** Also set users.name_latin (undefined = leave as is, null / "" = clear). Validated by the caller. */
  nameLatin?: string | null;
  dryRun?: boolean;
  /** Test hook: a different column list (the default is the reviewed RENAME_TARGETS). */
  targets?: readonly RenameTarget[];
};

export type RenameCount = { table: string; column: string; kind: RenameKind; rows: number };
export type RenameReport = {
  userId: number;
  from: string;
  to: string;
  nameLatin: { from: string | null; to: string | null } | null;
  dryRun: boolean;
  /** Only targets with at least one row. */
  counts: RenameCount[];
  total: number;
  /** Listed targets this database doesn't have. */
  missing: string[];
};

export type RenameErrorCode = "INVALID_FIELD" | "NOT_FOUND" | "USER_NAME_TAKEN" | "RENAME_DATA_CONFLICT";
export class RenameError extends Error {
  constructor(readonly code: RenameErrorCode, readonly details?: Record<string, unknown>) {
    super(code);
    this.name = "RenameError";
  }
}

export const MAX_NAME_LENGTH = 100;

/** The name as it will be stored (trimmed), or null when it is not acceptable. */
export function cleanUserName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return v && v.length <= MAX_NAME_LENGTH ? v : null;
}

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

// ─── pure helpers (unit-tested) ─────────────────────────────────────────────────────────────────────────

/** Deep copy of a JSON value with every string / object key exactly equal to `from` replaced; `changed` tells. */
export function renameInJson(value: unknown, from: string, to: string): { value: unknown; changed: boolean } {
  let changed = false;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      if (v === from) { changed = true; return to; }
      return v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        const key = k === from ? to : k;
        if (key !== k) changed = true;
        out[key] = walk(x);
      }
      return out;
    }
    return v;
  };
  const value2 = walk(value);
  return { value: changed ? value2 : value, changed };
}

/** An in-app link with every query parameter equal to `from` set to `to` («/risk?trader=…»); unchanged otherwise. */
export function renameInLink(link: string, from: string, to: string): string {
  const q = link.indexOf("?");
  if (q < 0) return link;
  const h = link.indexOf("#", q);
  const query = link.slice(q + 1, h < 0 ? undefined : h);
  const out = new URLSearchParams();
  let changed = false;
  for (const [k, v] of new URLSearchParams(query)) {
    if (v === from) changed = true;
    out.append(k, v === from ? to : v);
  }
  return changed ? `${link.slice(0, q)}?${out.toString()}${h < 0 ? "" : link.slice(h)}` : link;
}

/** A ','/';'/newline list of names (usage.pilotUsers) with entries equal to `from` (case-insensitive) replaced. */
export function renameInNameList(text: string, from: string, to: string): string {
  const lower = from.trim().toLowerCase();
  return text.split(/([,;\n])/).map((part) => {
    if (part.trim().toLowerCase() !== lower) return part;
    const lead = /^\s*/.exec(part)?.[0] ?? "";
    const tail = /\s*$/.exec(part)?.[0] ?? "";
    return `${lead}${to}${tail}`;
  }).join("");
}

/** How the two encodings of a name look inside a link (encodeURIComponent «%20» and URLSearchParams «+»). */
function linkNeedles(name: string): string[] {
  return [...new Set([encodeURIComponent(name), new URLSearchParams({ x: name }).toString().slice(2)])];
}

// ─── per-kind SQL ───────────────────────────────────────────────────────────────────────────────────────

type Ctx = { client: RenameClient; from: string; to: string };

async function renameText(c: Ctx, t: RenameTarget): Promise<number> {
  const r = await c.client.query(`UPDATE ${ident(t.table)} SET ${ident(t.column)} = $2 WHERE ${ident(t.column)} = $1`, [c.from, c.to]);
  return r.rowCount ?? 0;
}

async function renameArray(c: Ctx, t: RenameTarget): Promise<number> {
  const col = ident(t.column);
  const r = await c.client.query(`UPDATE ${ident(t.table)} SET ${col} = array_replace(${col}, $1, $2) WHERE $1 = ANY(${col})`, [c.from, c.to]);
  return r.rowCount ?? 0;
}

async function renameSegments(c: Ctx, t: RenameTarget): Promise<number> {
  const col = ident(t.column);
  const r = await c.client.query(
    `UPDATE ${ident(t.table)} SET ${col} = array_to_string(array_replace(string_to_array(${col}, ':'), $1, $2), ':')
      WHERE $1 = ANY(string_to_array(${col}, ':'))`,
    [c.from, c.to],
  );
  return r.rowCount ?? 0;
}

/** Rows are picked with a text pre-filter, rewritten in JS and written back by ctid (locked FOR UPDATE meanwhile). */
async function rewriteRows(c: Ctx, t: RenameTarget, where: string, params: unknown[], cast: string, fn: (v: unknown) => unknown | undefined): Promise<number> {
  const col = ident(t.column);
  const { rows } = await c.client.query(`SELECT ctid::text AS ctid, ${col} AS v FROM ${ident(t.table)} WHERE ${where} FOR UPDATE`, params);
  let n = 0;
  for (const r of rows) {
    const next = fn(r.v);
    if (next === undefined) continue;
    await c.client.query(`UPDATE ${ident(t.table)} SET ${col} = $1${cast} WHERE ctid = $2::tid`, [next, r.ctid]);
    n++;
  }
  return n;
}

function renameJson(c: Ctx, t: RenameTarget, udt: string): Promise<number> {
  const col = ident(t.column);
  return rewriteRows(c, t, `strpos(${col}::text, $1) > 0`, [JSON.stringify(c.from)], `::${udt === "json" ? "json" : "jsonb"}`, (v) => {
    const r = renameInJson(v, c.from, c.to);
    return r.changed ? JSON.stringify(r.value) : undefined;
  });
}

function renameLink(c: Ctx, t: RenameTarget): Promise<number> {
  const col = ident(t.column);
  const needles = linkNeedles(c.from);
  const where = `${col} LIKE '%?%' AND (${needles.map((_, i) => `strpos(${col}, $${i + 1}) > 0`).join(" OR ")})`;
  return rewriteRows(c, t, where, needles, "", (v) => {
    if (typeof v !== "string") return undefined;
    const next = renameInLink(v, c.from, c.to);
    return next === v ? undefined : next;
  });
}

function renameNameList(c: Ctx, t: RenameTarget): Promise<number> {
  return rewriteRows(c, t, `key = $1`, [t.settingKey], "::jsonb", (v) => {
    if (typeof v !== "string") return undefined;
    const next = renameInNameList(v, c.from, c.to);
    return next === v ? undefined : JSON.stringify(next);
  });
}

// ─── the rename ─────────────────────────────────────────────────────────────────────────────────────────

/** Existing (table, column) → udt name, for the listed targets. */
async function schemaOf(client: RenameClient, targets: readonly RenameTarget[]): Promise<Map<string, string>> {
  const tables = [...new Set(targets.map((t) => t.table))];
  const { rows } = await client.query(
    `SELECT table_name, column_name, udt_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`,
    [tables],
  );
  return new Map(rows.map((r: any) => [`${r.table_name}.${r.column_name}`, String(r.udt_name)]));
}

/** Rows that already carry the new name in a plain renamed column (would merge two people / break unique keys). */
async function conflicts(client: RenameClient, targets: readonly RenameTarget[], to: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of targets) {
    if (t.kind !== "text") continue;
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${ident(t.table)} WHERE ${ident(t.column)} = $1`, [to]);
    if (rows[0]?.n) out[`${t.table}.${t.column}`] = Number(rows[0].n);
  }
  return out;
}

/** The rename inside the caller's transaction (BEGIN … COMMIT / ROLLBACK is theirs). */
export async function renameUserInTx(client: RenameClient, opts: RenameOptions): Promise<RenameReport> {
  const to = cleanUserName(opts.newName);
  if (!to) throw new RenameError("INVALID_FIELD", { field: "name" });
  await client.query(`SET LOCAL lock_timeout = '5s'`);
  await client.query(`SET LOCAL statement_timeout = '10min'`);
  const { rows: me } = await client.query(`SELECT id, name, name_latin FROM users WHERE id = $1 FOR UPDATE`, [opts.userId]);
  if (!me[0]) throw new RenameError("NOT_FOUND");
  const from = String(me[0].name);
  const latinBefore: string | null = me[0].name_latin ?? null;

  const key = normalizeLoginName(to);
  const { rows: others } = await client.query(`SELECT id, name, name_latin FROM users WHERE id <> $1`, [opts.userId]);
  const clash = others.find((u: any) => normalizeLoginName(String(u.name)) === key || (u.name_latin && normalizeLoginName(String(u.name_latin)) === key));
  if (clash) throw new RenameError("USER_NAME_TAKEN", { id: Number(clash.id) });

  const all = opts.targets ?? RENAME_TARGETS;
  const cols = await schemaOf(client, all);
  const missing = all.filter((t) => !cols.has(`${t.table}.${t.column}`)).map((t) => `${t.table}.${t.column}`);
  const targets = all.filter((t) => cols.has(`${t.table}.${t.column}`));

  const counts: RenameCount[] = [];
  if (to !== from) {
    const taken = await conflicts(client, targets, to);
    if (Object.keys(taken).length) throw new RenameError("RENAME_DATA_CONFLICT", { name: to, rows: taken });
    const c: Ctx = { client, from, to };
    for (const t of targets) {
      const rows =
        t.kind === "text" ? await renameText(c, t)
        : t.kind === "array" ? await renameArray(c, t)
        : t.kind === "segments" ? await renameSegments(c, t)
        : t.kind === "link" ? await renameLink(c, t)
        : t.kind === "nameList" ? await renameNameList(c, t)
        : await renameJson(c, t, cols.get(`${t.table}.${t.column}`) ?? "jsonb");
      if (rows) counts.push({ table: t.table, column: t.column, kind: t.kind, rows });
    }
  }

  const latinTo = opts.nameLatin === undefined ? latinBefore : (opts.nameLatin?.trim() || null);
  await client.query(`UPDATE users SET name = $2, name_latin = $3, token_version = token_version + 1 WHERE id = $1`, [opts.userId, to, latinTo]);
  const total = counts.reduce((s, x) => s + x.rows, 0);
  const nameLatin = latinTo !== latinBefore ? { from: latinBefore, to: latinTo } : null;
  await client.query(
    `INSERT INTO audit_log (actor, action, target_type, target_id, details) VALUES ($1, 'user.rename', 'user', $2, $3)`,
    [opts.actor, String(opts.userId), JSON.stringify({
      from, to, rows: total, tables: Object.fromEntries(counts.map((x) => [`${x.table}.${x.column}`, x.rows])),
      ...(nameLatin ? { nameLatin } : {}),
    })],
  );
  return { userId: opts.userId, from, to, nameLatin, dryRun: !!opts.dryRun, counts, total, missing };
}

/**
 * Earlier names of a user, newest first, from the «user.rename» audit entries (indexed by action; renames are rare).
 * Sent with a successful sign-in so the browser moves its name-keyed storage along (edge-tracker lib/people/rename-local).
 */
export async function formerNamesOf(client: RenameClient, userId: number, limit = 5): Promise<string[]> {
  const { rows } = await client.query(
    `SELECT details FROM audit_log WHERE action = 'user.rename' AND target_type = 'user' AND target_id = $1 ORDER BY id DESC LIMIT $2`,
    [String(userId), limit],
  );
  const out: string[] = [];
  for (const r of rows) {
    try {
      const from = (JSON.parse(String(r.details)) as { from?: unknown }).from;
      if (typeof from === "string" && from && !out.includes(from)) out.push(from);
    } catch { /* not ours */ }
  }
  return out;
}

/** The rename in its own transaction; `dryRun` runs everything and rolls back (exact counts, nothing written). */
export async function renameUser(pool: RenamePool, opts: RenameOptions): Promise<RenameReport> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const report = await renameUserInTx(client, opts);
    await client.query(opts.dryRun ? "ROLLBACK" : "COMMIT");
    return report;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
