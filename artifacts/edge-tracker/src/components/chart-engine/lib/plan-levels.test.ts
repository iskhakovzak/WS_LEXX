import { describe, expect, it } from "vitest";
import { planRail } from "./plan-levels";
import type { ChartTheme } from "../theme";

const c = (name: string) => (a = 1) => `${name}/${a}`;
const theme = { up: c("up"), down: c("down") } as unknown as ChartTheme;

describe("plan levels on the trade chart (Волна 2 п. 2.12)", () => {
  it("support in the up colour, resistance in the down colour, dotted; junk dropped", () => {
    expect(planRail([{ price: 10, kind: "support" }, { price: 12, kind: "resistance" }, { price: Number.NaN, kind: "support" }], theme, "Plan")).toEqual([
      { key: "plan0", price: 10, text: "Plan", color: "up/0.75", dash: [2, 3] },
      { key: "plan1", price: 12, text: "Plan", color: "down/0.75", dash: [2, 3] },
    ]);
    expect(planRail(null, theme, "Plan")).toEqual([]);
  });
});
