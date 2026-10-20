/**
 * «Мои темы» (user_themes, migration 0225) and the per-user /themes view (users.settings.themesView — the existing
 * per-user settings JSONB of routes/users.ts). Every query is scoped to the owner's user id. Nothing is deleted.
 */
import { pool } from "@workspace/db";
import { normalizeView, type ScreenerSpec, type ThemesView } from "./personal";

export type PersonalRecord = {
  id: number;
  userId: number;
  name: string;
  kind: "tickers" | "screener";
  tickers: string[];
  screener: ScreenerSpec | null;
  resolvedTickers: string[];
  resolvedAt: number | null;
  active: boolean;
};

type Row = {
  id: number; user_id: number; name: string; kind: "tickers" | "screener"; tickers: string[] | null; filters: string[] | null;
  sort_order: string | null; resolved_tickers: string[] | null; resolved_at: Date | string | null; active: boolean;
};

const toRecord = (r: Row): PersonalRecord => ({
  id: Number(r.id),
  userId: Number(r.user_id),
  name: String(r.name),
  kind: r.kind,
  tickers: (r.tickers ?? []).map(String),
  screener: r.kind === "screener" ? { filters: (r.filters ?? []).map(String), order: r.sort_order ?? null } : null,
  resolvedTickers: (r.resolved_tickers ?? []).map(String),
  resolvedAt: r.resolved_at == null ? null : new Date(r.resolved_at).getTime(),
  active: !!r.active,
});

const COLS = "id, user_id, name, kind, tickers, filters, sort_order, resolved_tickers, resolved_at, active";

export async function listPersonal(userId: number): Promise<PersonalRecord[]> {
  const { rows } = await pool.query<Row>(`SELECT ${COLS} FROM user_themes WHERE user_id = $1 AND active ORDER BY id`, [userId]);
  return rows.map(toRecord);
}

export async function countPersonal(userId: number): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM user_themes WHERE user_id = $1 AND active`, [userId]);
  return Number(rows[0]?.n ?? 0);
}

export async function personalById(userId: number, id: number): Promise<PersonalRecord | null> {
  const { rows } = await pool.query<Row>(`SELECT ${COLS} FROM user_themes WHERE id = $1 AND user_id = $2`, [id, userId]);
  return rows[0] ? toRecord(rows[0]) : null;
}

export type PersonalInput = { name: string; kind: "tickers" | "screener"; tickers: string[]; screener: ScreenerSpec | null };

export async function insertPersonal(userId: number, input: PersonalInput): Promise<PersonalRecord> {
  const { rows } = await pool.query<Row>(
    `INSERT INTO user_themes (user_id, name, kind, tickers, filters, sort_order)
     VALUES ($1, $2, $3, $4::text[], $5::text[], $6) RETURNING ${COLS}`,
    [userId, input.name, input.kind, input.kind === "tickers" ? input.tickers : [], input.screener?.filters ?? [], input.screener?.order ?? null],
  );
  return toRecord(rows[0]!);
}

/** Full replace of the definition (a changed screener drops its resolved list), or archive with active false. */
export async function updatePersonal(userId: number, id: number, patch: Partial<PersonalInput> & { active?: boolean }, current: PersonalRecord): Promise<PersonalRecord | null> {
  const kind = patch.kind ?? current.kind;
  const tickers = kind === "tickers" ? (patch.tickers ?? current.tickers) : [];
  const screener = kind === "screener" ? (patch.screener ?? current.screener) : null;
  const screenerChanged = kind === "screener" && JSON.stringify(screener) !== JSON.stringify(current.screener);
  const { rows } = await pool.query<Row>(
    `UPDATE user_themes SET name = $3, kind = $4, tickers = $5::text[], filters = $6::text[], sort_order = $7,
       resolved_tickers = CASE WHEN $8 THEN '{}'::text[] ELSE resolved_tickers END,
       resolved_at = CASE WHEN $8 THEN NULL ELSE resolved_at END,
       active = $9, updated_at = now()
     WHERE id = $1 AND user_id = $2 RETURNING ${COLS}`,
    [id, userId, patch.name ?? current.name, kind, tickers, screener?.filters ?? [], screener?.order ?? null, screenerChanged || kind !== current.kind, patch.active ?? current.active],
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function saveResolved(id: number, tickers: string[], at: number): Promise<void> {
  await pool.query(`UPDATE user_themes SET resolved_tickers = $2::text[], resolved_at = $3 WHERE id = $1`, [id, tickers, new Date(at)]);
}

export async function readView(userId: number): Promise<ThemesView> {
  const { rows } = await pool.query<{ v: unknown }>(`SELECT settings->'themesView' AS v FROM users WHERE id = $1`, [userId]);
  return normalizeView(rows[0]?.v);
}

export async function writeView(userId: number, view: ThemesView): Promise<ThemesView> {
  const { rows } = await pool.query<{ v: unknown }>(
    `UPDATE users SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('themesView', $2::jsonb)
      WHERE id = $1 RETURNING settings->'themesView' AS v`,
    [userId, JSON.stringify(view)],
  );
  return normalizeView(rows[0]?.v);
}
