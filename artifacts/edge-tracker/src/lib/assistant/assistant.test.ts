import { describe, expect, it } from "vitest";
import { createSseParser } from "./sse";
import { applyEvent, budgetLeftPct, contextFor, newAssistantMessage, pageKeyOf, STARTERS, suggestionFor } from "./model";
import { sameText, wordDiff } from "./diff";
import { appendText, eodLessons, eodSummary, planPayload, playbookPayload, rulePayload } from "./drafts";

describe("SSE parser", () => {
  it("parses frames split across chunks and skips pings / unknown events", () => {
    const p = createSseParser();
    const a = p.feed('event: meta\ndata: {"tier":"standard","reason":"default","boost":false}\n\n: ping\n\nevent: te');
    expect(a).toEqual([{ event: "meta", data: { tier: "standard", reason: "default", boost: false } }]);
    const b = p.feed('xt\ndata: {"delta":"Hi"}\n\nevent: bogus\ndata: {}\n\nevent: advisor\ndata: {"status":"start"}\n\nevent: done\r\ndata: {"messageId":3,"tier":"deep","units":120,"stop":"end_turn"}\r\n\r\n');
    expect(b.map((e) => e.event)).toEqual(["text", "advisor", "done"]);
    expect(p.flush()).toEqual([]);
  });
});

describe("answer state", () => {
  const ev = (event: string, data: unknown) => ({ event, data }) as Parameters<typeof applyEvent>[1];
  it("streams text, chips, drafts and the tier; a retry drops only the current step", () => {
    let m = newAssistantMessage("a");
    m = applyEvent(m, ev("meta", { tier: "standard", reason: "default", boost: false }));
    m = applyEvent(m, ev("text", { delta: "Looking. " }));
    m = applyEvent(m, ev("tool", { id: "t1", name: "get_trades", status: "start" }));
    m = applyEvent(m, ev("tool", { id: "t1", name: "get_trades", status: "done" }));
    m = applyEvent(m, ev("text", { delta: "drafting…" }));
    m = applyEvent(m, ev("tool", { id: "t2", name: "draft_playbook_entry", status: "start" }));
    m = applyEvent(m, ev("retry", {}));
    expect(m.text).toBe("Looking. ");
    expect(m.chips.map((c) => [c.id, c.status])).toEqual([["t1", "done"]]);
    m = applyEvent(m, ev("tier", { tier: "deep", reason: "draft" }));
    m = applyEvent(m, ev("advisor", { status: "start" }));
    expect(m.advising).toBe("start");
    m = applyEvent(m, ev("advisor", { status: "done" }));
    m = applyEvent(m, ev("draft", { id: "d1", kind: "playbook", draft: { name: "ORB" } }));
    m = applyEvent(m, ev("text", { delta: "Done." }));
    m = applyEvent(m, ev("done", { messageId: 1, tier: "deep", units: 900, stop: "end_turn" }));
    expect(m).toMatchObject({ text: "Looking. Done.", tier: "deep", reason: "draft", status: "done", advising: "done" });
    expect(JSON.stringify(m)).not.toMatch(/claude|haiku|sonnet|opus/i);
    expect(m.drafts).toHaveLength(1);
  });
  it("an advisor call marks a plain answer deep, never downgrades a boosted one", () => {
    const boosted = applyEvent(applyEvent(newAssistantMessage("b"), ev("meta", { tier: "boost", reason: "manual", boost: true })), ev("advisor", { status: "start" }));
    expect(boosted.tier).toBe("boost");
    expect(applyEvent(newAssistantMessage("c"), ev("advisor", { status: "start" })).tier).toBe("deep");
  });
  it("budget meter: whole percent left, never 0% while something is left", () => {
    expect(budgetLeftPct({ limit: 1_000_000, leftShare: 0.724 })).toBe(72);
    expect(budgetLeftPct({ limit: 1_000_000, leftShare: 0.004 })).toBe(1);
    expect(budgetLeftPct({ limit: 1_000_000, leftShare: 0 })).toBe(0);
    expect(budgetLeftPct({ limit: 0, leftShare: 0 })).toBeNull();
    expect(budgetLeftPct(null)).toBeNull();
  });
  it("one suggestion per page with an ask context, keyed by its subject", () => {
    expect(suggestionFor("trade", { tradeId: 7 })).toEqual({ key: "trade", id: "trade:7", intent: "analysis" });
    expect(suggestionFor("dayReport", { date: "2026-10-24", trader: "A" })).toMatchObject({ key: "dayReport", id: "day:2026-10-24:A" });
    expect(suggestionFor("playbook", {})).toBeNull();
    expect(suggestionFor("generic", null)).toBeNull();
  });
  it("maps pages to starters", () => {
    expect(pageKeyOf("/day-report", null)).toBe("dayReport");
    expect(pageKeyOf("/trades", { tradeId: 3 })).toBe("trade");
    expect(pageKeyOf("/", null)).toBe("dashboard");
    expect(pageKeyOf("/settings", null)).toBe("generic");
    for (const list of Object.values(STARTERS)) expect(list).toHaveLength(3);
    expect(contextFor("/x?y=1", { tradeId: 1, route: "/old" })).toEqual({ tradeId: 1, route: "/x?y=1" });
  });
});

describe("word diff", () => {
  it("marks kept, removed and added words", () => {
    expect(wordDiff("stop below the low", "stop under the low")).toEqual([
      { kind: "same", text: "stop " }, { kind: "del", text: "below" }, { kind: "add", text: "under" }, { kind: "same", text: " the low" },
    ]);
    expect(sameText("a  b\n", "a b")).toBe(true);
  });
});

describe("draft payloads (sent only on the person's click)", () => {
  it("playbook: conditions as sections, checklist items, tags, example trades", () => {
    const { body, tradeIds } = playbookPayload({ name: " ORB ", context: "gap", trigger: "break", checklist: ["a", " "], tags: ["x", "y"], exampleTradeIds: [3, "4", -1] }, (s) => s.toUpperCase());
    expect(body).toMatchObject({ name: "ORB", space: "personal", conditions: "## CONTEXT\ngap\n\n## TRIGGER\nbreak", checklistItems: [{ text: "a" }], tags: "x, y" });
    expect(tradeIds).toEqual([3, 4]);
  });
  it("plan and end of day merge into what is stored, never overwrite", () => {
    const merged = planPayload({ doc: { focus: "mine", marketView: "old", inPlay: [{ ticker: "AAPL" }] }, status: "ready" }, { focus: "theirs", marketView: "new", maxTrades: 4, inPlay: [{ ticker: "aapl" }, { ticker: "nvda", side: "long", trigger: "ORB" }] });
    expect(merged).toMatchObject({ focus: "mine", marketView: "old\n\nnew", maxTrades: 4, status: "ready" });
    expect((merged.inPlay as { ticker: string }[]).map((x) => x.ticker)).toEqual(["AAPL", "NVDA"]);
    expect(eodSummary({ repeat: "a", mood: 3, positions: [1] }, { repeat: "b", stop: "c", mood: 5 })).toEqual({ repeat: "a\n\nb", stop: "c", tomorrow: "", mood: 3, positions: [1] });
    expect(eodLessons({ tradeLessons: [{ tradeId: 5, lesson: "x" }, { tradeId: 0, lesson: "y" }] })).toEqual([{ tradeId: 5, lesson: "x" }]);
    expect(appendText("same", "same")).toBe("same");
    expect(rulePayload({ name: "n", kind: "k", threshold: { n: 3 } })).toEqual({ name: "n", kind: "k", threshold: { n: 3 } });
  });
});
