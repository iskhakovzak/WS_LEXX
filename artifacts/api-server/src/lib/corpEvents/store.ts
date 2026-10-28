/**
 * Corporate and index event calendar (table corp_events + corp_event_type_setups, migration 0285; rules in ./rules.ts).
 * One read merges four sources, newest code paths only, no network and no paid provider:
 *
 *   manual     corp_events rows an admin / curator added (desk data)
 *   rule       quad witching, S&P quarterly rebalance, MSCI reviews, Nasdaq-100 reconstitution (./rules ruleEvents)
 *   offerings  IPOs, pricings and offerings of the days the offerings page already stored (offering_ticker_cache
 *              kind watch_day) and the lock-up expiries they imply (IPO day + stated lock-up, else the desk default)
 *   news       «… to join / removed from the S&P 500 / 400 / 600» headlines of news_cache (the announcement day)
 *
 * Each type may point at a playbook setup (corp_event_type_setups). GET never writes; writes are staff only (route).
 */
import { pool } from "@workspace/db";
import { setting } from "../settings/registry";
import { addDays } from "../tradingDate";
import { reactionDay } from "../analystReaction";
import { normTicker } from "../catalyst/model";
import type { Queryable } from "../interventions/log";
import { lockupExpiry, offeringType, ruleEvents, spChangeOf, type CorpType, type IndexCode, type RuleEvent } from "./rules";

export type CorpSource = "manual" | "rule" | "offerings" | "news";
export type CorpEvent = {
  /** Stable key: m:<id> for a desk entry, else source:type:day:ticker|index. */
  key: string;
  id: number | null;
  day: string;
  type: CorpType;
  ticker: string | null;
  indexCode: IndexCode | null;
  source: CorpSource;
  /** Which rule produced it (rule rows only). */
  rule: RuleEvent["rule"] | null;
  /** The lock-up term was not in the data: the desk default was used. */
  estimated: boolean;
  /** Free text of a desk entry; the headline of a news row; the company of an offerings row. */
  note: string | null;
  setup: { id: number; name: string } | null;
  createdBy: string | null;
};

const keyOf = (e: Pick<CorpEvent, "source" | "type" | "day" | "ticker" | "indexCode">) => `${e.source}:${e.type}:${e.day}:${e.ticker ?? e.indexCode ?? ""}`;

async function closedDays(from: string, to: string, db: Queryable): Promise<Set<string>> {
  const { rows } = await db.query(
    `SELECT date::text AS d FROM holiday_calendar WHERE type = 'holiday' AND description ILIKE 'market closed%' AND date::text BETWEEN $1 AND $2`,
    [from, to],
  ).catch(() => ({ rows: [] as any[] }));
  return new Set(rows.map((r) => String(r.d)));
}

export async function typeSetups(db: Queryable = pool): Promise<Map<CorpType, { id: number; name: string }>> {
  const { rows } = await db.query(
    `SELECT s.type, p.id, p.name FROM corp_event_type_setups s JOIN playbook p ON p.id = s.playbook_id AND p.deleted_at IS NULL`,
  );
  return new Map(rows.map((r) => [r.type as CorpType, { id: Number(r.id), name: String(r.name) }]));
}

type OfferingLite = { ticker?: string; company?: string; type?: string; kind?: string; date?: string; status?: string; lockupDays?: number | null };

/** IPOs / pricings / offerings of [from, to] and the lock-ups of the IPOs before it (stored offerings days only). */
async function offeringEvents(from: string, to: string, closed: ReadonlySet<string>, db: Queryable): Promise<Omit<CorpEvent, "setup">[]> {
  const lockDefault = setting("catalyst.lockupDefaultDays");
  const back = addDays(from, -Math.max(lockDefault, 400));
  const { rows } = await db.query(
    `SELECT ticker AS day, payload FROM offering_ticker_cache WHERE kind = 'watch_day' AND ticker BETWEEN $1 AND $2 ORDER BY ticker`,
    [back, to],
  );
  const out = new Map<string, Omit<CorpEvent, "setup">>();
  const add = (e: Omit<CorpEvent, "setup" | "key">) => { const k = keyOf(e); if (!out.has(k)) out.set(k, { ...e, key: k }); };
  for (const r of rows) {
    const list: OfferingLite[] = Array.isArray(r.payload?.offerings) ? r.payload.offerings : [];
    for (const o of list) {
      const ticker = normTicker(o.ticker);
      const day = String(o.date ?? r.day).slice(0, 10);
      if (!ticker || !/^\d{4}-\d{2}-\d{2}$/.test(day) || o.status === "withdrawn") continue;
      const type = offeringType(o);
      if (day >= from && day <= to) add({ id: null, day, type, ticker, indexCode: null, source: "offerings", rule: null, estimated: false, note: o.company ?? null, createdBy: null });
      if (type === "ipo" && o.status !== "upcoming" && o.status !== "filed") {
        const lk = lockupExpiry(day, o.lockupDays ?? null, lockDefault, closed);
        if (lk.day >= from && lk.day <= to) add({ id: null, day: lk.day, type: "lockup_expiry", ticker, indexCode: null, source: "offerings", rule: null, estimated: lk.estimated, note: o.company ?? null, createdBy: null });
      }
    }
  }
  return [...out.values()];
}

/** S&P add / remove headlines (news_cache) whose reaction day is in [from, to]. */
async function newsEvents(from: string, to: string, db: Queryable): Promise<Omit<CorpEvent, "setup">[]> {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (UPPER(ticker), title) UPPER(ticker) AS ticker, title, published_at FROM news_cache
      WHERE published_at >= ($1::date - 3) AND published_at < ($2::date + 1) AND title ~* 'S&P\\s*(500|MidCap|SmallCap|400|600)'
      ORDER BY UPPER(ticker), title, published_at
      LIMIT 500`,
    [from, to],
  );
  const out = new Map<string, Omit<CorpEvent, "setup">>();
  for (const r of rows) {
    const ch = spChangeOf(String(r.title));
    const ticker = normTicker(r.ticker);
    if (!ch || !ticker || !r.published_at) continue;
    const day = reactionDay(new Date(r.published_at));
    if (day < from || day > to) continue;
    const e = { id: null, day, type: ch.type, ticker, indexCode: ch.indexCode, source: "news" as const, rule: null, estimated: false, note: String(r.title).slice(0, 300), createdBy: null };
    out.set(keyOf(e), { ...e, key: keyOf(e) });
  }
  return [...out.values()];
}

async function manualEvents(from: string, to: string, db: Queryable): Promise<Omit<CorpEvent, "setup">[]> {
  const { rows } = await db.query(
    `SELECT id, day, type, ticker, index_code, note, created_by FROM corp_events WHERE deleted_at IS NULL AND day BETWEEN $1 AND $2 ORDER BY day, id`,
    [from, to],
  );
  return rows.map((r) => ({
    key: `m:${r.id}`, id: Number(r.id), day: String(r.day), type: r.type as CorpType, ticker: r.ticker ?? null, indexCode: (r.index_code ?? null) as IndexCode | null,
    source: "manual" as const, rule: null, estimated: false, note: r.note ?? null, createdBy: r.created_by ?? null,
  }));
}

/**
 * The calendar of [from, to]: desk entries first, then rules, offerings and news; a derived row the desk already
 * entered by hand (same type, day and ticker / index) is dropped. Sorted by day.
 */
export async function corpCalendar(from: string, to: string, db: Queryable = pool): Promise<CorpEvent[]> {
  const closed = await closedDays(addDays(from, -7), addDays(to, 7), db);
  const [manual, offerings, news, setups] = await Promise.all([
    manualEvents(from, to, db), offeringEvents(from, to, closed, db), newsEvents(from, to, db), typeSetups(db),
  ]);
  const rules: Omit<CorpEvent, "setup">[] = ruleEvents(from, to, closed).map((r) => {
    const e = { id: null, day: r.day, type: r.type, ticker: null, indexCode: r.indexCode, source: "rule" as const, rule: r.rule, estimated: false, note: null, createdBy: null };
    return { ...e, key: `${keyOf(e)}:${r.rule}` };
  });
  const handTyped = new Set(manual.map((m) => `${m.type}:${m.day}:${m.ticker ?? m.indexCode ?? ""}`));
  const derived = [...rules, ...offerings, ...news].filter((e) => !handTyped.has(`${e.type}:${e.day}:${e.ticker ?? e.indexCode ?? ""}`));
  return [...manual, ...derived]
    .map((e) => ({ ...e, setup: setups.get(e.type) ?? null }))
    .sort((a, b) => a.day.localeCompare(b.day) || Number(a.source !== "manual") - Number(b.source !== "manual") || a.type.localeCompare(b.type));
}

export type CorpInput = { day: string; type: CorpType; ticker: string | null; indexCode: IndexCode | null; note: string | null };

export async function insertCorpEvent(x: CorpInput, by: string, db: Queryable = pool): Promise<number> {
  const { rows } = await db.query(
    `INSERT INTO corp_events (day, type, ticker, index_code, note, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [x.day, x.type, x.ticker, x.indexCode, x.note, by],
  );
  return Number(rows[0].id);
}

export async function updateCorpEvent(id: number, x: Partial<CorpInput>, db: Queryable = pool): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE corp_events SET day = COALESCE($2, day), type = COALESCE($3, type),
            ticker = CASE WHEN $7 THEN $4 ELSE ticker END, index_code = CASE WHEN $8 THEN $5 ELSE index_code END,
            note = CASE WHEN $9 THEN $6 ELSE note END, updated_at = now()
      WHERE id = $1 AND deleted_at IS NULL`,
    [id, x.day ?? null, x.type ?? null, x.ticker ?? null, x.indexCode ?? null, x.note ?? null, "ticker" in x, "indexCode" in x, "note" in x],
  );
  return (rowCount ?? 0) > 0;
}

export async function deleteCorpEvent(id: number, db: Queryable = pool): Promise<boolean> {
  const { rowCount } = await db.query(`UPDATE corp_events SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, [id]);
  return (rowCount ?? 0) > 0;
}

/** Sets (or clears, playbookId null) the setup an event type is traded with. */
export async function setTypeSetup(type: CorpType, playbookId: number | null, by: string, db: Queryable = pool): Promise<void> {
  if (playbookId == null) {
    await db.query(`DELETE FROM corp_event_type_setups WHERE type = $1`, [type]);
    return;
  }
  await db.query(
    `INSERT INTO corp_event_type_setups (type, playbook_id, updated_by) VALUES ($1, $2, $3)
     ON CONFLICT (type) DO UPDATE SET playbook_id = EXCLUDED.playbook_id, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [type, playbookId, by],
  );
}
