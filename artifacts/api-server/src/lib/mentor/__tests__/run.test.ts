/**
 * The mentor's model call without the network (scripted client): the cost plan per kind (default model, the advisor
 * only for the debrief / weekly), the cached frozen prompt, structured output, one retry on an answer that does not
 * fit, and the JSON-schema twin accepting what the validator accepts. Plus the pure helpers of the service.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {}, pool: { query: vi.fn(async () => ({ rows: [] })) } }));

const { callMentor, mentorPlan, __resetMentorSupport, MentorInvalid } = await import("../run");
const { JSON_SCHEMAS, parseMentor } = await import("../schema");
const { mentorSystem } = await import("../prompt");
const { historyTurns, proposalParams } = await import("../service");
const { phaseOf } = await import("../../../routes/mentor");
const { scriptedClient } = await import("../../assistant/__tests__/scripted");
import type { RouteSettings } from "../../assistant/models";

const S: RouteSettings = { defaultModel: "claude-haiku-5-5", smartModel: "claude-sonnet-5-5", autoEscalate: true, advisorEnabled: true, advisorModel: "claude-sonnet-5-5", multiplier: 5 };
const BRIEF = { headline: "Range day: trade smaller", points: ["Your edge in range: -$12.40 a day (preliminary)"], ruleToday: "After a loss, 10 minutes off", setupIds: [3] };
const DEBRIEF = {
  summary: "6 trades, -$84.20", vsPlan: "The pause after losses held 2 of 3 times", lesson: "The 10:41 re-entry came 2 minutes after a loss",
  praise: null, challenge: "Stop after two losses in a row",
  ruleTomorrow: { kind: "stop_after_losses", minutes: null, count: 2, usd: null, time: null, text: "Two losses in a row: done for the day", replaceId: null },
  notes: [{ kind: "goal", body: "Wants to reach the Trader stage by December" }],
};
const system = (kind: "brief" | "debrief") => [{ type: "text" as const, text: mentorSystem(kind) }];
const user = [{ role: "user" as const, content: "<mentor_request kind=\"brief\" />" }];

beforeEach(() => __resetMentorSupport());

describe("mentor model call", () => {
  it("brief: the default model alone, frozen prompt cached, structured output", async () => {
    const client = scriptedClient([{ text: JSON.stringify(BRIEF), usage: { input: 1200, output: 150, cacheRead: 3000 } }]);
    const out = await callMentor({ client, settings: S, kind: "brief", system: system("brief"), messages: user, signal: new AbortController().signal });
    expect(out.value.ruleToday).toBe(BRIEF.ruleToday);
    expect(out.deep).toBe(false);
    const p = client.calls[0]!;
    expect(p.model).toBe("claude-haiku-5-5");
    expect(p.tools).toBeUndefined();
    expect(p.system[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(p.output_config).toMatchObject({ effort: "low", format: { type: "json_schema", schema: JSON_SCHEMAS.brief } });
    expect(out.units).toBe(1200 + 150); // cache reads are not counted
  });

  it("debrief: the advisor joins; an answer that does not fit is retried once", async () => {
    const client = scriptedClient([{ text: "{\"summary\": 1}" }, { text: JSON.stringify(DEBRIEF) }]);
    const out = await callMentor({ client, settings: S, kind: "debrief", system: system("debrief"), messages: user, signal: new AbortController().signal });
    expect(client.calls).toHaveLength(2);
    expect(client.calls[0]!.tools?.[0]).toMatchObject({ type: "advisor_20260301", model: "claude-sonnet-5-5" });
    expect(out.deep).toBe(true);
    expect(out.value.ruleTomorrow?.count).toBe(2);
    const bad = scriptedClient([{ text: "not json" }]);
    await expect(callMentor({ client: bad, settings: S, kind: "brief", system: system("brief"), messages: user, signal: new AbortController().signal })).rejects.toBeInstanceOf(MentorInvalid);
    expect(bad.calls).toHaveLength(2);
  });

  it("the plan never boosts and drops the advisor when the desk turns it off", () => {
    expect(mentorPlan("chat", S)).toMatchObject({ model: "claude-haiku-5-5", advisor: null });
    expect(mentorPlan("weekly", { ...S, advisorEnabled: false })).toMatchObject({ model: "claude-haiku-5-5", advisor: null, effort: "medium" });
  });

  it("the JSON schema twins name every field the validator needs", () => {
    for (const [kind, sample] of [["brief", BRIEF], ["debrief", DEBRIEF]] as const) {
      expect(parseMentor(kind, JSON.stringify(sample)).ok).toBe(true);
      const props = (JSON_SCHEMAS[kind] as { properties: Record<string, unknown>; required: string[] });
      expect(props.required.sort()).toEqual(Object.keys(sample).sort());
    }
  });
});

describe("service helpers", () => {
  it("a proposal with parameters that do not fit becomes a custom commitment", () => {
    expect(proposalParams({ ...DEBRIEF.ruleTomorrow, kind: "stop_after_losses" })).toEqual({ kind: "stop_after_losses", params: { count: 2 } });
    expect(proposalParams({ ...DEBRIEF.ruleTomorrow, kind: "pause_after_loss", minutes: null })).toEqual({ kind: "custom", params: {} });
  });

  it("history starts with the trader and merges consecutive turns; the page phase follows the NY clock", () => {
    const m = (id: number, role: "user" | "mentor", content: string) => ({ id, role, kind: "chat" as const, content, createdAt: "" });
    expect(historyTurns([m(1, "mentor", "brief"), m(2, "user", "a"), m(3, "user", "b"), m(4, "mentor", "c")])).toEqual([
      { role: "user", content: "a\n\nb" }, { role: "assistant", content: "c" },
    ]);
    expect([phaseOf(8 * 60), phaseOf(11 * 60), phaseOf(16 * 60 + 5)]).toEqual(["pre", "session", "post"]);
  });
});
