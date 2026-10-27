// Shared chart style: heat scale (empty ≠ break-even ≠ profit / loss), zero split of P&L curves, the glass tooltip
// adapter (keeps recharts' formatter contract) and the heat calendar grid (one tab stop, week column, legend).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HEAT_FLAT, heatFill, heatKind, heatLevel, heatRamp } from "./heat";
import { pnlColor, zeroOffset } from "./theme";
import { pnlPaint } from "./gradient";
import { GlassTooltip } from "./tooltip";
import { HeatCalendar, type HeatWeek } from "./heat-calendar";

describe("heat scale", () => {
  it("keeps no-trade, break-even and signed days apart", () => {
    expect(heatKind(null, false)).toBe("empty");
    expect(heatKind(120, false)).toBe("empty");
    expect(heatKind(0, true)).toBe("flat");
    expect(heatKind(null, true)).toBe("flat");
    expect(heatKind(5, true)).toBe("up");
    expect(heatKind(-5, true)).toBe("down");
  });

  it("scales intensity by |value| relative to the period max on a square-root curve", () => {
    expect(heatLevel(0, 100)).toBe(0);
    expect(heatLevel(100, 100)).toBe(1);
    expect(heatLevel(-25, 100)).toBeCloseTo(0.5);
    expect(heatLevel(500, 100)).toBe(1);
    expect(heatLevel(10, 0)).toBe(0);
  });

  it("colours from the theme tokens: profit / loss hues, nothing for zero", () => {
    expect(heatFill(100, 100)).toBe("hsl(var(--up) / 0.62)");
    expect(heatFill(-100, 100)).toBe("hsl(var(--down) / 0.62)");
    expect(heatFill(-1, 100)).toMatch(/^hsl\(var\(--down\) \/ 0\.\d+\)$/);
    expect(heatFill(0, 100)).toBeUndefined();
    expect(heatFill(3, 3, "accent")).toBe("hsl(var(--primary) / 0.62)");
    expect(HEAT_FLAT).toContain("--muted-foreground");
    const ramp = heatRamp("up");
    expect(ramp).toHaveLength(4);
    expect(ramp[3]).toBe("hsl(var(--up) / 0.62)");
  });
});

describe("P&L curve split at zero", () => {
  it("puts the zero stop where the curve crosses zero", () => {
    expect(zeroOffset([300, -100])).toBeCloseTo(0.75);
    expect(zeroOffset([1, 2, 3])).toBe(1);
    expect(zeroOffset([-1, -2])).toBe(0);
    expect(zeroOffset([])).toBe(1);
  });

  it("uses split gradients when the curve crosses zero and a solid tone otherwise", () => {
    const split = pnlPaint("eq", [-10, 20]);
    expect(split.stroke).toBe("url(#eq-line)");
    expect(split.fill).toBe("url(#eq-fill)");
    const up = pnlPaint("eq", [5, 20]);
    expect(up.stroke).toBe("hsl(var(--up))");
    const down = pnlPaint("eq", [-5, -20]);
    expect(down.stroke).toBe("hsl(var(--down))");
    const flat = pnlPaint("eq", [0, 0]);
    expect(flat.stroke).toBe(pnlColor(0));
  });
});

describe("glass tooltip", () => {
  it("applies the Tooltip formatter / labelFormatter and colours P&L by sign", () => {
    const html = renderToStaticMarkup(createElement(GlassTooltip, {
      active: true,
      label: "2026-10-15",
      payload: [{ name: "equity", value: -42, dataKey: "equity", color: "hsl(var(--up))", payload: { step: 12 } }],
      labelFormatter: ((l: string) => `day ${l}`) as never,
      formatter: ((v: number) => [`$${v}`, "Cumulative"]) as never,
      tone: "pnl",
      delta: (r) => r.step as number,
      deltaFormat: (v) => `+${v}`,
      deltaLabel: "Day",
    }));
    expect(html).toContain("day 2026-10-15");
    expect(html).toContain("Cumulative");
    expect(html).toContain("text-down");
    expect(html).toContain("$-42");
    expect(html).toContain("text-up");
    expect(html).toContain("+12");
    expect(html).toContain("glass-thick");
    expect(html).toContain("tabular-nums");
  });

  it("renders nothing when inactive", () => {
    expect(renderToStaticMarkup(createElement(GlassTooltip, { active: false, payload: [] }))).toBe("");
  });
});

describe("heat calendar", () => {
  const day = (date: string, n: number, over: Partial<HeatWeek["days"][number]> = {}) => ({
    date, dayNum: n, inMonth: true, traded: false, value: null, label: date, ...over,
  });
  const weeks: HeatWeek[] = [
    {
      key: "w1",
      days: [
        day("2026-10-05", 5, { traded: true, value: -210, valueText: "−$210" }),
        day("2026-10-06", 6, { disabled: true }),
        day("2026-10-07", 7, { traded: true, value: 0, valueText: "$0", active: true }),
        day("2026-10-08", 8, { traded: true, value: 336, valueText: "+$336" }),
        day("2026-10-09", 9, { inMonth: false }),
      ],
      total: { value: 126, text: "+$126", label: "week" },
    },
  ];
  const html = renderToStaticMarkup(createElement(HeatCalendar, {
    weeks, weekdays: ["Mo", "Tu", "We", "Th", "Fr"], max: 336, ariaLabel: "October 2026",
  }));

  it("is one tab stop (the active day) inside an ARIA grid with a week column", () => {
    expect(html).toContain('role="grid"');
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-pressed="true"[^>]*tabindex="0"|tabindex="0"[^>]*aria-pressed="true"/);
    expect(html).toContain("+$126");
    expect(html.match(/role="columnheader"/g)).toHaveLength(6);
  });

  it("draws empty days dashed, break-even neutral and P&L days tinted", () => {
    expect(html).toContain("border-dashed");
    expect(html).toContain(HEAT_FLAT);
    expect(html).toContain("hsl(var(--up) / 0.62)");
    expect(html).toMatch(/hsl\(var\(--down\) \/ 0\.\d+\)/);
  });
});
