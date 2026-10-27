/**
 * «Ассистент WS» — the tool catalogue the model sees (JSON Schema) and the zod validators every tool input passes
 * before anything runs (inputs stream eagerly, so the SDK's tolerant parser may hand back a truncated object).
 *
 * The list is FIXED and sorted by name: it is the first part of the cached prompt prefix (tools → system → messages),
 * so it never changes per user or per request — staff-only tools refuse at execution instead of disappearing.
 * Kinds: data (read through the app's own API as the caller), draft (returns a card, never writes), help (site map).
 */
import { z } from "zod";

export type ToolKind = "data" | "draft" | "help";

const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ymd = { type: "string", description: "New York trading date, YYYY-MM-DD" } as const;
const traderProp = { type: "string", description: "Trader name (staff only; a trader always gets their own data). Omit for the current user." } as const;
const text = (max: number) => z.string().trim().max(max);

type JsonSchema = { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
export type ToolDef = { name: string; kind: ToolKind; description: string; input_schema: JsonSchema; input: z.ZodTypeAny };

const obj = (properties: Record<string, unknown>, required: string[] = []): JsonSchema => ({ type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false });

const DEFS: ToolDef[] = [
  {
    name: "draft_curator_note",
    kind: "draft",
    description: "STAFF ONLY. Prepare a curator note about a trader as an editable card (nothing is saved; the curator saves it with one click). Base it on the trader's data you looked up.",
    input_schema: obj({
      trader: { type: "string", description: "The trader the note is about" },
      body: { type: "string", description: "The note: specific, kind, actionable; cites days / trades" },
      kind: { type: "string", enum: ["note", "call", "concern", "praise"], description: "note (default), call (talk to the trader), concern or praise" },
      day: ymd,
    }, ["trader", "body"]),
    input: z.object({ trader: text(100).min(1), body: text(4000).min(1), kind: z.enum(["note", "call", "concern", "praise"]).optional(), day: YMD.optional() }),
  },
  {
    name: "draft_eod_review",
    kind: "draft",
    description: "Prepare the end-of-day review for a trading day as an editable card (nothing is saved; the trader saves it into the day's close-the-day form). Fill from the day report and trades.",
    input_schema: obj({
      date: ymd,
      mood: { type: "integer", minimum: 1, maximum: 5, description: "Mood 1–5 if the user said it; omit otherwise" },
      repeat: { type: "string", description: "What to repeat (what worked, with tickers / times)" },
      stop: { type: "string", description: "What to stop doing (mistakes, with their cost)" },
      tomorrow: { type: "string", description: "Plan / focus for the next session" },
      tradeLessons: { type: "array", maxItems: 20, items: obj({ tradeId: { type: "integer" }, lesson: { type: "string" } }, ["tradeId", "lesson"]), description: "Optional one-line lesson per trade" },
    }, ["date"]),
    input: z.object({
      date: YMD, mood: z.number().int().min(1).max(5).optional(), repeat: text(4000).optional(), stop: text(4000).optional(), tomorrow: text(6000).optional(),
      tradeLessons: z.array(z.object({ tradeId: z.number().int().positive(), lesson: text(2000).min(1) })).max(20).optional(),
    }),
  },
  {
    name: "draft_plan_of_day",
    kind: "draft",
    description: "Prepare the trader's personal plan for a session as an editable card (nothing is saved; the trader saves it into Plan of the day). Ground it in their recent data and rules.",
    input_schema: obj({
      date: ymd,
      marketView: { type: "string", description: "Market view / context for the session" },
      focus: { type: "string", description: "One focus for the day (process, not P&L)" },
      riskNotes: { type: "string", description: "Risk notes: size, what to avoid" },
      maxLossUsd: { type: "number", minimum: 0, description: "Max loss for the day in $" },
      maxTrades: { type: "integer", minimum: 0, maximum: 500 },
      inPlay: { type: "array", maxItems: 12, items: obj({
        ticker: { type: "string" }, side: { type: "string", enum: ["long", "short", "both"] },
        trigger: { type: "string" }, invalidation: { type: "string" }, scenarioA: { type: "string" }, scenarioB: { type: "string" },
      }, ["ticker"]) },
    }, ["date"]),
    input: z.object({
      date: YMD, marketView: text(6000).optional(), focus: text(1000).optional(), riskNotes: text(6000).optional(),
      maxLossUsd: z.number().finite().nonnegative().lt(1e7).optional(), maxTrades: z.number().int().min(0).max(500).optional(),
      inPlay: z.array(z.object({
        ticker: z.string().trim().min(1).max(16), side: z.enum(["long", "short", "both"]).optional(),
        trigger: text(1000).optional(), invalidation: text(1000).optional(), scenarioA: text(1500).optional(), scenarioB: text(1500).optional(),
      })).max(12).optional(),
    }),
  },
  {
    name: "draft_playbook_entry",
    kind: "draft",
    description: "Prepare a playbook setup as an editable card (nothing is saved; the user clicks «Save to playbook»). Use the structure context → trigger → entry → stop → targets → management → invalidation, plus a short checklist and linked example trades (ids from get_trades).",
    input_schema: obj({
      name: { type: "string", description: "Short setup name" },
      strategy: { type: "string", enum: ["OPG", "Print", "PM", "OPGtoDAY", "Day", "MOC", "AfterMarket", "Overnight", "Swing"], description: "Strategy class" },
      horizon: { type: "string", enum: ["intraday", "overnight", "swing"] },
      context: { type: "string", description: "Market / stock context where the setup works (catalyst, gap, float, RVOL, time)" },
      trigger: { type: "string", description: "What exactly triggers the trade" },
      entry: { type: "string", description: "Entry rules" },
      stop: { type: "string", description: "Stop placement and size" },
      targets: { type: "string", description: "Targets / exits" },
      management: { type: "string", description: "Trade management (adds, partials, trailing)" },
      invalidation: { type: "string", description: "When the setup is invalid / do not take it" },
      checklist: { type: "array", maxItems: 12, items: { type: "string" }, description: "Pre-trade checklist items" },
      tags: { type: "array", maxItems: 10, items: { type: "string" } },
      exampleTradeIds: { type: "array", maxItems: 10, items: { type: "integer" }, description: "Ids of the user's trades that illustrate the setup" },
      notes: { type: "string", description: "Evidence: sample size, win rate, avg R from the data (mark small samples as a hypothesis)" },
    }, ["name"]),
    input: z.object({
      name: text(200).min(1),
      strategy: z.enum(["OPG", "Print", "PM", "OPGtoDAY", "Day", "MOC", "AfterMarket", "Overnight", "Swing"]).optional(),
      horizon: z.enum(["intraday", "overnight", "swing"]).optional(),
      context: text(4000).optional(), trigger: text(3000).optional(), entry: text(3000).optional(), stop: text(2000).optional(),
      targets: text(2000).optional(), management: text(3000).optional(), invalidation: text(2000).optional(),
      checklist: z.array(text(300).min(1)).max(12).optional(), tags: z.array(text(40).min(1)).max(10).optional(),
      exampleTradeIds: z.array(z.number().int().positive()).max(10).optional(), notes: text(4000).optional(),
    }),
  },
  {
    name: "draft_rule",
    kind: "draft",
    description: "Prepare a trading rule as an editable card (nothing is saved; the user saves it into Rules). Call get_rules with includeKinds first: `kind` and `threshold` must follow the rule catalogue.",
    input_schema: obj({
      name: { type: "string" },
      kind: { type: "string", description: "Rule kind from the catalogue (get_rules includeKinds)" },
      threshold: { type: "object", description: "Threshold fields of that kind, e.g. {\"n\": 3} or {\"usd\": 300}" },
      note: { type: "string", description: "Why this rule (evidence from the data)" },
    }, ["name", "kind"]),
    input: z.object({ name: text(120).min(1), kind: z.string().trim().min(1).max(60), threshold: z.record(z.unknown()).optional(), note: text(1000).optional() }),
  },
  {
    name: "get_academy_progress",
    kind: "data",
    description: "Academy ladder progress (Junior → Trader → Senior): stage, criteria met / missing, pending promotion request, history.",
    input_schema: obj({ user: traderProp }),
    input: z.object({ user: z.string().trim().max(120).optional() }),
  },
  {
    name: "get_behavior_patterns",
    kind: "data",
    description: "Behaviour analysis over a period: costly patterns (revenge, overtrading, tilt, giving back profit) with $ cost, trading style, best / worst hours and setups, discipline trend.",
    input_schema: obj({ from: ymd, to: ymd, trader: traderProp }),
    input: z.object({ from: YMD.optional(), to: YMD.optional(), trader: z.string().trim().max(120).optional() }),
  },
  {
    name: "get_day_report",
    kind: "data",
    description: "The deterministic report of one trading day: trades with timing, P&L, limit use, mistakes, strengths.",
    input_schema: obj({ date: ymd, trader: traderProp }),
    input: z.object({ date: YMD.optional(), trader: z.string().trim().max(120).optional() }),
  },
  {
    name: "get_market_context",
    kind: "data",
    description: "Cached market context only (no live fetch): the morning market brief of a day (futures, gappers, sectors, macro calendar, summary), a ticker's cached Finviz snapshot (float, short interest, sector, market cap) and its catalysts around the day.",
    input_schema: obj({ ticker: { type: "string", description: "Ticker symbol" }, date: ymd }),
    input: z.object({ ticker: z.string().trim().toUpperCase().regex(/^[A-Z0-9.\-]{1,12}$/).optional(), date: YMD.optional() }),
  },
  {
    name: "get_my_stats",
    kind: "data",
    description: "Statistics over a period (by close date): totals (trades, win rate, net $, R, expectancy, profit factor), best / worst, streaks, breakdowns by setup, ticker, session, weekday, hour, horizon. Optional filters.",
    input_schema: obj({
      from: ymd, to: ymd, trader: traderProp,
      scope: { type: "string", enum: ["trader", "desk"], description: "desk = everyone the user may see (staff); default trader" },
      setup: { type: "string" }, side: { type: "string", enum: ["long", "short"] }, ticker: { type: "string" },
      horizon: { type: "string", enum: ["intraday", "overnight", "swing"] },
    }),
    input: z.object({
      from: YMD.optional(), to: YMD.optional(), trader: z.string().trim().max(120).optional(), scope: z.enum(["trader", "desk"]).optional(),
      setup: z.string().trim().max(200).optional(), side: z.enum(["long", "short"]).optional(), ticker: z.string().trim().max(20).optional(),
      horizon: z.enum(["intraday", "overnight", "swing"]).optional(),
    }),
  },
  {
    name: "get_playbook",
    kind: "data",
    description: "The playbook the user can read: without id a compact list of setups; with id the full setup (conditions, checklist, notes, tags, review verdict).",
    input_schema: obj({ id: { type: "integer" } }),
    input: z.object({ id: z.number().int().positive().optional() }),
  },
  {
    name: "get_risk_status",
    kind: "data",
    description: "The current user's risk status today: limits, P&L against the daily loss limit, drawdown, open risk and positions, alerts.",
    input_schema: obj({}),
    input: z.object({}),
  },
  {
    name: "get_rules",
    kind: "data",
    description: "Trading rules that apply to the user (personal and desk) with their thresholds; includeKinds adds the rule catalogue (kinds and threshold fields) needed for draft_rule.",
    input_schema: obj({ trader: traderProp, includeKinds: { type: "boolean" } }),
    input: z.object({ trader: z.string().trim().max(120).optional(), includeKinds: z.boolean().optional() }),
  },
  {
    name: "get_trade",
    kind: "data",
    description: "One trade by id: prices, size, P&L, R, timing, strategy, setup, tags, grade, notes and review.",
    input_schema: obj({ id: { type: "integer" } }, ["id"]),
    input: z.object({ id: z.number().int().positive() }),
  },
  {
    name: "get_trades",
    kind: "data",
    description: "List trades with filters plus a summary of the whole filtered set (count, win rate, net, avg R, expectancy, profit factor). Returns at most `limit` rows (default 25, max 50).",
    input_schema: obj({
      from: ymd, to: ymd, date: ymd, trader: traderProp,
      ticker: { type: "string" }, setup: { type: "string" }, side: { type: "string", enum: ["long", "short"] },
      outcome: { type: "string", enum: ["win", "loss", "breakeven", "open"] },
      horizon: { type: "string", enum: ["intraday", "overnight", "swing"] },
      sort: { type: "string", enum: ["date", "pnl", "r", "ticker"] }, dir: { type: "string", enum: ["asc", "desc"] },
      limit: { type: "integer", minimum: 1, maximum: 50 },
    }),
    input: z.object({
      from: YMD.optional(), to: YMD.optional(), date: YMD.optional(), trader: z.string().trim().max(80).optional(),
      ticker: z.string().trim().max(16).optional(), setup: z.string().trim().max(120).optional(), side: z.enum(["long", "short"]).optional(),
      outcome: z.enum(["win", "loss", "breakeven", "open"]).optional(), horizon: z.enum(["intraday", "overnight", "swing"]).optional(),
      sort: z.enum(["date", "pnl", "r", "ticker"]).optional(), dir: z.enum(["asc", "desc"]).optional(), limit: z.number().int().min(1).max(50).optional(),
    }),
  },
  {
    name: "run_whatif",
    kind: "data",
    description: "Simulate rules on the user's past trades with the site's what-if engine (estimate on history, not a promise). Rule objects, e.g. {\"type\":\"dailyLossLimit\",\"usd\":300}, {\"type\":\"maxTradesPerDay\",\"n\":5}, {\"type\":\"stopAfterLosses\",\"n\":3}, {\"type\":\"timeWindow\",\"from\":\"09:30\",\"to\":\"11:00\"}, {\"type\":\"excludeTickers\",\"tickers\":[\"XYZ\"]}, {\"type\":\"excludeSetups\",\"setups\":[\"…\"]}, {\"type\":\"capLoss\",\"usd\":100}, {\"type\":\"afterLoss\",\"minutes\":15}, {\"type\":\"excludeSide\",\"side\":\"short\"}, {\"type\":\"requireStop\"}, {\"type\":\"noReentry\"}, {\"type\":\"dailyProfitTarget\",\"usd\":500}.",
    input_schema: obj({
      rules: { type: "array", minItems: 1, maxItems: 10, items: { type: "object" } },
      from: ymd, to: ymd, trader: traderProp,
    }, ["rules"]),
    input: z.object({ rules: z.array(z.record(z.unknown())).min(1).max(10), from: YMD.optional(), to: YMD.optional(), trader: z.string().trim().max(120).optional() }),
  },
  {
    name: "search_help",
    kind: "help",
    description: "Find where something is on the site (\"where do I see X\"): returns site paths with what each screen answers. Query in English keywords.",
    input_schema: obj({ query: { type: "string" } }, ["query"]),
    input: z.object({ query: z.string().trim().min(1).max(200) }),
  },
  {
    name: "search_playbook",
    kind: "data",
    description: "Search the playbook the user can read by words in names, conditions, notes and tags; returns the best matching setups (compact).",
    input_schema: obj({ query: { type: "string" } }, ["query"]),
    input: z.object({ query: z.string().trim().min(1).max(200) }),
  },
];

export const TOOL_DEFS: readonly ToolDef[] = [...DEFS].sort((a, b) => a.name.localeCompare(b.name));
export const TOOL_BY_NAME: ReadonlyMap<string, ToolDef> = new Map(TOOL_DEFS.map((d) => [d.name, d]));
export const DRAFT_TOOLS: ReadonlySet<string> = new Set(TOOL_DEFS.filter((d) => d.kind === "draft").map((d) => d.name));

/**
 * The tools as the Messages API takes them: eager input streaming on every tool (the stream is consumed as it comes;
 * inputs are validated with zod before anything runs) and one cache breakpoint on the last tool (the tools are the
 * start of the cached prefix).
 */
export function apiTools(): Array<Record<string, unknown>> {
  return TOOL_DEFS.map((d, i) => ({
    name: d.name,
    description: d.description,
    input_schema: d.input_schema,
    eager_input_streaming: true,
    ...(i === TOOL_DEFS.length - 1 ? { cache_control: { type: "ephemeral" } } : {}),
  }));
}
