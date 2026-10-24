/**
 * «Ассистент WS» — tool execution. Every input is validated (toolDefs zod) before anything runs; data tools read
 * through the app's own API as the caller (internalApi — same routes, same permission helpers as the screens),
 * large answers are summarised here (only what a question needs, never raw tables) and capped (toolData.capJson),
 * and every result reaches the model wrapped as untrusted data (toolData.wrapToolData). Draft tools return a card and
 * write nothing (drafts.ts). search_help reads the static site map.
 */
import type { Request } from "express";
import { pool } from "@workspace/db";
import type { Lang } from "../../i18n";
import { can } from "../permissions";
import { readSnapshot } from "../finviz/read";
import { apiGet, apiPostReadOnly, type ApiCaller, type ApiResult } from "./internalApi";
import { TOOL_BY_NAME, type ToolKind } from "./toolDefs";
import { buildDraft, draftToolResult, type Draft } from "./drafts";
import { capJson, wrapToolData, zipBucket } from "./toolData";
import { searchHelp } from "./helpIndex";

export type ToolContext = {
  api: ApiCaller;
  req: Request;
  lang: Lang;
  actor: { name: string; staff: boolean; admin: boolean };
  today: string;
};

export type ToolOutcome = { kind: ToolKind | "unknown"; content: string; isError: boolean; code?: string; draft?: Draft };

const err = (tool: string, code: string, message: string, kind: ToolOutcome["kind"] = "data"): ToolOutcome =>
  ({ kind, isError: true, code, content: wrapToolData(tool, JSON.stringify({ error: code, message }), { error: true }) });

const ok = (tool: string, kind: ToolKind, data: unknown): ToolOutcome => ({ kind, isError: false, content: wrapToolData(tool, capJson(data)) });

function fromApi(tool: string, r: ApiResult, shape: (d: any) => unknown): ToolOutcome {
  if (!r.ok) {
    const message = r.status === 403 ? "forbidden for this user (the same screen would refuse it)" : r.message || `request failed (${r.status})`;
    return err(tool, r.code, message);
  }
  return ok(tool, "data", shape(r.data));
}

// ─── shapers: only what the model needs ─────────────────────────────────────

const TRADE_KEYS = [
  "id", "trader", "ticker", "date", "exitDate", "side", "strategy", "setup", "session", "horizon", "eventType", "isImx", "entry", "exit",
  "stop", "shares", "quantity", "size", "pnl", "fees", "netPnl", "rMultiple", "result", "holdTime", "mae", "mfe", "maeR", "mfeR",
  "tags", "confidenceGrade", "conviction", "playbookId", "sector", "relativeVolume", "atr",
] as const;
const TRADE_TEXT_KEYS = ["notes", "whatWorked", "whatFailed", "conclusion", "lesson"] as const;

function compactTrade(t: Record<string, unknown>, withText: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of TRADE_KEYS) if (t[k] !== undefined && t[k] !== null && t[k] !== "") out[k] = t[k];
  if (withText) for (const k of TRADE_TEXT_KEYS) if (typeof t[k] === "string" && (t[k] as string).trim()) out[k] = t[k];
  return out;
}

function shapeStats(d: any): unknown {
  const fields = d?.fields as string[] | undefined;
  const top = (rows: unknown, n: number) => Array.isArray(rows) ? rows.slice(0, n).map((r: any) => ({ key: r.key, ...(zipBucket(fields, r.b) as object) })) : undefined;
  const groups: Record<string, unknown> = {};
  for (const [dim, rows] of Object.entries((d?.groups ?? {}) as Record<string, unknown[]>)) {
    if (["trader", "setup", "ticker", "session", "weekday", "hour", "horizon", "sector", "conviction"].includes(dim)) groups[dim] = top(rows, dim === "ticker" ? 10 : 12);
  }
  const days = Array.isArray(d?.days) ? d.days : [];
  return {
    scope: d?.scope, trader: d?.trader, from: d?.from, to: d?.to, moneyVisible: d?.money,
    total: zipBucket(fields, d?.total), best: d?.best, worst: d?.worst, streaks: d?.streaks,
    tradingDays: days.length, lastDays: top(days.slice(-10), 10),
    groups, rHistogram: d?.rHist ? { median: d.rHist.median, big: d.rHist.big } : undefined,
    note: "bucket fields: n = trades, wins / losses, net / gross / fees in $ (net = gross − fees), r = sum of R over rN trades with R, avgR, winRate = wins / (wins + losses), profitFactor = netPos / |netNeg|",
  };
}

function shapeTradesPage(d: any): unknown {
  return {
    summary: d?.summary ? { ...d.summary, curve: undefined, streak: d.summary.streak } : undefined,
    page: d?.page ? { returned: d.page.returned, hasMore: d.page.hasMore, sort: d.page.sort, dir: d.page.dir } : undefined,
    trades: Array.isArray(d?.items) ? d.items.map((t: Record<string, unknown>) => compactTrade(t, false)) : [],
  };
}

function shapeBehavior(d: any): unknown {
  const patterns = Array.isArray(d?.patterns) ? d.patterns.filter((p: any) => p?.n > 0).slice(0, 12).map((p: any) => ({
    key: p.key, title: p.title, n: p.n, cost: p.cost ?? null, severity: p.severity ?? null, advice: p.advice ?? p.hint ?? undefined,
  })) : undefined;
  const profile = d?.profile ? { ...d.profile, setups: d.profile.setups ? { ...d.profile.setups, rows: (d.profile.setups.rows ?? []).slice(0, 10) } : undefined } : undefined;
  return { scope: d?.scope, from: d?.from, to: d?.to, summary: d?.summary, patterns, profile };
}

function shapeWhatif(d: any): unknown {
  return {
    period: d?.period, rules: d?.ruleLabels ?? d?.rules, baseline: d?.baseline, scenario: d?.scenario,
    excludedTrades: Array.isArray(d?.excluded) ? d.excluded.length : undefined,
    changedTrades: Array.isArray(d?.changed) ? d.changed.length : undefined,
    skippedRules: d?.skipped, bootstrap95: d?.bootstrap ? { diffTotal: d.bootstrap.diffTotal, month: d.bootstrap.month, monthBase: d.bootstrap.monthBase, days: d.bootstrap.days } : null,
    note: "Estimate on past trades; bootstrap95 = 95% intervals. Not a promise of future results.",
  };
}

const PLAYBOOK_LIST_KEYS = ["id", "name", "folder", "setupType", "horizon", "tags", "locked", "reviewVerdict", "trader", "access"] as const;
function compactSetup(r: Record<string, unknown>, full: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of PLAYBOOK_LIST_KEYS) if (r[k] !== undefined && r[k] !== null) out[k] = k === "access" ? { space: (r.access as any)?.space, mine: (r.access as any)?.mine } : r[k];
  if (full) for (const k of ["conditions", "checklist", "checklistItems", "notes", "ticker", "sector", "confidenceLevel", "minTier"]) if (r[k] !== undefined && r[k] !== null && r[k] !== "") out[k] = r[k];
  return out;
}

function matchScore(r: Record<string, unknown>, words: string[]): number {
  const hay = ["name", "folder", "setupType", "tags", "conditions", "notes", "checklist"].map((k) => String(r[k] ?? "")).join(" ").toLowerCase();
  return words.reduce((s, w) => s + (hay.includes(w) ? (String(r.name ?? "").toLowerCase().includes(w) ? 3 : 1) : 0), 0);
}

// ─── market context: cached tables only ────────────────────────────────────

async function marketContext(ctx: ToolContext, ticker: string | undefined, date: string | undefined): Promise<unknown> {
  const day = date ?? ctx.today;
  const out: Record<string, unknown> = { date: day };
  const { rows } = await pool.query<{ data: any; fetched_at: Date }>(
    `SELECT data, fetched_at FROM market_open_brief_cache WHERE date <= $1 ORDER BY date DESC LIMIT 1`, [day],
  ).catch(() => ({ rows: [] as { data: any; fetched_at: Date }[] }));
  const b = rows[0]?.data;
  if (b) {
    out.brief = {
      briefDate: b.date ?? null, fetchedAt: rows[0]!.fetched_at, futures: b.futures, macro: b.macro,
      gapLeaders: Array.isArray(b.gapLeaders) ? b.gapLeaders.slice(0, 10) : undefined,
      premarketMovers: Array.isArray(b.premarketMovers) ? b.premarketMovers.slice(0, 10) : undefined,
      sectorRotation: b.sectorRotation, economicEvents: Array.isArray(b.economicEvents) ? b.economicEvents.slice(0, 12) : undefined,
      earningsToday: Array.isArray(b.earningsToday) ? b.earningsToday.slice(0, 12) : undefined,
      summary: b.aiSummaries?.[ctx.lang] ?? b.aiSummary ?? null,
    };
  } else out.brief = null;
  if (ticker) {
    out.ticker = ticker;
    out.snapshot = await readSnapshot(ticker).catch(() => null);
    const from = shiftDays(day, -5);
    const ev = await apiGet(ctx.api, "/events", { ticker, from, to: day, limit: 20 });
    out.catalysts = ev.ok ? (Array.isArray(ev.data) ? ev.data : (ev.data as any)?.items ?? ev.data) : { error: ev.code };
  }
  out.note = "Cached data only (no live quotes). Say how old it is when it matters.";
  return out;
}

function shiftDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ─── dispatcher ─────────────────────────────────────────────────────────────

/** Run one tool call. Never throws: failures come back as an error tool result the model can read. */
export async function executeTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  const def = TOOL_BY_NAME.get(name);
  if (!def) return err(name, "UNKNOWN_TOOL", "no such tool", "unknown");
  const parsed = def.input.safeParse(rawInput ?? {});
  if (!parsed.success) {
    // Eager input streaming: a truncated / malformed input is answered as invalid, never run.
    return err(name, "INVALID_JSON", JSON.stringify({ INVALID_JSON: JSON.stringify(rawInput ?? null).slice(0, 2000), issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) }), def.kind);
  }
  const a = parsed.data as Record<string, any>;
  try {
    if (def.kind === "draft") {
      if (name === "draft_curator_note" && !(await can(ctx.req, "journal.review", { trader: a.trader }))) {
        return err(name, "FORBIDDEN", "curator notes are for staff who review this trader", "draft");
      }
      const draft = buildDraft(name, a);
      if (!draft) return err(name, "UNKNOWN_TOOL", "no such draft", "draft");
      return { kind: "draft", isError: false, content: wrapToolData(name, draftToolResult(draft)), draft };
    }
    switch (name) {
      case "search_help":
        return ok(name, "help", { results: searchHelp(a.query, { staff: ctx.actor.staff, admin: ctx.actor.admin }).map((e) => ({ path: e.path, title: e.title, about: e.about })) });
      case "get_my_stats":
        return fromApi(name, await apiGet(ctx.api, "/stats/aggregate", {
          scope: a.scope === "desk" ? "desk" : "trader", trader: a.trader, from: a.from, to: a.to, setup: a.setup, side: a.side, ticker: a.ticker, horizon: a.horizon,
        }), shapeStats);
      case "get_trades":
        return fromApi(name, await apiGet(ctx.api, "/trades/page", {
          trader: a.trader, from: a.from, to: a.to, date: a.date, ticker: a.ticker, setup: a.setup, side: a.side, outcome: a.outcome,
          horizon: a.horizon, sort: a.sort ?? "date", dir: a.dir ?? "desc", limit: a.limit ?? 25,
        }), shapeTradesPage);
      case "get_trade":
        return fromApi(name, await apiGet(ctx.api, `/trades/${a.id}`), (t) => compactTrade(t ?? {}, true));
      case "get_day_report":
        return fromApi(name, await apiGet(ctx.api, "/day-report", { trader: a.trader, date: a.date ?? ctx.today }), (d) => ({ ...d, traders: undefined }));
      case "get_behavior_patterns":
        return fromApi(name, await apiGet(ctx.api, "/behavior", { trader: a.trader, from: a.from ?? shiftDays(ctx.today, -60), to: a.to ?? ctx.today }), shapeBehavior);
      case "run_whatif":
        return fromApi(name, await apiPostReadOnly(ctx.api, "/whatif/run", { trader: a.trader, from: a.from, to: a.to, rules: a.rules, iters: 500 }), shapeWhatif);
      case "get_rules": {
        const rules = await apiGet(ctx.api, "/rules", { trader: a.trader });
        if (!rules.ok || !a.includeKinds) return fromApi(name, rules, (r) => ({ rules: r }));
        const kinds = await apiGet(ctx.api, "/rules/kinds");
        return ok(name, "data", { rules: rules.data, kinds: kinds.ok ? kinds.data : { error: kinds.code } });
      }
      case "get_risk_status":
        return fromApi(name, await apiGet(ctx.api, "/risk/me", { date: ctx.today }), (d) => ({ ...d, livePositions: Array.isArray(d?.livePositions) ? d.livePositions.slice(0, 15) : undefined }));
      case "get_academy_progress":
        return fromApi(name, await apiGet(ctx.api, "/academy/path/report", { user: a.user }), (d) => d);
      case "get_playbook":
      case "search_playbook": {
        const r = await apiGet(ctx.api, "/playbook");
        if (!r.ok) return fromApi(name, r, (x) => x);
        const rows = (Array.isArray(r.data) ? r.data : []) as Record<string, unknown>[];
        if (name === "get_playbook" && a.id) {
          const one = rows.find((x) => Number(x.id) === a.id);
          return one ? ok(name, "data", compactSetup(one, true)) : err(name, "SETUP_NOT_FOUND", "no such setup among the ones this user can read");
        }
        if (name === "get_playbook") return ok(name, "data", { count: rows.length, setups: rows.slice(0, 80).map((x) => compactSetup(x, false)) });
        const words = String(a.query).toLowerCase().split(/\s+/).filter((w) => w.length > 1);
        const hits = rows.map((x) => ({ x, s: matchScore(x, words) })).filter((h) => h.s > 0).sort((p, q) => q.s - p.s).slice(0, 8);
        return ok(name, "data", { query: a.query, setups: hits.map((h) => compactSetup(h.x, true)) });
      }
      case "get_market_context":
        return ok(name, "data", await marketContext(ctx, a.ticker, a.date));
      default:
        return err(name, "UNKNOWN_TOOL", "no such tool", "unknown");
    }
  } catch (e) {
    return err(name, "TOOL_FAILED", (e as Error)?.message?.slice(0, 200) ?? "failed", def.kind);
  }
}
