import { describe, expect, it } from "vitest";
import type { Trade } from "@workspace/api-client-react";
import { feeShareText, linkedPlaybookId, stopIsEstimate } from "../sheet-model";
import { shownExitEfficiency } from "@/components/replay/types";

describe("trade sheet / list helpers", () => {
  it("a broker trade whose stop equals its exit has an estimated stop and R (MAKSIM-25)", () => {
    expect(stopIsEstimate({ source: "propreports", stop: 705.09, exit: 705.09 })).toBe(true);
    expect(stopIsEstimate({ source: "propreports", stop: 704.5, exit: 705.09 })).toBe(false);
    expect(stopIsEstimate({ source: "manual", stop: 705.09, exit: 705.09 })).toBe(false);
    expect(stopIsEstimate({ source: "propreports", stop: null, exit: 705.09 })).toBe(false);
  });

  it("fees share of gross: hidden without a positive gross, capped above 100 % (ILYA-25)", () => {
    expect(feeShareText(20.52, 37.05)?.share).toBeCloseTo(0.5538, 3);
    expect(feeShareText(24.14, 1.5)?.text.startsWith(">")).toBe(true);
    expect(feeShareText(5, 0)).toBeNull();
    expect(feeShareText(5, -10)).toBeNull();
    expect(feeShareText(null, 10)).toBeNull();
  });

  it("the linked playbook setup comes from the trade's playbookId when the API sends it (ILYA-16)", () => {
    expect(linkedPlaybookId({ playbookId: 192 } as unknown as Trade)).toBe(192);
    expect(linkedPlaybookId({ playbookId: "7" } as unknown as Trade)).toBe(7);
    expect(linkedPlaybookId({} as Trade)).toBeNull();
  });

  it("a closed trade that was never in profit shows 0 % exit efficiency; an open one stays empty (ILYA-03)", () => {
    expect(shownExitEfficiency({ exitEfficiency: null, captured: { perShare: -0.51, r: null, usd: -10.2 } })).toBe(0);
    expect(shownExitEfficiency({ exitEfficiency: null, captured: null })).toBeNull();
    expect(shownExitEfficiency({ exitEfficiency: 0.42, captured: { perShare: 0.2, r: null, usd: 4 } })).toBe(0.42);
  });
});
