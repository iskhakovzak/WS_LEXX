/**
 * Авто-классификатор сетапов — предложения сетапа/контекста для сделок без сетапа (и не только).
 *
 *   GET  /api/setups-auto?trader=&from=&to=&budget=0&status=&withSetup=1&limit=300
 *        — сделки периода с предложением (ленивый расчёт недостающих, не больше `budget` за запрос, с очередью
 *          и задержкой между обращениями к рыночным данным); `pending` — сколько ещё не посчитано.
 *   GET  /api/setups-auto/aggregates?trader=&from=&to=  — агрегаты по сетапу (нетто $, win rate + интервал Уилсона,
 *          ожидание $ + бутстрап-интервал, PF, n, флаг small при n < 20) и матрицы сетап × час / сетап × время удержания.
 *          Сетап группы: принятый в сделку (accepted), иначе предложенный.
 *   POST /api/setups-auto/accept-bulk {tradeIds[≤500], minConfidence?} — принять пачку актуальных предложений одним UPDATE
 *          (доступ проверяется по каждому трейдеру; устаревшие/отклонённые/ниже порога — пропускаются).
 *   POST /api/setups-auto/:tradeId/accept {setup?, playbookId?} — записать сетап в сделку: playbook_id сетапа офиса, в
 *          который отображается класс (lib/tradesSetupLink CLASS_TO_OFFICE), и его имя в trades.setup (wave 1, 1.2);
 *          класс без сетапа (время / удержание) пишется только текстом. Пометить предложение принятым.
 *   GET  /api/setups-auto/setups                         — сетапы офиса для выбора (S на /trades, дневник): id, номер,
 *          имя, папка, locked (замок уровня зрителя).
 *   GET  /api/setups-auto/for-trades?ids=1,2             — предложения для видимых сделок без сетапа, уже с сетапом офиса
 *          (принять = один тап).
 *   POST /api/setups-auto/:tradeId/reject                — пометить предложение отклонённым (в сделку ничего не пишется).
 *   POST /api/setups-auto/:tradeId/recompute             — пересчитать предложение (свечи заново не качаются, если есть в кэше).
 *
 * В таблицу trades автоматически ничего не пишется — только по явному accept. Предложения для новых сделок считает
 * задача candles.archive после каждой синхронизации (lib/setupsAuto runAutoClassify). Предложения хранятся в
 * trade_setup_suggestions (создаётся идемпотентно), ключ trade_id + inputs_hash (меняется при правке сделки/версии правил).
 * Свечи — только через функции routes/candles.ts (кэш candles_cache; Yahoo не дёргается повторно).
 */
import { Router, type IRouter, type Request } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, pool, tradesTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { scopeTrader, canAccessTrade, isGuestUser } from "../lib/auth";
import { logActivity } from "../lib/activity";
import { logger } from "../lib/logger";
import { invalidateDashboardCache } from "../lib/hotCache";
import { invalidateTradesPageCache } from "../lib/tradesPageCache";
import { loadBehaviorRows, rowToBehaviorTrade } from "./behavior";
import { classifyFromFeatures, inputsHash, setupLabelOf, CLASSIFIER_VERSION, type SetupFeatures } from "../lib/setupClassifier";
import { computeBatch, ensureSuggestionsTable, inFlight, loadSuggestions, suggestionLink, toClassifierTrade, type SuggestionRow } from "../lib/setupsAuto";
import { loadOfficeSetups, resolveSetupLink, setupTagged, type OfficeSetup } from "../lib/tradesSetupLink";
import { setupsT } from "../lib/setupsI18n";
import { langOf, type Lang } from "../i18n";
import { hourBucketsFor, hourBucket, type BehaviorTrade } from "../lib/behaviorEngine";
import { bootstrapMean, wilson, round2, SMALL_SAMPLE } from "../lib/behaviorStats";
import { can } from "../lib/permissions";
import { lockedSetupIds } from "../lib/playbookLock";
import { AppError, badRequest, conflict, notFound, unauthorized } from "../lib/http";

const router: IRouter = Router();

const ensureTable = ensureSuggestionsTable;
ensureTable().catch((err) => logger.warn({ err }, "setups-auto: ensure table failed at init"));

/* ─── Вспомогательное ─────────────────────────────────────────────────────── */

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function normQuery(q: Request["query"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) {
    const s = Array.isArray(v) ? v[0] : v;
    if (typeof s === "string" && s.trim() !== "") out[k] = s;
  }
  return out;
}

export const listSchema = z.object({
  trader: z.string().trim().max(120).optional(),
  from: z.string().regex(YMD_RE).optional(),
  to: z.string().regex(YMD_RE).optional(),
  /** Сколько недостающих предложений посчитать за запрос. По умолчанию 0: простой GET только читает (DEV-10 — без
   *  этого GET без параметров считал 20 предложений и ходил за свечами, 2–2.5 с у куратора). «Посчитать всё» шлёт budget явно. */
  budget: z.coerce.number().int().min(0).max(50).default(0),
  status: z.enum(["suggested", "accepted", "rejected", "pending"]).optional(),
  /** 1 — включать сделки, у которых сетап уже заполнен (по умолчанию только без сетапа). */
  withSetup: z.enum(["0", "1"]).default("0"),
  limit: z.coerce.number().int().min(1).max(1000).default(300),
  offset: z.coerce.number().int().min(0).default(0),
});

const aggSchema = z.object({
  trader: z.string().trim().max(120).optional(),
  from: z.string().regex(YMD_RE).optional(),
  to: z.string().regex(YMD_RE).optional(),
  withSetup: z.enum(["0", "1"]).default("1"),
});

/**
 * Reasons / tags / note of a stored suggestion in the reader's language: re-derived from the stored features (pure, no
 * market data) when the classifier version and the result match; otherwise the stored Russian texts.
 */
function localizedExplanation(trade: BehaviorTrade, exit: number | null, s: SuggestionRow, lang: Lang) {
  const stored = {
    reasons: s.explanation?.reasons ?? [],
    alternatives: (s.explanation?.alternatives ?? []).map((a) => ({ ...a, label: setupLabelOf(a.setup, lang) })),
    tags: s.explanation?.tags ?? [],
    note: s.explanation?.note ?? null,
  };
  if (lang === "ru" || !s.features || s.version !== CLASSIFIER_VERSION) return stored;
  try {
    const re = classifyFromFeatures(toClassifierTrade(trade, exit), s.features as SetupFeatures, lang);
    if (re.setup !== s.setup) return stored;
    return { reasons: re.reasons, alternatives: re.alternatives, tags: re.tags, note: re.note };
  } catch {
    return stored;
  }
}

function serialize(trade: BehaviorTrade, exit: number | null, s: SuggestionRow | null, hash: string, lang: Lang, office: readonly OfficeSetup[] = []) {
  const fresh = s != null && s.inputs_hash === hash;
  const ex = s ? localizedExplanation(trade, exit, s, lang) : null;
  const link = suggestionLink(s, office);
  return {
    tradeId: trade.id,
    ticker: trade.ticker,
    date: trade.date,
    side: trade.side,
    entry: trade.entry,
    exit,
    qty: trade.qty,
    net: trade.net,
    result: trade.result,
    entryMin: trade.entryMin,
    holdMin: trade.holdMin,
    currentSetup: trade.setup,
    suggestion: s
      ? {
          setup: s.setup,
          setupLabel: setupLabelOf(s.setup, lang),
          /** The office setup accepting writes (null: a time-only class — accepting keeps it as text only). */
          playbookId: link?.id ?? null,
          playbookName: link?.name ?? null,
          confidence: Number(s.confidence),
          reasons: ex!.reasons,
          alternatives: ex!.alternatives,
          tags: ex!.tags,
          note: ex!.note,
          candlesAvailable: s.candles_available,
          interval: s.interval,
          status: fresh ? s.status : "stale",
          decidedBy: s.decided_by,
          decidedAt: s.decided_at,
          version: s.version,
        }
      : null,
  };
}

/* ─── GET /setups-auto ────────────────────────────────────────────────────── */

router.get("/setups-auto", asyncHandler(async (req, res) => {
  const parsed = listSchema.safeParse(normQuery(req.query));
  if (!parsed.success) throw badRequest("BAD_REQUEST", parsed.error.flatten());
  const q = parsed.data;
  const scope = await scopeTrader(req, q.trader);
  if (scope === undefined) throw unauthorized();
  await ensureTable();

  const rows = await loadBehaviorRows(scope, q.from, q.to);
  const all = rows
    .map((r) => ({ trade: rowToBehaviorTrade(r), exit: r.exit == null ? null : Number(r.exit) }))
    .filter((x) => x.trade.result !== "open")
    .filter((x) => q.withSetup === "1" || !x.trade.setup);
  const withHash = all.map((x) => ({ ...x, hash: inputsHash(toClassifierTrade(x.trade, x.exit)) }));
  let existing = await loadSuggestions(withHash.map((x) => x.trade.id));

  const missing = withHash.filter((x) => { const s = existing.get(x.trade.id); return !s || s.inputs_hash !== x.hash; });
  // Считаем недостающие: сначала самые свежие (у них точнее бары).
  missing.sort((a, b) => b.trade.date.localeCompare(a.trade.date) || b.trade.id - a.trade.id);
  let computed = 0;
  if (q.budget > 0 && missing.length) {
    computed = await computeBatch(missing, q.budget);
    if (computed) existing = await loadSuggestions(withHash.map((x) => x.trade.id));
  }
  const pending = withHash.filter((x) => { const s = existing.get(x.trade.id); return !s || s.inputs_hash !== x.hash; }).length;

  const lang = langOf(req);
  const office = await loadOfficeSetups().catch(() => [] as OfficeSetup[]);
  let items = withHash.map((x) => serialize(x.trade, x.exit, existing.get(x.trade.id) ?? null, x.hash, lang, office));
  if (q.status === "pending") items = items.filter((i) => !i.suggestion || i.suggestion.status === "stale");
  else if (q.status) items = items.filter((i) => i.suggestion?.status === q.status);
  // Новые сверху.
  items.sort((a, b) => b.date.localeCompare(a.date) || b.tradeId - a.tradeId);
  const total = items.length;
  items = items.slice(q.offset, q.offset + q.limit);

  res.json({
    scope, from: q.from ?? null, to: q.to ?? null,
    total, pending, computed, budget: q.budget, inFlight: inFlight.size,
    version: CLASSIFIER_VERSION,
    items,
    generatedAt: new Date().toISOString(),
  });
}));

/* ─── GET /setups-auto/aggregates ─────────────────────────────────────────── */

router.get("/setups-auto/aggregates", asyncHandler(async (req, res) => {
  const parsed = aggSchema.safeParse(normQuery(req.query));
  if (!parsed.success) throw badRequest("BAD_REQUEST", parsed.error.flatten());
  const q = parsed.data;
  const scope = await scopeTrader(req, q.trader);
  if (scope === undefined) throw unauthorized();
  await ensureTable();

  const rows = await loadBehaviorRows(scope, q.from, q.to);
  const trades = rows
    .map((r) => ({ trade: rowToBehaviorTrade(r), exit: r.exit == null ? null : Number(r.exit) }))
    .filter((x) => x.trade.result !== "open")
    .filter((x) => q.withSetup === "1" || !x.trade.setup);
  const existing = await loadSuggestions(trades.map((x) => x.trade.id));
  const lang = langOf(req);

  type Agg = { setup: string; n: number; wins: number; losses: number; be: number; net: number; nets: number[]; posNet: number; negNet: number; confSum: number; accepted: number };
  type Cell = { n: number; wins: number; losses: number; net: number };
  const groups = new Map<string, Agg>();
  const hourCells = new Map<string, Cell>();
  const holdCells = new Map<string, Cell>();
  const bump = (m: Map<string, Cell>, key: string, t: BehaviorTrade) => {
    const c = m.get(key) ?? { n: 0, wins: 0, losses: 0, net: 0 };
    c.n++;
    if (t.result === "win") c.wins++; else if (t.result === "loss") c.losses++;
    if (t.net != null) c.net += t.net;
    m.set(key, c);
  };
  let covered = 0;
  for (const x of trades) {
    const s = existing.get(x.trade.id);
    if (!s || s.inputs_hash !== inputsHash(toClassifierTrade(x.trade, x.exit))) continue;
    if (s.status === "rejected") continue;
    covered++;
    // Принятый сетап живёт в сделке (его могли поправить при принятии) — он и есть сетап группы.
    const setup = s.status === "accepted" && x.trade.setup ? x.trade.setup : s.setup;
    const g = groups.get(setup) ?? { setup, n: 0, wins: 0, losses: 0, be: 0, net: 0, nets: [], posNet: 0, negNet: 0, confSum: 0, accepted: 0 };
    g.n++;
    g.confSum += Number(s.confidence);
    if (s.status === "accepted") g.accepted++;
    const t = x.trade;
    if (t.result === "win") g.wins++; else if (t.result === "loss") g.losses++; else if (t.result === "be") g.be++;
    if (t.net != null) { g.net += t.net; g.nets.push(t.net); if (t.net > 0) g.posNet += t.net; else g.negNet += t.net; }
    groups.set(setup, g);
    if (t.entryMin != null) bump(hourCells, `${setup}\u0000${hourBucket(t.entryMin, lang)}`, t);
    const hb = holdBucket(t, lang);
    if (hb) bump(holdCells, `${setup}\u0000${hb}`, t);
  }
  const out = [...groups.values()].map((g) => {
    const decided = g.wins + g.losses;
    const ci = wilson(g.wins, decided);
    const eci = bootstrapMean(g.nets, `${scope ?? "*"}|${q.from ?? ""}|${q.to ?? ""}|${g.setup}`);
    return {
      setup: g.setup,
      setupLabel: setupLabelOf(g.setup, lang),
      n: g.n, wins: g.wins, losses: g.losses, be: g.be,
      winRate: decided ? g.wins / decided : null,
      winRateCI: ci ? { low: Math.round(ci.low * 10000) / 10000, high: Math.round(ci.high * 10000) / 10000 } : null,
      net: round2(g.net),
      expectancy: g.nets.length ? round2(g.net / g.nets.length) : null,
      expectancyCI: eci,
      profitFactor: g.negNet < 0 ? round2(g.posNet / Math.abs(g.negNet)) : null,
      avgConfidence: g.n ? round2(g.confSum / g.n) : null,
      accepted: g.accepted,
      small: g.n < SMALL_SAMPLE,
    };
  }).sort((a, b) => b.net - a.net);

  const shapeCells = (m: Map<string, Cell>) => [...m.entries()].map(([k, c]) => {
    const [setup, bucket] = k.split("\u0000");
    return {
      setup, setupLabel: setupLabelOf(setup, lang), bucket, n: c.n, net: round2(c.net),
      avg: c.n ? round2(c.net / c.n) : null,
      winRate: c.wins + c.losses ? c.wins / (c.wins + c.losses) : null,
    };
  });

  res.json({
    scope, from: q.from ?? null, to: q.to ?? null,
    trades: trades.length, covered, pending: trades.length - covered,
    smallSample: SMALL_SAMPLE,
    groups: out,
    matrix: {
      hour: { buckets: hourBucketsFor(lang), cells: shapeCells(hourCells) },
      hold: { buckets: holdBucketsFor(lang), cells: shapeCells(holdCells) },
    },
    generatedAt: new Date().toISOString(),
  });
}));

/** Hold-time buckets (codes → labels of the `setups.hold` dictionary; one response uses the labels as keys). */
const HOLD_CODES = ["lt1m", "m1to2", "m2to5", "m5to15", "m15to60", "h1to4", "h4plus", "carried"] as const;
type HoldCode = (typeof HOLD_CODES)[number];
const holdLabel = (code: HoldCode, lang: Lang) => setupsT.tryFor(lang, `hold.${code}`) ?? code;
const holdBucketsFor = (lang: Lang) => HOLD_CODES.map((c) => holdLabel(c, lang));
function holdBucket(t: BehaviorTrade, lang: Lang): string | null {
  if (t.horizon !== "intraday") return holdLabel("carried", lang);
  const m = t.holdMin;
  if (m == null || !Number.isFinite(m)) return null;
  const code: HoldCode = m < 1 ? "lt1m" : m < 2 ? "m1to2" : m < 5 ? "m2to5" : m < 15 ? "m5to15" : m < 60 ? "m15to60" : m < 240 ? "h1to4" : "h4plus";
  return holdLabel(code, lang);
}

/* ─── Setup tag = playbook setup (wave 1, 1.2): the picker list and one-tap suggestions ─── */

/** The office setups for the S picker / the journal: number, name, folder, and whether the viewer's tier locks it. */
router.get("/setups-auto/setups", asyncHandler(async (req, res) => {
  if (!req.authUser) throw unauthorized();
  const setups = await loadOfficeSetups();
  const locked = await lockedSetupIds(req, setups);
  res.json({ setups: setups.map((x) => ({ id: x.id, code: x.code, name: x.name, folder: x.folder, locked: locked.has(x.id) })) });
}));

const idsQuery = z.string().regex(/^\d+(,\d+){0,199}$/);

/**
 * Pending suggestions that map to an office setup, for trades the viewer may read (own; staff via trades.read.team):
 * { items: { [tradeId]: { playbookId, name, confidence } } } — the one-tap «принять» chip on /trades and in the journal.
 */
router.get("/setups-auto/for-trades", asyncHandler(async (req, res) => {
  const me = req.authUser;
  if (!me) throw unauthorized();
  const q = idsQuery.safeParse(String(req.query.ids ?? ""));
  if (!q.success) throw badRequest("INVALID_ID");
  await ensureTable();
  const ids = [...new Set(q.data.split(",").map(Number))];
  const { rows } = await pool.query<{ id: number; trader: string | null }>(
    `SELECT id, trader FROM trades WHERE id = ANY($1::int[]) AND deleted_at IS NULL AND playbook_id IS NULL`,
    [ids],
  );
  const readable = new Map<string | null, boolean>();
  for (const t of new Set(rows.map((r) => r.trader ?? null))) {
    readable.set(t, t === me.name || (await can(req, "trades.read.team", { trader: t })));
  }
  const open = rows.filter((r) => readable.get(r.trader ?? null)).map((r) => Number(r.id));
  const [sugg, office] = await Promise.all([loadSuggestions(open), loadOfficeSetups()]);
  const items: Record<number, { playbookId: number; name: string; confidence: number }> = {};
  for (const [tradeId, s] of sugg) {
    if (s.status !== "suggested") continue;
    const link = suggestionLink(s, office);
    if (link) items[tradeId] = { playbookId: link.id, name: link.name, confidence: Number(s.confidence) };
  }
  res.json({ items });
}));

/* ─── POST /setups-auto/accept-bulk ───────────────────────────────────────── */

const bulkBody = z.object({
  tradeIds: z.array(z.coerce.number().int().positive()).min(1).max(500),
  minConfidence: z.coerce.number().min(0).max(1).optional(),
});

router.post("/setups-auto/accept-bulk", asyncHandler(async (req, res) => {
  const body = bulkBody.safeParse(req.body ?? {});
  if (!body.success) throw badRequest("VALIDATION", body.error.flatten());
  const me = req.authUser;
  if (!me || isGuestUser(me)) throw new AppError("GUEST_READ_ONLY");
  await ensureTable();
  const ids = [...new Set(body.data.tradeIds)];
  const minConf = body.data.minConfidence ?? 0;

  const rows = await loadBehaviorRows(null, undefined, undefined, ids);
  // Доступ — как у canAccessTrade(write), но один раз на трейдера, а не на каждую сделку.
  const allowed = new Map<string, boolean>();
  for (const trader of new Set(rows.map((r) => r.trader ?? ""))) {
    const target = { trader: trader || null };
    const ok = (trader === me.name && (await can(req, "trades.write.own", target))) || (await can(req, "trades.write.any", target));
    allowed.set(trader, ok);
  }
  const existing = await loadSuggestions(rows.map((r) => Number(r.id)));
  const office = await loadOfficeSetups();
  const skipped = { forbidden: 0, missing: ids.length - rows.length, stale: 0, lowConfidence: 0, decided: 0 };
  const apply: { id: number; setup: string; playbookId: number | null; trader: string | null }[] = [];
  for (const r of rows) {
    if (!allowed.get(r.trader ?? "")) { skipped.forbidden++; continue; }
    const trade = rowToBehaviorTrade(r);
    const exit = r.exit == null ? null : Number(r.exit);
    const s = existing.get(trade.id);
    if (!s || s.inputs_hash !== inputsHash(toClassifierTrade(trade, exit))) { skipped.stale++; continue; }
    if (s.status !== "suggested") { skipped.decided++; continue; }
    if (Number(s.confidence) < minConf) { skipped.lowConfidence++; continue; }
    const link = suggestionLink(s, office);
    apply.push({ id: trade.id, setup: link?.name ?? s.setup, playbookId: link?.id ?? null, trader: r.trader ?? null });
  }
  if (!apply.length) { res.json({ ok: true, accepted: 0, skipped }); return; }

  // Тот же эффект, что у одиночного accept (playbook_id + имя сетапа), одним запросом.
  await pool.query(
    `UPDATE trades t SET setup = u.setup, playbook_id = u.pid FROM unnest($1::int[], $2::text[], $3::int[]) AS u(id, setup, pid)
      WHERE t.id = u.id AND t.deleted_at IS NULL`,
    [apply.map((a) => a.id), apply.map((a) => a.setup), apply.map((a) => a.playbookId)],
  );
  for (const trader of new Set(apply.map((a) => a.trader))) await setupTagged(apply.find((a) => a.trader === trader)!.id);
  await pool.query(
    `UPDATE trade_setup_suggestions SET status = 'accepted', decided_by = $2, decided_at = NOW(), updated_at = NOW()
      WHERE trade_id = ANY($1::int[]) AND status = 'suggested'`,
    [apply.map((a) => a.id), me.name],
  );
  const ru = setupsT.tFor("ru");
  const pct = Math.round(minConf * 100);
  logActivity({
    action: "updated", section: "trades", entityTitle: ru("activity.tradesCount", { count: apply.length }), trader: me.name,
    details: minConf ? ru("activity.bulkMin", { pct }) : ru("activity.bulk"),
    params: { titleKey: "setups.activity.tradesCount", count: apply.length, detailsKey: minConf ? "setups.activity.bulkMin" : "setups.activity.bulk", pct },
  });
  invalidateDashboardCache();
  invalidateTradesPageCache();
  res.json({ ok: true, accepted: apply.length, tradeIds: apply.map((a) => a.id), skipped });
}));

/* ─── POST accept / reject / recompute ───────────────────────────────────── */

const idParam = z.coerce.number().int().positive();
const acceptBody = z.object({
  setup: z.string().trim().min(1).max(200).optional(),
  /** An office (or own) setup chosen instead of the suggestion. */
  playbookId: z.coerce.number().int().positive().optional(),
});

router.post("/setups-auto/:tradeId/accept", asyncHandler(async (req, res) => {
  const id = idParam.safeParse(req.params.tradeId);
  if (!id.success) throw badRequest("INVALID_ID");
  const body = acceptBody.safeParse(req.body ?? {});
  if (!body.success) throw badRequest("VALIDATION", body.error.flatten());
  const access = await canAccessTrade(req, id.data, "write");
  if (access === null) throw notFound("TRADE_NOT_FOUND");
  if (!access) throw new AppError("TRADE_FORBIDDEN");
  await ensureTable();

  const current = (await loadSuggestions([id.data])).get(id.data) ?? null;
  if (!body.data.setup && body.data.playbookId == null && !current?.setup) throw conflict("SETUP_SUGGESTION_MISSING");
  const { rows: own } = await pool.query<{ trader: string | null }>(`SELECT trader FROM trades WHERE id = $1`, [id.data]);
  // Wave 1, 1.2: the playbook setup (chosen, named, or the class's office setup) + its name; a time-only class stays text.
  const mapped = suggestionLink(current, await loadOfficeSetups());
  const link = body.data.playbookId != null || body.data.setup
    ? await resolveSetupLink(body.data.playbookId != null ? { playbookId: body.data.playbookId } : { setup: body.data.setup }, own[0]?.trader ?? null)
    : mapped ? { playbookId: mapped.id, setup: mapped.name } : { playbookId: null, setup: current!.setup };
  const setup = link.setup ?? current?.setup ?? "";

  // Тот же механизм, что у PATCH /trades/:id для поля setup (drizzle update + активность + сброс кэша дашборда),
  // без чеклиста перед сделкой — сделки исторические.
  const [updated] = await db.update(tradesTable).set({ setup, playbookId: link.playbookId }).where(eq(tradesTable.id, id.data)).returning({ id: tradesTable.id, ticker: tradesTable.ticker, trader: tradesTable.trader });
  if (!updated) throw notFound("TRADE_NOT_FOUND");
  await pool.query(
    `UPDATE trade_setup_suggestions SET status = 'accepted', decided_by = $2, decided_at = NOW(), updated_at = NOW()
     WHERE trade_id = $1`,
    [id.data, req.authUser?.name ?? null],
  );
  logActivity({
    action: "updated", section: "trades", entityId: String(updated.id), entityTitle: updated.ticker ?? undefined,
    trader: req.authUser?.name,
    details: (body.data.playbookId != null || body.data.setup) && current && current.setup !== setup
      ? setupsT.tFor("ru")("activity.acceptedChanged", { setup, suggested: current.setup })
      : setupsT.tFor("ru")("activity.accepted", { setup }),
    params: (body.data.playbookId != null || body.data.setup) && current && current.setup !== setup
      ? { detailsKey: "setups.activity.acceptedChanged", setup, suggested: current.setup }
      : { detailsKey: "setups.activity.accepted", setup },
  });
  invalidateDashboardCache();
  invalidateTradesPageCache();
  await setupTagged(id.data);
  res.json({ ok: true, tradeId: id.data, setup, playbookId: link.playbookId, status: "accepted" });
}));

router.post("/setups-auto/:tradeId/reject", asyncHandler(async (req, res) => {
  const id = idParam.safeParse(req.params.tradeId);
  if (!id.success) throw badRequest("INVALID_ID");
  const access = await canAccessTrade(req, id.data, "write");
  if (access === null) throw notFound("TRADE_NOT_FOUND");
  if (!access) throw new AppError("TRADE_FORBIDDEN");
  await ensureTable();
  const { rowCount } = await pool.query(
    `UPDATE trade_setup_suggestions SET status = 'rejected', decided_by = $2, decided_at = NOW(), updated_at = NOW() WHERE trade_id = $1`,
    [id.data, req.authUser?.name ?? null],
  );
  if (!rowCount) throw conflict("SETUP_SUGGESTION_MISSING");
  res.json({ ok: true, tradeId: id.data, status: "rejected" });
}));

router.post("/setups-auto/:tradeId/recompute", asyncHandler(async (req, res) => {
  const id = idParam.safeParse(req.params.tradeId);
  if (!id.success) throw badRequest("INVALID_ID");
  const access = await canAccessTrade(req, id.data, "write");
  if (access === null) throw notFound("TRADE_NOT_FOUND");
  if (!access) throw new AppError("TRADE_FORBIDDEN");
  await ensureTable();
  const rows = await loadBehaviorRows(null, undefined, undefined, [id.data]);
  if (!rows[0]) throw notFound("TRADE_NOT_FOUND");
  const trade = rowToBehaviorTrade(rows[0]);
  const exit = rows[0].exit == null ? null : Number(rows[0].exit);
  const hash = inputsHash(toClassifierTrade(trade, exit));
  await pool.query(`DELETE FROM trade_setup_suggestions WHERE trade_id = $1 AND status = 'suggested'`, [id.data]);
  const done = await computeBatch([{ trade, exit, hash }], 1);
  const s = (await loadSuggestions([id.data])).get(id.data) ?? null;
  res.json({ ok: done > 0, item: serialize(trade, exit, s, hash, langOf(req), await loadOfficeSetups().catch(() => [])) });
}));

export default router;
