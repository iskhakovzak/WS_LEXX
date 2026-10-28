/**
 * DEVELOPMENT ONLY — a scripted stand-in for the model (env AI_ASSISTANT_MOCK=1, ignored in production; config.ts).
 * It lets the panel be built and demoed without a key and without cost: it streams text in small chunks, calls REAL
 * read tools (so the numbers are the caller's real data, through the same permission path) and, for a playbook intent,
 * a real draft tool with a card built from those results. Usage numbers are rough estimates so the budget UI moves.
 *
 * Script per turn (state read from the messages, like a model would):
 *   1. no tool result yet       → a short text + get_my_stats (and get_trades for a playbook intent)
 *   2. results, playbook intent → draft_playbook_entry built from the top setup / best trades
 *   3. otherwise                → the final answer: a markdown table of the period + the honesty line
 * Texts come from the server i18n namespace `assistant.mock` (language from the <context> block).
 */
import type { Anthropic } from "@workspace/integrations-anthropic-ai";
import { assistantT } from "../../i18n/ns";
import { isLang, type Lang } from "../../i18n";
import type { AssistantClient, StreamParams, TurnStream } from "./client";

type Block = Anthropic.ContentBlock;

const CHUNK = 14;
const CHUNK_DELAY_MS = 18;

function lastUserText(messages: Anthropic.MessageParam[]): { text: string; index: number } {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return { text: m.content, index: i };
    const t = m.content.find((b) => b.type === "text") as Anthropic.TextBlockParam | undefined;
    if (t) return { text: t.text, index: i };
  }
  return { text: "", index: 0 };
}

/** tool name → parsed JSON payload of the tool results after the user's message. */
function resultsSince(messages: Anthropic.MessageParam[], from: number): Map<string, any> {
  const names = new Map<string, string>();
  const out = new Map<string, any>();
  for (const m of messages.slice(from)) {
    if (typeof m.content === "string") continue;
    for (const b of m.content) {
      if (b.type === "tool_use") names.set(b.id, b.name);
      if (b.type === "tool_result") {
        const raw = typeof b.content === "string" ? b.content : "";
        const body = raw.split("\n").slice(1).join("\n").split("</tool_data>")[0] ?? "";
        try { out.set(names.get(b.tool_use_id) ?? "?", JSON.parse(body)); } catch { out.set(names.get(b.tool_use_id) ?? "?", null); }
      }
    }
  }
  return out;
}

const field = (ctx: string, key: string) => new RegExp(`^${key}:\\s*(.+)$`, "m").exec(ctx)?.[1]?.trim() ?? "";
const usd = (v: number) => `${v < 0 ? "−" : v > 0 ? "+" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const rr = (v: number) => `${v < 0 ? "−" : "+"}${Math.abs(v).toFixed(2)}R`;
const pct = (v: number) => `${Math.round(v * 100)}%`;
function shift(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

type Plan = { text: string; tools: { name: string; input: Record<string, unknown> }[] };

/** «✦ Помочь» in the demo: a mechanical rewrite of the <text> block (tidy sentences, bullets, or an appended evidence line). */
function assistRewrite(action: string, turn: string, fillLine: string): string {
  const src = (/<text[^>]*>\n?([\s\S]*?)\n?<\/text>/.exec(turn)?.[1] ?? "").trim();
  const sentences = src.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean)
    .map((x) => x[0]!.toUpperCase() + x.slice(1)).map((x) => (/[.!?:]$/.test(x) ? x : `${x}.`));
  if (action === "structure") return sentences.map((x) => `• ${x}`).join("\n");
  const tidy = sentences.join(" ");
  return action === "fill" ? `${tidy}${tidy ? "\n\n" : ""}${fillLine}` : tidy;
}

/** AI review in the demo: a schema-valid review built mechanically from the <review_data> numbers. */
function mockReview(turn: string): string {
  const lang: Lang = /in English/.test(turn) ? "en" : /in Uzbek/.test(turn) ? "uz" : "ru";
  const t = assistantT.tFor(lang);
  const kind = /kind="(day|week|month)"/.test(turn) ? "day" : "trade";
  let data: any = {};
  try { data = JSON.parse(/<review_data>\n([\s\S]*?)\n<\/review_data>/.exec(turn)?.[1] ?? "{}"); } catch { /* demo */ }
  const fills = Array.isArray(data.fills) ? data.fills : [];
  const first = fills[0];
  const st = data.dayState ?? {};
  const net = Number(kind === "day" ? st.net ?? 0 : data.trade?.netPnl ?? data.trade?.pnl ?? 0);
  const evidence = kind === "trade" && first
    ? [{ kind: "fill", label: `${t("mock.review.fill")} 1 · ${first.timeET ?? "—"} · ${first.kind} @ ${first.price}`, at: first.timeET ? String(first.timeET).slice(0, 5) : null, ref: 1 }]
    : [{ kind: "stat", label: `${t("mock.review.trades")}: ${st.trades ?? 0}`, at: null, ref: null }];
  const review = {
    verdict: { grade: net >= 0 ? "B" : "C", headline: t(kind === "day" ? "mock.review.dayHeadline" : "mock.review.tradeHeadline", { net: usd(net) }), followedPlan: "unknown" },
    wentWell: [{ text: t("mock.review.well"), basis: "fact", evidence }],
    wentWrong: kind === "day" && st.afterLoss?.n
      ? [{ text: t("mock.review.afterLoss", { n: st.afterLoss.n, net: usd(Number(st.afterLoss.net ?? 0)) }), basis: "fact", evidence: [{ kind: "stat", label: `${t("mock.review.afterLossLabel")}: ${st.afterLoss.n}`, at: null, ref: null }] }]
      : [{ text: t("mock.review.wrong"), basis: "hypothesis", evidence: [] }],
    edge: null,
    tomorrow: { if: t("mock.review.if"), then: t("mock.review.then") },
    whatIf: { type: "afterLoss", n: null, minutes: 10, usd: null, pct: null, from: null, to: null, value: null, items: [], why: t("mock.review.why") },
    confidence: "low",
    dataGaps: [t("mock.review.gap")],
  };
  return JSON.stringify(review);
}

/**
 * The mentor in the demo: a schema-valid answer (lib/mentor/schema) built mechanically from <mentor_context> — the
 * deterministic lines (session flow, opening window, season, formula checks) are named the way the prompt asks.
 */
function mockMentor(turn: string): string {
  const kind = /<mentor_request kind="(\w+)"/.exec(turn)?.[1] ?? "chat";
  const lang: Lang = /Reply in English/.test(turn) ? "en" : /Reply in Uzbek/.test(turn) ? "uz" : "ru";
  const t = assistantT.tFor(lang);
  let ctx: Record<string, any> = {};
  try { ctx = JSON.parse(/<mentor_context>\n([\s\S]*?)\n<\/mentor_context>/.exec(turn)?.[1] ?? "{}"); } catch { ctx = {}; }
  const flow = ctx.sessionFlow ?? null;
  const lines: string[] = [];
  const re = flow?.reentries?.find((x: any) => x.entries >= 3);
  if (re) lines.push(t("mock.mentor.reentry", { ticker: re.ticker, entries: re.entries, net: usd(Number(re.net ?? 0)) }));
  if (flow?.chase?.length) lines.push(t("mock.mentor.chase", { ticker: flow.chase[0].ticker }));
  if (flow?.giveback) lines.push(t("mock.mentor.giveback", { amount: usd(flow.giveback.giveback), stops: String(flow.giveback.stops ?? flow.giveback.r ?? "—") }));
  if (flow?.greenToRed) lines.push(t("mock.mentor.greenToRed", { size: String(flow.greenToRed.sizeRatio ?? "—"), pace: String(flow.greenToRed.paceRatio ?? "—") }));
  if (flow?.offTiming?.length) lines.push(t("mock.mentor.offTiming", { ticker: flow.offTiming[0].ticker, setup: flow.offTiming[0].setup }));
  const fb = ctx.formulaChecks?.[0];
  const easy = (ctx.easyMoney ?? []) as any[];
  const took = easy.find((x) => x.status === "took");
  const miss = easy.find((x) => x.status === "skipped" || x.status === "missed");
  if (took) lines.push(t("mock.mentor.easyTook", { ticker: took.ticker, move: `${took.movePct}%`, net: usd(Number(took.net ?? 0)) }));
  if (miss) lines.push(t("mock.mentor.easyMissed", { ticker: miss.ticker, move: `${miss.movePct}%` }));
  if (fb) lines.push(t("mock.mentor.formulaBreak", { ticker: fb.ticker, day: fb.day, setup: fb.setupName ?? "—" }));
  const day = ctx.todayStats;
  const summary = day ? t("mock.mentor.day", { n: Number(day.trades ?? 0), net: usd(Number(day.net ?? 0)) }) : t("mock.mentor.noDay");
  const brief: string[] = [];
  if (ctx.openWindow?.limitUsd != null) brief.push(t(ctx.openWindow.lifted ? "mock.mentor.openLifted" : "mock.mentor.openWindow", { limit: usd(ctx.openWindow.limitUsd) }));
  if (ctx.season?.quiet) brief.push(t("mock.mentor.quiet"));
  if (ctx.season?.prime) brief.push(t("mock.mentor.prime"));
  const cell = (c: any) => (c ? `${c.family} · ${c.timing}` : "—");
  if (ctx.deskPulse) brief.push(t("mock.mentor.pulse", { works: cell(ctx.deskPulse.works), fails: cell(ctx.deskPulse.fails) }));
  const demo = t("mock.mentor.demo");
  const out = kind === "brief"
    ? { headline: demo, points: brief.slice(0, 3), ruleToday: ctx.season?.quiet ? t("mock.mentor.quietRule") : t("mock.mentor.rule"), setupIds: [] }
    : kind === "debrief"
      ? { summary, vsPlan: lines[0] ?? t("mock.mentor.noFlags"), lesson: lines[1] ?? lines[0] ?? t("mock.mentor.noFlags"), praise: null, challenge: lines[0] ?? null, ruleTomorrow: null, notes: [] }
      : kind === "weekly"
        ? { summary: demo, commitments: [], nextFocus: t("mock.mentor.rule"), newCommitment: null, notes: [] }
        : { reply: [demo, ...lines].join(" "), notes: [], commitment: null };
  return JSON.stringify(out);
}

function plan(params: StreamParams): Plan {
  const { text, index } = lastUserText(params.messages);
  if (text.startsWith("<review_request")) return { text: mockReview(text), tools: [] };
  if (text.startsWith("<mentor_request")) return { text: mockMentor(text), tools: [] };
  const lang: Lang = ((l) => (isLang(l) ? l : "ru"))(field(text, "interface language"));
  const t = assistantT.tFor(lang);
  const today = field(text, "today \\(New York\\)") || new Date().toISOString().slice(0, 10);
  const draftIntent = field(text, "intent") === "draft_playbook";
  const results = resultsSince(params.messages, index);
  const from = shift(today, -30);
  const intent = field(text, "intent");
  if (intent.startsWith("assist_")) return { text: assistRewrite(intent.slice(7), text, t("mock.assistFill")), tools: [] };
  if (!results.size) {
    const tools: Plan["tools"] = [{ name: "get_my_stats", input: { from, to: today } }];
    if (draftIntent) tools.push({ name: "get_trades", input: { from, to: today, sort: "r", dir: "desc", limit: 20 } });
    return { text: draftIntent ? t("mock.lookingDraft") : t("mock.lookingStats"), tools };
  }
  const stats = results.get("get_my_stats");
  const total = (stats?.total ?? {}) as Record<string, number>;
  const n = Number(total.n ?? 0);
  const net = Number(total.net ?? 0);
  const setups = (Array.isArray(stats?.groups?.setup) ? stats.groups.setup : []) as Array<Record<string, any>>;
  const top = [...setups].filter((s) => s.key && !["__none__", "—", "-"].includes(String(s.key))).sort((a, b) => Number(b.net ?? 0) - Number(a.net ?? 0))[0];
  if (draftIntent && !results.has("draft_playbook_entry") && top) {
    const trades = (results.get("get_trades")?.trades ?? []) as Array<Record<string, any>>;
    const ids = trades.filter((x) => !top.key || x.setup === top.key).slice(0, 5).map((x) => Number(x.id)).filter(Boolean);
    const name = t("mock.draftName", { setup: String(top.key) });
    return {
      text: "",
      tools: [{ name: "draft_playbook_entry", input: {
        name, strategy: "Day", horizon: "intraday",
        context: t("mock.draftContext"), trigger: t("mock.draftTrigger"), entry: t("mock.draftEntry"), stop: t("mock.draftStop"),
        targets: t("mock.draftTargets"), management: t("mock.draftManagement"), invalidation: t("mock.draftInvalidation"),
        checklist: [t("mock.draftChecklist1"), t("mock.draftChecklist2"), t("mock.draftChecklist3")],
        exampleTradeIds: ids.length ? ids : (trades.slice(0, 3).map((x) => Number(x.id)).filter(Boolean)),
        notes: t("mock.draftNotes", { n: Number(top.n ?? 0), net: usd(Number(top.net ?? 0)) }),
      } }],
    };
  }
  if (results.has("draft_playbook_entry") && top) {
    return { text: t("mock.draftDone", { name: t("mock.draftName", { setup: String(top.key) }), n: Number(top.n ?? 0) }) + t("mock.demo"), tools: [] };
  }
  if (!n) return { text: t("mock.noData") + t("mock.demo"), tools: [] };
  const wr = Number(total.winRate ?? 0);
  const rows = setups.slice(0, 6).map((s) => `| ${s.key === "__none__" || s.key === "—" || !s.key ? t("mock.noSetup") : s.key} | ${Number(s.n ?? 0)} | ${usd(Number(s.net ?? 0))} | ${rr(Number(s.r ?? 0))} |`);
  const table = rows.length ? `| ${t("mock.colSetup")} | ${t("mock.colTrades")} | ${t("mock.colNet")} | ${t("mock.colR")} |\n|---|---:|---:|---:|\n${rows.join("\n")}\n` : "";
  return {
    text: t("mock.statsIntro", { from: stats?.from ?? from, to: stats?.to ?? today, n, wr: pct(wr), net: usd(net), r: rr(Number(total.r ?? 0)) }) + table + t("mock.hypothesis", { n }) + t("mock.demo"),
    tools: [],
  };
}

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) { reject(new DOMException("aborted", "AbortError")); return; }
  const id = setTimeout(resolve, ms);
  signal.addEventListener("abort", () => { clearTimeout(id); reject(new DOMException("aborted", "AbortError")); }, { once: true });
});

function streamOf(params: StreamParams, signal: AbortSignal): TurnStream {
  const p = plan(params);
  const content: Block[] = [];
  if (p.text) content.push({ type: "text", text: p.text, citations: null } as Block);
  p.tools.forEach((tool, i) => content.push({ type: "tool_use", id: `toolu_mock_${Date.now().toString(36)}_${i}`, name: tool.name, input: tool.input } as Block));
  const promptChars = JSON.stringify(params.messages).length;
  const usage = {
    input_tokens: Math.round(promptChars / 4) + 40,
    output_tokens: Math.round((p.text.length + JSON.stringify(p.tools).length) / 3.5) + 20,
    cache_read_input_tokens: params.messages.length > 1 ? 4200 : 0,
    cache_creation_input_tokens: params.messages.length > 1 ? 0 : 4200,
  };
  const message = {
    id: `msg_mock_${Date.now().toString(36)}`, type: "message", role: "assistant", model: params.model, content,
    stop_reason: p.tools.length ? "tool_use" : "end_turn", stop_sequence: null, usage,
  } as unknown as Anthropic.Message;
  let stopped = false;
  async function* events(): AsyncGenerator<Anthropic.MessageStreamEvent> {
    yield { type: "message_start", message: { ...message, content: [] } } as Anthropic.MessageStreamEvent;
    for (let i = 0; i < content.length; i++) {
      const b = content[i]!;
      if (stopped) return;
      if (b.type === "text") {
        yield { type: "content_block_start", index: i, content_block: { type: "text", text: "", citations: null } } as Anthropic.MessageStreamEvent;
        for (let k = 0; k < b.text.length; k += CHUNK) {
          await sleep(CHUNK_DELAY_MS, signal);
          yield { type: "content_block_delta", index: i, delta: { type: "text_delta", text: b.text.slice(k, k + CHUNK) } } as Anthropic.MessageStreamEvent;
        }
      } else if (b.type === "tool_use") {
        yield { type: "content_block_start", index: i, content_block: { ...b, input: {} } } as Anthropic.MessageStreamEvent;
        await sleep(250, signal);
        yield { type: "content_block_delta", index: i, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } } as Anthropic.MessageStreamEvent;
      }
      yield { type: "content_block_stop", index: i } as Anthropic.MessageStreamEvent;
    }
    yield { type: "message_delta", delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: usage.output_tokens } } as unknown as Anthropic.MessageStreamEvent;
    yield { type: "message_stop" } as Anthropic.MessageStreamEvent;
  }
  return {
    [Symbol.asyncIterator]: () => events(),
    finalMessage: async () => message,
    abort: () => { stopped = true; },
  };
}

export function mockClient(): AssistantClient {
  return { kind: "mock", stream: (params, { signal }) => streamOf(params, signal) };
}
