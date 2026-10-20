import { describe, expect, it } from "vitest";
import type { Trade } from "@workspace/api-client-react";
import { mergeTradeLists, tradesWindowParams } from "./use-trades-window";

const tr = (id: number): Trade => ({ id, date: "2026-10-01", result: "win" }) as unknown as Trade;

describe("use-trades-window (DEV-01)", () => {
  it("the previous window is a bounded request", () => {
    expect(tradesWindowParams({ from: "2026-04-23", to: "2026-07-21" })).toEqual({ from: "2026-04-23", to: "2026-07-21" });
    expect(tradesWindowParams({ from: "2026-07-22", trader: "Ориф" })).toEqual({ from: "2026-07-22", trader: "Ориф" });
    // Волна 2 п. 2.15: the server never returns the whole book — «Всё время» asks for the newest 5000 (the API cap).
    expect(tradesWindowParams({ from: null })).toEqual({ limit: 5000 });
    expect(tradesWindowParams({ trader: "Ориф", limit: 20 })).toEqual({ trader: "Ориф", limit: 20 });
    // A window wider than 400 days (the API answers 400) → newest 5000, cut client-side by `select`.
    expect(tradesWindowParams({ from: "2024-01-01", to: "2026-10-20" })).toEqual({ limit: 5000 });
    expect(tradesWindowParams({ from: "2025-10-01" }, "2026-10-20")).toEqual({ from: "2025-10-01" });
    expect(tradesWindowParams({ from: "2025-01-01" }, "2026-10-20")).toEqual({ limit: 5000 });
  });

  it("current ∪ previous without duplicates; nothing until the current window is there", () => {
    expect(mergeTradeLists(undefined, [tr(1)])).toBeUndefined();
    expect(mergeTradeLists([tr(1), tr(2)], undefined)!.map((t) => t.id)).toEqual([1, 2]);
    expect(mergeTradeLists([tr(1), tr(2)], [tr(2), tr(3)])!.map((t) => t.id)).toEqual([1, 2, 3]);
  });
});
