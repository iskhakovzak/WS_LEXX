/**
 * «Попросить куратора» (Волна 1 п. 1.1): storage of routes/curator-requests.ts. Table curator_requests (migration
 * 0230): one open request per trader and kind; resolved requests stay (done / dismissed + note + who / when).
 * Kind «review» (Волна 2 п. 2.13, migration «curator_request_review»): «Попросить разбор» from a discussion thread or
 * a trade idea — `link` is that thread («/discussions?thread=7», «/trade-ideas?idea=3»), one open request per thread.
 * Only the review paths read / write `link`, so the other kinds keep working before that migration is applied.
 */
import { pool } from "@workspace/db";

export const REQUEST_KINDS = ["limits", "group", "stage", "plan", "other", "review"] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];
export const REQUEST_STATUSES = ["open", "done", "dismissed"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export type CuratorRequest = {
  id: number; trader: string; traderId: number; kind: RequestKind; message: string; status: RequestStatus; note: string | null;
  createdAt: string; resolvedAt: string | null; resolvedBy: string | null;
  /** Kind «review»: the thread to review (a site path); null for the other kinds. */
  link: string | null;
};

/** A thread a review can be asked for: a discussion or a trade idea, as a site path. */
export const REVIEW_LINK_RE = /^\/(discussions\?thread=|trade-ideas\?idea=)[1-9]\d{0,9}$/;

type Row = Record<string, any>;
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

export function rowToRequest(r: Row): CuratorRequest {
  return {
    id: Number(r.id), trader: String(r.trader), traderId: Number(r.trader_id), kind: r.kind as RequestKind, message: String(r.message ?? ""),
    status: r.status as RequestStatus, note: r.note ?? null, createdAt: iso(r.created_at)!, resolvedAt: iso(r.resolved_at), resolvedBy: r.resolved_by ?? null,
    link: typeof r.link === "string" && r.link ? r.link : null,
  };
}

const SELECT = `SELECT r.*, t.name AS trader, rb.name AS resolved_by
  FROM curator_requests r JOIN users t ON t.id = r.trader_id LEFT JOIN users rb ON rb.id = r.resolved_by_id`;

/** The open request of this kind (for «review»: of this thread), if any — one per trader and kind / thread. */
export async function openRequestOf(traderId: number, kind: RequestKind, link: string | null = null): Promise<CuratorRequest | null> {
  const { rows } = link
    ? await pool.query(`${SELECT} WHERE r.trader_id = $1 AND r.kind = $2 AND r.link = $3 AND r.status = 'open' LIMIT 1`, [traderId, kind, link])
    : await pool.query(`${SELECT} WHERE r.trader_id = $1 AND r.kind = $2 AND r.status = 'open' LIMIT 1`, [traderId, kind]);
  return rows[0] ? rowToRequest(rows[0]) : null;
}

/** Insert an open request; null when another open one of the kind (thread) won a race (unique index). */
export async function insertRequest(traderId: number, kind: RequestKind, message: string, link: string | null = null): Promise<CuratorRequest | null> {
  try {
    const { rows } = link
      ? await pool.query(`INSERT INTO curator_requests (trader_id, kind, message, link) VALUES ($1, $2, $3, $4) RETURNING id`, [traderId, kind, message, link])
      : await pool.query(`INSERT INTO curator_requests (trader_id, kind, message) VALUES ($1, $2, $3) RETURNING id`, [traderId, kind, message]);
    return requestById(Number(rows[0].id));
  } catch (err) {
    if ((err as { code?: string })?.code === "23505") return null;
    throw err;
  }
}

export async function requestById(id: number): Promise<CuratorRequest | null> {
  const { rows } = await pool.query(`${SELECT} WHERE r.id = $1`, [id]);
  return rows[0] ? rowToRequest(rows[0]) : null;
}

/** The trader's own requests: every open one + the resolved ones of the last 30 days, newest first. */
export async function listMine(traderId: number): Promise<CuratorRequest[]> {
  const { rows } = await pool.query(
    `${SELECT} WHERE r.trader_id = $1 AND (r.status = 'open' OR r.resolved_at > now() - interval '30 days')
      ORDER BY (r.status = 'open') DESC, r.created_at DESC LIMIT 50`,
    [traderId],
  );
  return rows.map(rowToRequest);
}

/** Staff list: `traders` null = everyone; status null = any (open first, then the latest resolved). */
export async function listForStaff(traders: readonly string[] | null, status: RequestStatus | null): Promise<CuratorRequest[]> {
  if (traders && !traders.length) return [];
  const { rows } = await pool.query(
    `${SELECT} WHERE ($1::text[] IS NULL OR t.name = ANY($1::text[])) AND ($2::text IS NULL OR r.status = $2)
      ORDER BY (r.status = 'open') DESC, r.created_at ${status === "open" ? "ASC" : "DESC"} LIMIT 200`,
    [traders, status],
  );
  return rows.map(rowToRequest);
}

/** Close an open request (done / dismissed + optional note); null when it is not open any more. */
export async function resolveRequest(id: number, status: Exclude<RequestStatus, "open">, note: string | null, actorId: number): Promise<CuratorRequest | null> {
  const { rows } = await pool.query(
    `UPDATE curator_requests SET status = $2, note = $3, resolved_at = now(), resolved_by_id = $4 WHERE id = $1 AND status = 'open' RETURNING id`,
    [id, status, note, actorId],
  );
  return rows[0] ? requestById(id) : null;
}

/** The trader's id (active, not banned) or null. */
export async function memberId(name: string): Promise<number | null> {
  const { rows } = await pool.query(`SELECT id FROM users WHERE name = $1 AND active = true AND COALESCE(banned, false) = false LIMIT 1`, [name]);
  return rows[0] ? Number(rows[0].id) : null;
}

/** Who hears about a new request: the trader's group curator + assigned staff; nobody assigned → every active curator. */
export async function requestRecipients(trader: string): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT c.name FROM users t JOIN desk_groups g ON g.id = t.group_id AND g.archived_at IS NULL JOIN users c ON c.id = g.curator_id
      WHERE t.name = $1 AND c.active = true
     UNION
     SELECT x FROM users t, LATERAL unnest(ARRAY[t.assigned_curator, t.assigned_mentor, t.assigned_risk_manager]) AS x
      WHERE t.name = $1 AND x IS NOT NULL`,
    [trader],
  ).catch(() => ({ rows: [] as Row[] }));
  const named = [...new Set(rows.map((r) => String(r.name ?? r.x)).filter((n) => n && n !== trader))];
  if (named.length) return named;
  const { rows: all } = await pool.query(`SELECT name FROM users WHERE role = 'curator' AND active = true AND COALESCE(banned, false) = false`);
  return all.map((r) => String(r.name)).filter((n) => n !== trader);
}
