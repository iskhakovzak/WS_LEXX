/**
 * One errors store (Волна 2, item 2.8): `trading_errors` is the single source of a trader's mistakes.
 *
 * Before, a mistake lived in one of three places — key M on /trades (trades.tags), the journal's per-trade review
 * (eod_trade_reviews.mistakes) and «Правила → Ошибки» (trading_errors) — with two different word lists, and «Сколько
 * стоили мои ошибки» (GET /errors/summary) saw only the last one. Now:
 *  - one vocabulary (ERROR_VOCAB): a code, the canonical stored word, the default severity and the old spellings
 *    (aliases) — the same list as migration 0235 (a test compares them);
 *  - key M and the journal write trading_errors rows (source tag / journal) through `applyTradeErrorChange`; a mistake
 *    taken off there archives its rows (trading_errors_archive, restorable) — never a silent loss;
 *  - trades.tags and eod_trade_reviews.mistakes stay as display mirrors: a mistake added or removed in «Ошибки» for a
 *    trade is mirrored there too (`mirrorTradeMistake`), so every screen shows the same set;
 *  - one row per trade + code (a mistake already logged by hand is not logged again by M / the journal).
 * Custom mistakes typed by hand keep code NULL and are never touched by the markers.
 */
import { pool } from "@workspace/db";
import { logger } from "./logger";

export type ErrorVocabCode =
  | "fomo" | "offPlan" | "earlyEntry" | "movedStop" | "noStop" | "averagingDown" | "oversize" | "overtrading"
  | "revenge" | "earlyExit" | "heldLoser" | "ignoredNews" | "lateExit" | "offSetup";
export type ErrorSeverity = "low" | "medium" | "high" | "critical";
export type ErrorSource = "manual" | "tag" | "journal";

type VocabEntry = { code: ErrorVocabCode; canonical: string; severity: ErrorSeverity; aliases: readonly string[] };

// Stored words are data (what the tables keep, readable in CSV); the UI shows them by code in the reader's language.
export const ERROR_VOCAB: readonly VocabEntry[] = [
  { code: "fomo", canonical: "FOMO / погоня", severity: "medium", aliases: ["FOMO"] }, // i18n-ignore
  { code: "offPlan", canonical: "Вход не по плану", severity: "high", aliases: ["Без плана"] }, // i18n-ignore
  { code: "earlyEntry", canonical: "Ранний вход", severity: "medium", aliases: [] }, // i18n-ignore
  { code: "movedStop", canonical: "Сдвинул стоп", severity: "high", aliases: ["Двигал стоп"] }, // i18n-ignore
  { code: "noStop", canonical: "Без стопа", severity: "critical", aliases: [] }, // i18n-ignore
  { code: "averagingDown", canonical: "Усреднение убытка", severity: "critical", aliases: [] }, // i18n-ignore
  { code: "oversize", canonical: "Завышенный размер", severity: "high", aliases: ["Большой размер"] }, // i18n-ignore
  { code: "overtrading", canonical: "Переторговка", severity: "medium", aliases: ["Овертрейдинг"] }, // i18n-ignore
  { code: "revenge", canonical: "Отыгрыш после убытка", severity: "high", aliases: ["Реванш"] }, // i18n-ignore
  { code: "earlyExit", canonical: "Ранний выход из прибыли", severity: "low", aliases: ["Ранний выход"] }, // i18n-ignore
  { code: "heldLoser", canonical: "Пересидел убыток", severity: "high", aliases: [] }, // i18n-ignore
  { code: "ignoredNews", canonical: "Проигнорировал новости", severity: "medium", aliases: [] }, // i18n-ignore
  { code: "lateExit", canonical: "Поздний выход", severity: "medium", aliases: [] }, // i18n-ignore
  { code: "offSetup", canonical: "Не по сетапу", severity: "medium", aliases: [] }, // i18n-ignore
];

const BY_CODE = new Map(ERROR_VOCAB.map((v) => [v.code, v]));
const BY_SPELLING = new Map<string, VocabEntry>();
for (const v of ERROR_VOCAB) for (const w of [v.canonical, ...v.aliases]) BY_SPELLING.set(w.trim().toLowerCase(), v);

/** Code of a stored word (any spelling, case-insensitive); null = not a vocabulary mistake. */
export function errorCodeOf(value: string | null | undefined): ErrorVocabCode | null {
  if (typeof value !== "string") return null;
  return BY_SPELLING.get(value.trim().toLowerCase())?.code ?? null;
}

export function vocabEntry(code: ErrorVocabCode): VocabEntry {
  return BY_CODE.get(code)!;
}

/** Every (lower-case) spelling → code, as migration 0235 lists it. */
export function vocabSpellings(): [string, ErrorVocabCode][] {
  return [...BY_SPELLING.entries()].map(([w, v]) => [w, v.code]);
}

/** The comma list of trades.tags as words (trimmed, empty dropped). */
export function splitTagList(tags: string | null | undefined): string[] {
  return (tags ?? "").split(",").map((t) => t.trim()).filter(Boolean);
}

/** Vocabulary codes among words (tags or journal mistakes). */
export function codesOf(words: Iterable<string> | string | null | undefined): Set<ErrorVocabCode> {
  const list = typeof words === "string" || words == null ? splitTagList(words as string | null | undefined) : [...words];
  const out = new Set<ErrorVocabCode>();
  for (const w of list) {
    const c = errorCodeOf(w);
    if (c) out.add(c);
  }
  return out;
}

/** What changed between two marker states (pure). */
export function diffCodes(before: Iterable<ErrorVocabCode>, after: Iterable<ErrorVocabCode>): { added: ErrorVocabCode[]; removed: ErrorVocabCode[] } {
  const b = new Set(before);
  const a = new Set(after);
  return { added: [...a].filter((c) => !b.has(c)), removed: [...b].filter((c) => !a.has(c)) };
}

/** Words with `code` added (canonical word, when no spelling of it is there yet) or removed (every spelling). Pure. */
export function withCode(words: readonly string[], code: ErrorVocabCode, on: boolean): string[] {
  const has = words.some((w) => errorCodeOf(w) === code);
  if (on) return has ? [...words] : [...words, vocabEntry(code).canonical];
  return words.filter((w) => errorCodeOf(w) !== code);
}

/**
 * POST /trades/bulk add / removeTags on a comma list, mistake-aware: adding a mistake another spelling of which is there
 * changes nothing; removing one removes every spelling of it. Other tags match case-insensitively. Pure.
 */
export function bulkTags(cur: readonly string[], tags: readonly string[], action: "addTags" | "removeTags"): string[] {
  const same = (a: string, b: string) => {
    const ca = errorCodeOf(a);
    return ca ? ca === errorCodeOf(b) : a.toLowerCase() === b.toLowerCase();
  };
  if (action === "addTags") {
    const out = [...cur];
    for (const t of tags) if (!out.some((c) => same(c, t))) out.push(t);
    return out;
  }
  return cur.filter((c) => !tags.some((t) => same(c, t)));
}

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

/** Archive (restorable via POST /errors/:id/restore) and remove trading_errors rows. Returns how many went. */
export async function archiveErrorRows(q: Queryable, ids: readonly number[], actor: string | null): Promise<number> {
  if (!ids.length) return 0;
  const { rows } = await q.query(`SELECT * FROM trading_errors WHERE id = ANY($1::int[])`, [ids]);
  if (!rows.length) return 0;
  // One statement for every row; the payload is the row as node-postgres serialises an object parameter (JSON.stringify).
  await q.query(
    `INSERT INTO trading_errors_archive (original_id, trader, payload, archived_by)
     SELECT u.id, u.trader, u.payload, $4 FROM unnest($1::int[], $2::text[], $3::jsonb[]) WITH ORDINALITY AS u(id, trader, payload, ord) ORDER BY u.ord`,
    [rows.map((r) => r.id), rows.map((r) => r.trader), rows.map((r) => JSON.stringify(r)), actor],
  );
  const del = await q.query(`DELETE FROM trading_errors WHERE id = ANY($1::int[])`, [rows.map((r) => r.id)]);
  return del.rowCount ?? rows.length;
}

/**
 * Key M / the journal changed the mistakes of one trade: rows for the added codes (unless the trade already has one with
 * that code, from any source), the rows of the removed codes archived. The other marker is mirrored (tags ↔ journal).
 */
export async function applyTradeErrorChange(args: {
  trader: string; tradeId: number; ticker: string | null; added: readonly ErrorVocabCode[]; removed: readonly ErrorVocabCode[];
  source: Exclude<ErrorSource, "manual">; actor: string | null;
}): Promise<{ created: number; archived: number }> {
  const { trader, tradeId, ticker, added, removed, source, actor } = args;
  let created = 0;
  let archived = 0;
  for (const code of added) {
    const v = vocabEntry(code);
    const { rowCount } = await pool.query(
      `INSERT INTO trading_errors (trader, error_type, description, ticker, trade_id, severity, code, source)
       SELECT $1, $2, $2, $3, $4, $5, $6, $7
        WHERE NOT EXISTS (SELECT 1 FROM trading_errors WHERE trade_id = $4 AND code = $6)`,
      [trader, v.canonical, ticker, tradeId, v.severity, code, source],
    );
    created += rowCount ?? 0;
  }
  if (removed.length) {
    const { rows } = await pool.query(`SELECT id FROM trading_errors WHERE trade_id = $1 AND code = ANY($2::text[])`, [tradeId, removed]);
    archived = await archiveErrorRows(pool, rows.map((r) => Number(r.id)), actor);
  }
  const other = source === "tag" ? "journal" : "tags";
  for (const code of added) await mirrorTradeMistake(tradeId, code, true, other);
  for (const code of removed) await mirrorTradeMistake(tradeId, code, false, other);
  return { created, archived };
}

/**
 * Keep the display mirrors in step with trading_errors: trades.tags (the chips of /trades) and the trade's journal
 * review (eod_trade_reviews.mistakes — only when the trade already has a review; none is created here, so a mistake
 * never marks a trade «reviewed»). `only` limits the mirror to one of them.
 */
export async function mirrorTradeMistake(tradeId: number, code: ErrorVocabCode, on: boolean, only?: "tags" | "journal"): Promise<void> {
  try {
    if (only !== "journal") {
      const { rows } = await pool.query(`SELECT tags FROM trades WHERE id = $1`, [tradeId]);
      if (rows[0]) {
        const cur = splitTagList(rows[0].tags);
        const next = withCode(cur, code, on);
        if (next.join(", ") !== cur.join(", ")) {
          await pool.query(`UPDATE trades SET tags = $2 WHERE id = $1`, [tradeId, next.length ? next.join(", ") : null]);
          const [{ invalidateTradesPageCache }, { invalidateDashboardCache }] = await Promise.all([import("./tradesPageCache"), import("./hotCache")]);
          invalidateTradesPageCache();
          invalidateDashboardCache();
        }
      }
    }
    if (only !== "tags") {
      const { rows } = await pool.query(`SELECT mistakes FROM eod_trade_reviews WHERE trade_id = $1`, [tradeId]).catch(() => ({ rows: [] as any[] }));
      if (rows[0]) {
        const cur: string[] = Array.isArray(rows[0].mistakes) ? rows[0].mistakes : [];
        const next = withCode(cur, code, on);
        if (next.join("\u0001") !== cur.join("\u0001")) {
          await pool.query(`UPDATE eod_trade_reviews SET mistakes = $2::text[], updated_at = NOW() WHERE trade_id = $1`, [tradeId, next]);
        }
      }
    }
  } catch (err) {
    logger.warn({ err, tradeId, code }, "trading errors: mirror update failed");
  }
}

/**
 * For the marker routes (PATCH /trades/:id tags, POST /trades/bulk add/removeTags, PUT /eod/trades/:id/review): the
 * mistakes of `before` → `after` (words) into trading_errors. Never throws: a failed sync is logged, the write stands.
 */
export function syncMarkerErrors(
  base: Omit<Parameters<typeof applyTradeErrorChange>[0], "added" | "removed">,
  before: Iterable<string> | string | null | undefined,
  after: Iterable<string> | string | null | undefined,
): Promise<void> {
  const { added, removed } = diffCodes(codesOf(before), codesOf(after));
  const args = { ...base, added, removed };
  if (!args.added.length && !args.removed.length) return Promise.resolve();
  return applyTradeErrorChange(args).then(
    () => undefined,
    (err) => logger.warn({ err, tradeId: args.tradeId }, "trading errors: sync from a marker failed"),
  );
}

export type TagMarkerChange = { trader: string; tradeId: number; before: readonly string[]; after: readonly string[] };

/**
 * POST /trades/bulk add / removeTags: the key-M sync of many trades in a constant number of statements — the same end
 * state as `syncMarkerErrors(source "tag")` trade by trade (rows for the added codes unless the trade has one with that
 * code, the removed codes archived, the journal review mirrored; ticker NULL as the bulk route always passed).
 * Never throws: a failed sync is logged, the tag write stands.
 */
export async function syncTagMarkersBulk(changes: readonly TagMarkerChange[], actor: string | null): Promise<void> {
  const diffs = changes
    .map((c) => ({ ...c, ...diffCodes(codesOf(c.before), codesOf(c.after)) }))
    .filter((d) => d.added.length || d.removed.length);
  if (!diffs.length) return;
  try {
    const adds = diffs.flatMap((d) => d.added.map((code) => ({ d, code, v: vocabEntry(code) })));
    if (adds.length) {
      await pool.query(
        `INSERT INTO trading_errors (trader, error_type, description, ticker, trade_id, severity, code, source)
         SELECT u.trader, u.word, u.word, NULL, u.trade_id, u.severity, u.code, 'tag'
           FROM unnest($1::text[], $2::text[], $3::int[], $4::text[], $5::text[]) WITH ORDINALITY AS u(trader, word, trade_id, severity, code, ord)
          WHERE NOT EXISTS (SELECT 1 FROM trading_errors e WHERE e.trade_id = u.trade_id AND e.code = u.code)
          ORDER BY u.ord`,
        [adds.map((a) => a.d.trader), adds.map((a) => a.v.canonical), adds.map((a) => a.d.tradeId), adds.map((a) => a.v.severity), adds.map((a) => a.code)],
      );
    }
    const removes = diffs.flatMap((d) => d.removed.map((code) => ({ tradeId: d.tradeId, code })));
    if (removes.length) {
      const { rows } = await pool.query(
        `SELECT e.id FROM trading_errors e JOIN unnest($1::int[], $2::text[]) AS u(trade_id, code) ON e.trade_id = u.trade_id AND e.code = u.code`,
        [removes.map((r) => r.tradeId), removes.map((r) => r.code)],
      );
      await archiveErrorRows(pool, rows.map((r) => Number(r.id)), actor);
    }
  } catch (err) {
    logger.warn({ err, trades: diffs.map((d) => d.tradeId) }, "trading errors: bulk sync from tags failed");
    return;
  }
  // The other marker: the journal review of each trade that has one (mirrorTradeMistake(…, "journal") per code).
  try {
    const { rows } = await pool.query(`SELECT trade_id, mistakes FROM eod_trade_reviews WHERE trade_id = ANY($1::int[])`, [diffs.map((d) => d.tradeId)]);
    const byTrade = new Map(diffs.map((d) => [d.tradeId, d]));
    const ups: { tradeId: number; next: string[] }[] = [];
    for (const r of rows) {
      const d = byTrade.get(Number(r.trade_id));
      if (!d) continue;
      const cur: string[] = Array.isArray(r.mistakes) ? r.mistakes : [];
      let next = cur;
      for (const code of d.added) next = withCode(next, code, true);
      for (const code of d.removed) next = withCode(next, code, false);
      if (next.join("") !== cur.join("")) ups.push({ tradeId: d.tradeId, next });
    }
    if (ups.length) {
      await pool.query(
        `UPDATE eod_trade_reviews r SET mistakes = ARRAY(SELECT jsonb_array_elements_text(u.m)), updated_at = NOW()
           FROM unnest($1::int[], $2::jsonb[]) AS u(trade_id, m) WHERE r.trade_id = u.trade_id`,
        [ups.map((u) => u.tradeId), ups.map((u) => JSON.stringify(u.next))],
      );
    }
  } catch (err) {
    logger.warn({ err }, "trading errors: bulk journal mirror failed");
  }
}
