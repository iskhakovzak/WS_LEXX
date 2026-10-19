/** ILYA-16: the trade payload carries the playbook link (trades.playbook_id). */
import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: {}, getAnthropic: () => ({}), isAnthropicConfigured: () => false, AnthropicNotConfiguredError: class extends Error {} }));
process.env.JWT_SECRET ??= "vitest-only-secret";
const { toTradeResponseShape } = await import("../trades");

type Row = Parameters<typeof toTradeResponseShape>[0];
const row = (playbookId: number | null) => ({ id: 1, ticker: "AAPL", date: "2026-10-16", result: "win", createdAt: new Date("2026-10-16T14:00:00Z"), playbookId }) as unknown as Row;

describe("toTradeResponseShape playbookId", () => {
  it("passes the playbook link through (null when unlinked)", () => {
    expect(toTradeResponseShape(row(213)).playbookId).toBe(213);
    expect(toTradeResponseShape(row(null)).playbookId).toBeNull();
  });
});
