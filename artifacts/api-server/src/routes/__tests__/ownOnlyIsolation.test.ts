/**
 * Owner rule (2026-10-21): a regular member (role trader, any ladder stage) sees ONLY their own trades, day summaries
 * and statistics in every section; staff (curator / admin) keep the desk-wide views.
 *
 * Every GET route of the API (routes/index.ts, read from the live router) is called as a trader, first plainly
 * (baseline), then with foreign / desk parameters: ?trader= ?user= ?student= ?traders= ?name= ?userId= ?traderId=
 * ?scope=desk|team|all|group ?mode=desk ?view=desk ?all=1 ?desk=1 ?team=1 ?source=desk, and with path params naming
 * another trader (:trader, :name, ids that belong to another trader). The fake DB is ownership-aware:
 *   - a query whose parameters name another trader (or his id) answers rows owned by that trader;
 *   - a query whose parameters name the caller answers the caller's rows;
 *   - any other query on a table with an owner is desk-wide and answers one row per trader (caller first);
 *   - another trader's rows carry marker values (MARK_NUM / MARK_TXT), so anonymised rows (day aliases) count too.
 * A variant may answer 400 / 403 / 404 (refusal) or 2xx with the caller's own data (silent substitution). On 2xx:
 *   (a) no foreign trader name in the body,
 *   (b) no foreign trader name / id reached a SQL parameter,
 *   (c) the body equals the baseline (a desk / foreign switch changed nothing for a trader).
 * The baseline itself must pass (a). Community payloads where other members' names are legitimate are listed in
 * WHITELIST with a reason per entry (and `deny` keys that stay own-only inside them); nothing else may show another
 * trader.
 *
 * ISOLATION_DUMP=<file> writes every observation as JSON.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { writeFileSync } from "node:fs";
import type { AsyncLocalStorage } from "node:async_hooks";

const h = vi.hoisted(() => {
  process.env.LOG_LEVEL = process.env.ISO_LOG ? "error" : "silent";
  process.env.JWT_SECRET ??= "vitest-only-secret";
  const ME = { id: 5, name: "Trader T.", role: "trader" };
  const FOREIGN = [
    { id: 71, name: "Roman Foreignov", role: "trader" },
    { id: 72, name: "Olga Foreignova", role: "trader" },
  ];
  const USERS: Record<number, { id: number; name: string; role: string }> = {
    1: { id: 1, name: "Admin A.", role: "admin" },
    3: { id: 3, name: "Curator C.", role: "curator" },
    5: ME,
    71: FOREIGN[0]!,
    72: FOREIGN[1]!,
  };
  /** Trade / entity ids that belong to another trader (path variant). */
  const FOREIGN_ROW_ID = 4242;
  type Ctx = { hits: string[]; queries: string[] };
  type Store = { getStore(): Ctx | undefined };
  const g = globalThis as unknown as { __isoAls?: Store };

  /** Values only another trader's rows carry: a body holding one carries that trader's data, named or not. */
  const MARK_NUM = 7777;
  const MARK_TXT = "zzforeignzz";
  const OWNED_SQL = /\b(trader|traders|trader_name|user_id|author|owner|student|created_by|users)\b/i;
  const OWNER_COLUMNS = ["trader", "user_id", "author", "owner", "student", "created_by"];
  const OBJ_PROTO = new Set(Object.getOwnPropertyNames(Object.prototype));
  const DATE = "2026-10-16";
  const TS = "2026-10-16T14:30:00.000Z";

  /** A plausible value for a column of a fake row owned by `owner`. */
  const NUM = new Set(("pnl net gross fees fee qty count cnt total sum avg rate pct percent score price entry exit stop size limit risk "
    + "shares volume wins losses n r max min amount value points xp level rank streak days trades minutes seconds ms ratio factor "
    + "drawdown balance equity bp usd cents delta high low open close vwap mfe mae duration expectancy winrate num idx index weight "
    + "version threshold multiple r_multiple signed bytes position mean median std sharpe tier stage place order sort conviction rating").split(" "));
  const TEXT = new Set("status focus bonus class progress address basis analysis thesis alias canvas access notes details summary text body title".split(" "));
  const OBJ = new Set("data payload meta config settings snapshot params options extra json".split(" "));

  /** A plausible value for a column of a fake row owned by `owner` (pg shapes: timestamps are Dates, json is parsed). */
  function valueFor(key: string, owner: { id: number; name: string }, usersQuery: boolean, i: number): unknown {
    const foreign = owner.id !== ME.id;
    const n = foreign ? MARK_NUM : 1;
    const x = foreign ? MARK_TXT : "x";
    const k = key.toLowerCase();
    const tokens = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().split("_").filter(Boolean);
    const last = tokens[tokens.length - 1] ?? k;
    if (/^(trader|trader_name|tradername|owner|owner_name|student|student_name|user_name|username|author|author_name|authorname|created_by|createdby|display_name|full_name|login|member|actor|for_trader|target_trader|subject_trader)$/.test(k)) return owner.name;
    if (k === "name") return usersQuery ? owner.name : `Item ${foreign ? MARK_TXT : i + 1}`;
    if (/^(user_id|userid|trader_id|traderid|owner_id|ownerid|author_id|authorid|student_id|studentid|created_by_id)$/.test(k)) return owner.id;
    if (tokens[0] === "external" || tokens[0] === "broker") return "x";
    if (last === "id") return usersQuery && k === "id" ? owner.id : i + 1;
    if (last === "ids") return [i + 1];
    // Aggregated name lists (ARRAY_AGG(trader) AS traders …) carry the row owner, like a real group of his rows.
    if (/^(traders|trader_names|names|members|participants|authors|users|people|holders|reactors|readers)$/.test(k)) return [owner.name];
    if (k === "role") return "trader";
    if (k === "active" || k === "enabled") return true;
    if (k === "banned" || tokens[0] === "is" || tokens[0] === "has" || /^(deleted|archived|hidden|locked|closed|private|done|read|resolved)$/.test(k)) return false;
    if (k === "token_version") return 0;
    if (k === "locale" || k === "lang" || k === "language") return "ru";
    if (k === "side") return "Long";
    if (k === "result" || k === "res" || k === "outcome") return "win";
    if (last === "ticker" || last === "symbol") return "AAPL";
    if (last === "at") return new Date(TS);
    if (["date", "day", "from", "to", "until", "since", "week", "month"].includes(last)) return DATE;
    if (last === "time") return "09:30";
    if (["last", "first", "latest", "earliest", "newest", "oldest"].includes(k)) return new Date(TS);
    if (OBJ.has(last)) return {};
    if (k === "tags" || k === "best_tickers" || k === "besttickers" || k === "volume") return k === "volume" ? String(n) : x;
    if (TEXT.has(last)) return x;
    if (NUM.has(last)) return n;
    if (last.endsWith("s") && !/(ss|us|is|as)$/.test(last)) return [];
    if (tokens.some((t) => NUM.has(t))) return n;
    if (["ranking", "history", "list", "data_points"].includes(k)) return [];
    return x;
  }

  /** Own keys of a row (what a spread / JSON of it carries): the usual trade columns the SQL names. */
  const BASE_KEYS = ["id", "trader", "date", "ticker", "side", "result", "net_pnl", "pnl", "qty", "r"];
  /** SQL keywords / functions / prototype names that are never a column of the row. */
  const SQL_WORDS = new Set(("select from where and or not as on join left right inner outer full cross lateral case when then else end null is "
    + "in any all exists between like ilike distinct group by order having limit offset asc desc nulls first last union with values true false "
    + "coalesce nullif greatest least sum count avg min max abs round floor ceil upper lower trim substring position extract interval date_trunc "
    + "to_char now current_date filter over partition row_number bool_or bool_and array_agg string_agg json_agg jsonb_agg jsonb_build_object "
    + "text int integer numeric float bigint boolean timestamptz timestamp jsonb json varchar char double precision cast "
    + "constructor tostring valueof tojson hasownproperty").split(" "));
  function fakeRow(owner: { id: number; name: string }, usersQuery: boolean, i: number, rowId?: number, sqlWords?: Set<string>): Record<string, unknown> {
    const base: Record<string, unknown> = {};
    for (const k of sqlWords ?? BASE_KEYS) if (!SQL_WORDS.has(k.toLowerCase()) && k.length > 1) base[k] = valueFor(k, owner, usersQuery, i);
    if (usersQuery) Object.assign(base, { name: owner.name, role: "trader", active: true });
    if (rowId != null) base.id = rowId;
    return new Proxy(base, {
      get(t, k) {
        if (typeof k !== "string") return undefined;
        if (k in t) return t[k];
        if (OBJ_PROTO.has(k) || k === "then" || k === "toJSON") return (Object.prototype as Record<string, unknown>)[k];
        return valueFor(k, owner, usersQuery, i);
      },
    });
  }

  /** Every string / number reachable in `v` (SQL params, drizzle SQL chunks), bounded. */
  function scalars(v: unknown, out: Set<string>, seen = new Set<unknown>(), depth = 0): Set<string> {
    if (depth > 9 || out.size > 2000) return out;
    if (typeof v === "string") { out.add(v); return out; }
    if (typeof v === "number" || typeof v === "bigint") { out.add(String(v)); return out; }
    if (!v || typeof v !== "object" || seen.has(v)) return out;
    seen.add(v);
    if (Array.isArray(v)) { for (const x of v) scalars(x, out, seen, depth + 1); return out; }
    if (v instanceof Date) return out;
    for (const key of Object.keys(v)) {
      if (key === "table" || key === "config" || key === "columns" || key === "_" || key === "dialect" || key === "session") continue;
      try { scalars((v as Record<string, unknown>)[key], out, seen, depth + 1); } catch { /* getter */ }
    }
    return out;
  }

  /** Exact answers for shapes the generic rows cannot carry (names inside rendered text / aggregated arrays). */
  const special: Array<(text: string, values: unknown[]) => unknown[] | undefined> = [];

  function rowsFor(text: string, values: unknown[]): { rows: unknown[]; rowCount: number } {
    const ctx = g.__isoAls?.getStore();
    ctx?.queries.push(text.replace(/\s+/g, " ").slice(0, 160));
    if (/\bFROM\s+users\b/i.test(text) && /\bWHERE\s+(u\.)?id\s*=\s*\$1/i.test(text)) {
      const u = USERS[Number(values[0])];
      if (u) return { rows: [{ ...u, active: true, banned: false, locale: "ru", token_version: 0 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }
    if (/\b(role_permissions|app_settings)\b/i.test(text)) return { rows: [], rowCount: 0 };
    for (const answer of special) {
      const rows = answer(text, values);
      if (rows) return { rows, rowCount: rows.length };
    }
    if (/^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|BEGIN|COMMIT|ROLLBACK|SET|LISTEN|NOTIFY|SELECT\s+pg_)/i.test(text)) return { rows: [], rowCount: 0 };
    const flat = scalars(values, new Set());
    const usersQuery = /\busers\b/i.test(text);
    const idCols = /(user_id|trader_id|author_id|owner_id|student_id|\busers?\.id|\bu\.id|\bid\s*=\s*\$)/i.test(text);
    // The example-trade exception (a playbook example of another trader) is covered by playbookPermissions.test.ts;
    // here no example links the foreign trade.
    if (/\bplaybook_examples\b/i.test(text) && flat.has(String(FOREIGN_ROW_ID))) return { rows: [], rowCount: 0 };
    const strs = [...flat];
    // Columns the SQL names (and its quoted camelCase aliases) become own keys of the fake rows, like pg rows.
    const words = /^drizzle/.test(text) ? undefined : new Set([
      ...(text.match(/\b[a-z_][a-z0-9_]*\b/g) ?? []),
      ...[...text.matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"/g)].map((m) => m[1]!),
    ]);
    const own = strs.some((s) => s.includes(ME.name)) || (idCols && flat.has(String(ME.id)));
    // A foreign name always wins; a foreign id only when the query is not also pinned to the caller's name.
    const foreignHit = FOREIGN.find((f) => strs.some((s) => s.includes(f.name)))
      ?? (own ? undefined : FOREIGN.find((f) => idCols && flat.has(String(f.id))) ?? (flat.has(String(FOREIGN_ROW_ID)) ? FOREIGN[0] : undefined));
    if (foreignHit) {
      // Only the trader the request named counts as «requested»; a roster list (both foreign names) is desk-derived.
      const requested = strs.some((s) => s.includes(FOREIGN[0]!.name)) ? !strs.some((s) => s.includes(FOREIGN[1]!.name)) : true;
      if (requested) ctx?.hits.push(`${foreignHit.name} in: ${text.replace(/\s+/g, " ").slice(0, 120)}`);
      return { rows: [fakeRow(foreignHit, usersQuery, 0, flat.has(String(FOREIGN_ROW_ID)) ? FOREIGN_ROW_ID : undefined, words)], rowCount: 1 };
    }
    // Only tables that carry an owner are desk-wide: market data, holidays, catalogues answer one neutral row.
    const owned = OWNED_SQL.test(text) || OWNER_COLUMNS.some((c) => flat.has(c));
    const owners = own || !owned ? [ME] : [ME, ...FOREIGN];
    const rows = owners.map((o, i) => fakeRow(o, usersQuery, i, undefined, words));
    return { rows, rowCount: rows.length };
  }

  return { ME, FOREIGN, USERS, FOREIGN_ROW_ID, MARK_NUM, MARK_TXT, TS, rowsFor, special };
});

vi.mock("@workspace/db", async () => {
  const schema = await import("@workspace/db/schema");
  const { AsyncLocalStorage: Als } = await import("node:async_hooks");
  (globalThis as unknown as { __isoAls?: unknown }).__isoAls ??= new Als();
  const answer = async (q: unknown, params?: unknown[]) => {
    const text = typeof q === "string" ? q : String((q as { text?: string } | null)?.text ?? "");
    const values = Array.isArray(params) ? params : ((q as { values?: unknown[] } | null)?.values ?? []);
    return h.rowsFor(text, values);
  };
  // Drizzle chains: the arguments of the whole chain stand in for the SQL parameters.
  const chain = (args: unknown[]): unknown => {
    const p: unknown = new Proxy(function () {}, {
      get: (_t, k) => {
        if (k === "then") {
          return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
            Promise.resolve().then(() => h.rowsFor("drizzle select", args).rows).then(ok, ko);
        }
        return (...more: unknown[]) => chain([...args, ...more]);
      },
      apply: (_t, _this, more: unknown[]) => chain([...args, ...more]),
    });
    return p;
  };
  const db: unknown = new Proxy({}, {
    get: (_t, k) => {
      if (k === "transaction") return async (fn: (tx: unknown) => unknown) => fn(db);
      if (k === "execute") return async (q: unknown) => h.rowsFor("drizzle execute", [q]);
      if (k === "insert" || k === "update" || k === "delete") return () => chainEmpty();
      return (...args: unknown[]) => chain(args);
    },
  });
  const chainEmpty = (): unknown => {
    const p: unknown = new Proxy(function () {}, {
      get: (_t, k) => (k === "then" ? (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve([]).then(ok, ko) : () => p),
      apply: () => p,
    });
    return p;
  };
  const client = { query: vi.fn(answer), release: vi.fn() };
  return {
    ...schema,
    db,
    pool: { query: vi.fn(answer), connect: vi.fn(async () => client), end: vi.fn(async () => undefined), on: vi.fn() },
    setPoolErrorHandler: vi.fn(),
    poolConfig: vi.fn(() => ({})),
    createPool: vi.fn(),
  };
});
vi.mock("express-rate-limit", () => {
  const pass = () => (_req: unknown, _res: unknown, next: () => void) => next();
  return { default: pass, rateLimit: pass, ipKeyGenerator: (ip: string) => ip };
});
vi.mock("../../lib/marketDataService", async (orig) => {
  const zero = async () => ({ rowsInserted: 0, inserted: 0, durationMs: 0, scanned: 0, tickersWithData: 0, rowsTotal: 0 });
  return {
    ...(await orig<Record<string, unknown>>()),
    scanWatchlistAnalystActions: zero, scanNewsForAnalystActions: zero, scanSeekingAlphaForAnalystActions: zero,
    scanNasdaqAnalystActions: zero, scanGeneralFinanceFeedsForAnalystActions: zero, getDynamicAnalystTickers: async () => [],
  };
});

const realFetch = globalThis.fetch;
vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })));

type Allow = "others" | "params" | "differs";
/** `deny`: JSON keys of the body that must never carry another trader's name or value, even where "others" is allowed. */
type Entry = { allow: readonly Allow[]; reason: string; deny?: readonly string[] };

/**
 * Community payloads: other members' names (or desk-wide reads) are legitimate here. One reason per entry.
 * "others"  — other members' names / values may appear in the body;
 * "params"  — the route may look another member up (by name / id) in SQL;
 * "differs" — a desk / foreign switch may change the answer (the answer still holds no foreign trader data).
 */
const O: readonly Allow[] = ["others"];
const WHITELIST: Record<string, Entry> = {
  // Market / content logs any member writes: author name + market facts, never a trade or a result.
  "GET /events": { allow: O, reason: "desk market-event log: author name and market facts, no trades" },
  "GET /events/today": { allow: O, reason: "desk market-event log of the day: author name and market facts" },
  "GET /events/holding": { allow: O, reason: "catalysts (desk market events) next to the caller's own held positions" },
  "GET /events/:id": { allow: O, reason: "one desk market event by id: author name and market facts" },
  "GET /big7levels": { allow: O, reason: "Big-7 levels board: market levels any member posts (author name)" },
  "GET /big7/catalysts": { allow: O, reason: "Big-7 catalysts board: market catalysts with their author" },
  "GET /big7/tickers": { allow: O, reason: "Big-7 ticker cards: shared market notes with their author" },
  "GET /dailyfeed": { allow: O, deny: ["notes"], reason: "desk briefing posts (market commentary, author); EOD per-trader notes are staff-only" },
  "GET /dailyfeed/:id": { allow: O, deny: ["notes"], reason: "one desk briefing post; EOD per-trader notes are staff-only" },
  "GET /game-plan/history": { allow: O, reason: "desk morning plan history: plan author (curator) and market view" },
  "GET /watchlist": { allow: O, deny: ["openTraders", "openPositions", "openTradeIds"], reason: "desk watchlist rows with their author; open positions are own-only" },
  // Discussions, ideas, playbook: community content (thread text, authors, reactions); trades in them are stripped.
  "GET /discussions/audience": { allow: O, reason: "audience picker of a thread: member and group names only" },
  "GET /discussions/ticker-context/:ticker": { allow: O, reason: "ticker thread header: desk ideas and watchlist rows with authors; desk $ gated" },
  "GET /trades/:id/reactions": { allow: O, reason: "emoji reactions on the caller's trade: who reacted (names only)" },
  "GET /trade-ideas": { allow: ["others", "params", "differs"], reason: "published trade ideas are community content; ?trader= filters by author" },
  "GET /trade-ideas/:id/comments": { allow: O, reason: "comments under a published idea: author names and text" },
  "GET /playbook/:id/revisions": { allow: O, reason: "setup edit history: who edited the shared setup" },
  "GET /playbook/:id/activity": { allow: O, reason: "setup activity log: who did what with the shared setup" },
  "GET /playbook/:id/examples": { allow: O, reason: "curated playbook examples: teaching charts with other traders' $ / size redacted" },
  "GET /playbook-tools/gallery": { allow: ["others", "params", "differs"], reason: "playbook examples gallery (curated, $ redacted); ?trader= narrows by owner" },
  "GET /setups-auto/setups": { allow: O, reason: "catalogue of desk setups (names / folders), no trades" },
  // People and community rankings the owner kept (own row + others without $ / trades).
  "GET /users": { allow: O, reason: "member directory: names, roles, Latin alias (no data)" },
  "GET /users/all": { allow: O, reason: "member directory incl. inactive: names, roles (no data)" },
  "GET /academy/cohorts/:id": { allow: O, reason: "a student's own cohort roster: classmates' names and stage; attendance and notes own-only" },
  "GET /academy/content/programs/:id": { allow: O, reason: "academy program tree authored by curators (content), progress own-only" },
  "GET /sim/leaderboard": { allow: O, reason: "simulator game leaderboard: replay results, not real trades" },
  "GET /trainer/home": { allow: O, reason: "trainer daily game ranking: simulator replay results, not real trades" },
  "GET /trainer/daily": { allow: O, reason: "trainer daily game ranking: simulator replay results, not real trades" },
  "GET /top/day/:date": { allow: O, deny: ["tickers", "bestTicker"], reason: "top of the day: others' R / win % / counts without $ or tickers" },
  "GET /benchmark": { allow: O, deny: ["rows"], reason: "desk median line (k >= 3) as a benchmark; per-trader rows own-only" },
};

const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g;
const normalize = (s: string) => s.replace(ISO, "<ts>").replace(/"(generatedAt|now|asOf|updatedAt|serverTime|tookMs|durationMs|ms|elapsedMs|cachedAt|computedAt)":[^,}]+/g, '"$1":0');

type Obs = { status: number; body: string; hits: string[]; queries: string[] };
type Variant = { label: string; set?: Record<string, string>; foreignPath?: boolean };
const F0 = h.FOREIGN[0]!;
const VARIANTS: readonly Variant[] = [
  { label: "trader", set: { trader: F0.name } },
  { label: "user", set: { user: F0.name } },
  { label: "student", set: { student: F0.name } },
  { label: "traders", set: { traders: F0.name } },
  { label: "name", set: { name: F0.name } },
  { label: "userId", set: { userId: String(F0.id) } },
  { label: "traderId", set: { traderId: String(F0.id) } },
  { label: "userId=name", set: { userId: F0.name } },
  { label: "scope=desk", set: { scope: "desk" } },
  { label: "scope=team", set: { scope: "team" } },
  { label: "scope=all", set: { scope: "all" } },
  { label: "scope=group", set: { scope: "group" } },
  { label: "mode=desk", set: { mode: "desk" } },
  { label: "view=desk", set: { view: "desk" } },
  { label: "all=1", set: { all: "1" } },
  { label: "desk=1", set: { desk: "1" } },
  { label: "team=1", set: { team: "1" } },
  { label: "source=desk", set: { source: "desk" } },
  { label: "foreign path", foreignPath: true },
];

/** Not JSON reads: the cron heartbeat (Bearer secret), file downloads, audio bytes. */
const SKIP = /^\/cron\/|\/download$|\/audio$/;
/** Neutral parameters every call carries (a day, a range, a ticker), so routes that need them get past validation. */
const NEUTRAL: Record<string, string> = {
  date: "2026-10-16", from: "2026-10-01", to: "2026-10-16", month: "2026-10", week: "2026-10-12",
  ticker: "AAPL", symbol: "AAPL", tickers: "AAPL", symbols: "AAPL", tradeIds: "42", ids: "42", preset: "gappers",
  trader: h.ME.name, traders: h.ME.name, userId: h.ME.name, kind: "max_trades",
};
const qs = (params: Record<string, string>) => new URLSearchParams({ probe: "1", ...params }).toString();
const FOREIGN_NAMES = h.FOREIGN.map((f) => f.name);
/** Another trader's name, or a value only his rows carry (anonymised rows: day aliases). */
const MARK_NUM_RE = new RegExp(`(^|[^0-9.])${h.MARK_NUM}(?![0-9])`);
const foreignIn = (body: string): string[] => [
  ...FOREIGN_NAMES.filter((n) => body.includes(n)),
  ...(body.includes(h.MARK_TXT) || MARK_NUM_RE.test(body) ? ["foreign row data"] : []),
];
/** Foreign data under the denied keys of a whitelisted body (any depth). */
function deniedIn(body: string, deny: readonly string[] | undefined): string[] {
  if (!deny?.length) return [];
  let json: unknown;
  try { json = JSON.parse(body); } catch { return []; }
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (deny.includes(k) && foreignIn(JSON.stringify(x) ?? "").length) out.push(k);
      walk(x);
    }
  };
  walk(json);
  return [...new Set(out)];
}

function pathFor(pattern: string, foreign: boolean): string {
  const who = foreign ? h.FOREIGN[0]!.name : h.ME.name;
  return pattern
    .replace(/[{}]/g, "")
    .replace(/\*(\w+)/g, "x")
    .replace(/:(\w+)/g, (_m, p: string) => {
      if (/^(trader|name|student|user)$/i.test(p)) return encodeURIComponent(who);
      if (p === "alias") return "1";
      if (/date$/i.test(p)) return "2026-10-16";
      if (/^(ticker|symbol)$/i.test(p)) return "AAPL";
      if (/id$/i.test(p)) return foreign ? String(h.FOREIGN_ROW_ID) : "42";
      return "x";
    });
}

// Shapes the generic rows cannot carry. The EOD recap of the daily feed names every trader in its rendered notes;
// the watchlist's open positions aggregate trader names per ticker (and must honour the owner filter, $2).
h.special.push((text) => (/\bFROM daily_feed\b/i.test(text) ? [
  { id: 1, date: "2026-10-16", what_works_now: "x", what_doesnt_work: null, best_tickers: "AAPL", market_theme: "x", notes: "x", tags: null,
    screenshot_url: null, screenshot_notes: null, created_at: new Date(h.TS), deleted_at: null, created_by: h.ME.name },
  { id: 2, date: "2026-10-16", what_works_now: "x", what_doesnt_work: null, best_tickers: "AAPL", market_theme: "x",
    notes: `${F0.name}: 3 trades, +$500`, tags: "eod", screenshot_url: null, screenshot_notes: null, created_at: new Date(h.TS), deleted_at: null, created_by: "Curator C." },
] : undefined));
h.special.push((text, values) => {
  if (!/ARRAY_AGG\(DISTINCT trader\)/i.test(text) || !/'open'/.test(text)) return undefined;
  const only = typeof values[1] === "string" ? values[1] : null;
  const owners = [h.ME.name, F0.name].filter((n) => only == null || n === only);
  return owners.length ? [{ t: "AAPL", c: String(owners.length), traders: owners, ids: owners.map((_n, i) => i + 1) }] : [];
});

const { collectRoutes } = await import("./routeMatrix/harness");
const { default: apiRouter } = await import("../index");

type Result = { key: string; variant: string; status: number; problems: string[]; note?: string };
const results: Result[] = [];
let server: import("node:http").Server;
let call: (path: string) => Promise<Obs>;

beforeAll(async () => {
  const [express, http, { apiAuthGate }, { requestLang }, { errorMiddleware }] = await Promise.all([
    import("express").then((m) => m.default), import("node:http"),
    import("../../lib/auth"), import("../../i18n"), import("../../lib/http"),
  ]);
  const als = (globalThis as unknown as { __isoAls: AsyncLocalStorage<{ hits: string[]; queries: string[] }> }).__isoAls;
  const ctxById = new Map<string, { hits: string[]; queries: string[] }>();
  const app = express();
  app.use("/api", (req, _res, next) => {
    req.authUser = { id: h.ME.id, name: h.ME.name, role: h.ME.role };
    const ctx = { hits: [] as string[], queries: [] as string[] };
    ctxById.set(String(req.get("x-iso-id") ?? ""), ctx);
    als.run(ctx, next);
  });
  app.use("/api", apiAuthGate, requestLang, express.json({ limit: "1mb" }), apiRouter);
  app.use(errorMiddleware);
  server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const port = (server.address() as import("node:net").AddressInfo).port;
  const agent = new http.Agent({ keepAlive: true, maxSockets: 8 });
  let seq = 0;
  call = (path) => new Promise((resolve) => {
    const id = String(++seq);
    const done = (status: number, body: string) => {
      const ctx = ctxById.get(id);
      ctxById.delete(id);
      resolve({ status, body, hits: ctx?.hits ?? [], queries: ctx?.queries ?? [] });
    };
    const req = http.request({ host: "127.0.0.1", port, agent, method: "GET", path: `/api${path}`, headers: { "x-iso-id": id }, timeout: 6_000 }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => { text += c; });
      res.on("end", () => done(res.statusCode ?? 0, text));
    });
    req.on("timeout", () => { req.destroy(); done(0, ""); });
    req.on("error", () => done(0, ""));
    req.end();
  });

  const routes = collectRoutes(apiRouter as unknown as Parameters<typeof collectRoutes>[0]).filter((r) => r.method === "GET" && !SKIP.test(r.path));
  const seen = new Set<string>();
  for (const r of routes) {
    const key = `GET ${r.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const allow = new Set<Allow>(WHITELIST[key]?.allow ?? []);
    // Plain first; a route that needs a day / range / ticker / own trader (400) is driven with NEUTRAL from then on.
    let params: Record<string, string> = {};
    let base1 = await run(`${pathFor(r.path, false)}?${qs(params)}`);
    if (base1.status === 400) {
      params = NEUTRAL;
      base1 = await run(`${pathFor(r.path, false)}?${qs(params)}`);
    }
    const basePath = `${pathFor(r.path, false)}?${qs(params)}`;
    const base2 = await run(basePath);
    const stable = normalize(base1.body) === normalize(base2.body);
    const baseProblems: string[] = [];
    if (base1.status >= 200 && base1.status < 300) {
      const leaked = allow.has("others") ? [] : foreignIn(base1.body);
      if (leaked.length) baseProblems.push(`baseline body names ${leaked.join(", ")}`);
      const denied = deniedIn(base1.body, WHITELIST[key]?.deny);
      if (denied.length) baseProblems.push(`baseline: another trader under ${denied.join(", ")}`);
    }
    results.push({ key, variant: "baseline", status: base1.status, problems: baseProblems, note: process.env.ISOLATION_DUMP ? base1.body.slice(0, 20_000) : undefined });
    const hasPathParam = /:(\w+)/.test(r.path);
    for (const v of VARIANTS) {
      if (v.foreignPath && !hasPathParam) continue;
      const path = v.foreignPath ? `${pathFor(r.path, true)}?${qs(params)}` : `${pathFor(r.path, false)}?${qs({ ...params, ...v.set })}`;
      const o = await run(path);
      const problems: string[] = [];
      if (o.status >= 200 && o.status < 300) {
        if (!allow.has("others")) {
          const leaked = foreignIn(o.body);
          if (leaked.length) problems.push(`body names ${leaked.join(", ")}`);
        }
        const denied = deniedIn(o.body, WHITELIST[key]?.deny);
        if (denied.length) problems.push(`another trader under ${denied.join(", ")}`);
        // Reading the addressed row to check its owner is how a by-id route refuses; only the body counts there.
        if (!allow.has("params") && !v.foreignPath && o.hits.length) problems.push(`SQL read another trader: ${o.hits[0]}`);
        // A desk / foreign switch that ADDS to the answer (a filter that drops the foreign name answers less).
        const grown = normalize(o.body).length > normalize(base1.body).length;
        if (!allow.has("differs") && stable && !v.foreignPath && base1.status === o.status && grown && normalize(o.body) !== normalize(base1.body)) {
          problems.push("answer differs from the own baseline");
        }
      }
      results.push({ key, variant: v.label, status: o.status, problems });
    }
  }
  if (process.env.ISOLATION_DUMP) writeFileSync(process.env.ISOLATION_DUMP, JSON.stringify(results, null, 1));
}, 300_000);

const run = (path: string): Promise<Obs> => call(path);

afterAll(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  vi.stubGlobal("fetch", realFetch);
});

describe("own-only isolation: a trader never reads another trader's data (every GET route)", () => {
  it("drives the API's GET routes", () => {
    expect(new Set(results.map((r) => r.key)).size).toBeGreaterThan(200);
    // The fake DB must let most routes answer: a harness where everything fails proves nothing.
    expect(results.filter((r) => r.variant === "baseline" && r.status === 200).length).toBeGreaterThan(120);
  });

  it("no foreign trader name, foreign SQL read or desk switch reaches a trader (outside WHITELIST)", () => {
    const problems = results.filter((r) => r.problems.length).map((r) => `${r.key} [${r.variant}] ${r.status}: ${r.problems.join("; ")}`);
    expect(problems).toEqual([]);
  });

  it("WHITELIST names only existing GET routes, each with a one-line reason", () => {
    const keys = new Set(results.map((r) => r.key));
    expect(Object.keys(WHITELIST).filter((k) => !keys.has(k))).toEqual([]);
    expect(Object.entries(WHITELIST).filter(([, e]) => e.reason.length < 12 || /\n/.test(e.reason)).map(([k]) => k)).toEqual([]);
  });
});

