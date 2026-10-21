import { describe, expect, it } from "vitest";
import type { PreviewTrade, RuleType } from "./rules";
import { CAP_FIELDS, EXCLUDE_FIELDS, STOP_FIELDS, fieldsFor, mistakeOptions, tagOptions } from "./builder-fields";

const mk = (id: number, extra: Partial<PreviewTrade> = {}): PreviewTrade => ({
  id, day: "2026-10-01", entryMin: 600 + id, ticker: "AAA", side: "long", qty: 100, entry: 10, gross: 1, fees: 0, holdSec: 60, seq: id, ...extra,
});
const ALL = new Set<RuleType>([...EXCLUDE_FIELDS, ...STOP_FIELDS, ...CAP_FIELDS].map((f) => f.requires));
const ids = (mode: "exclude" | "stop" | "cap", trades: PreviewTrade[], team = false, supported: ReadonlySet<RuleType> = ALL) => fieldsFor(mode, trades, supported, team).map((f) => f.id);

describe("builder fields", () => {
  it("IMX / re-entry / mistakes / tags only when the loaded trades have them", () => {
    expect(ids("exclude", [mk(1)])).toEqual(["time", "ticker", "hold", "price", "size", "side", "afterLoss"]);
    const rich = [mk(1, { imx: true, reentry: true, mistakes: ["fomo"], ptags: ["news"] }), mk(2)];
    expect(ids("exclude", rich)).toEqual(["time", "ticker", "hold", "price", "size", "side", "afterLoss", "imx", "reentry", "mistake", "tag"]);
  });

  it("personal tags are not offered for the whole team", () => {
    expect(ids("exclude", [mk(1, { ptags: ["news"] })], true)).not.toContain("tag");
  });

  it("«вход без стопа» needs stops marked on ≥ 15% of the trades", () => {
    const trades = (withStop: number) => Array.from({ length: 20 }, (_, i) => mk(i, { hasStop: i < withStop ? true : false }));
    expect(ids("exclude", trades(2))).not.toContain("noStop");
    expect(ids("exclude", trades(3))).toContain("noStop");
  });

  it("every field follows the server's rule types", () => {
    const old = new Set<RuleType>(["timeWindow", "capLoss", "dailyLossLimit"]);
    expect(ids("exclude", [mk(1, { imx: true })], false, old)).toEqual(["time"]);
    expect(ids("stop", [mk(1)], false, old)).toEqual(["dayLoss"]);
    expect(ids("cap", [mk(1, { sizeRel: 3 })], false, old)).toEqual(["cap"]);
    expect(ids("stop", [mk(1)])).toEqual(["dayLoss", "profitTarget", "lossRun", "maxTrades"]);
    expect(ids("cap", [mk(1, { sizeRel: 3 })])).toEqual(["cap", "sizeRel"]);
    expect(ids("cap", [mk(1)])).toEqual(["cap"]);
  });

  it("choices: mistakes and personal tags by count", () => {
    const trades = [mk(1, { mistakes: ["revenge"], ptags: ["News"] }), mk(2, { mistakes: ["fomo", "revenge"], ptags: ["news", "halt"] })];
    expect(mistakeOptions(trades).map((o) => o.value)).toEqual(["revenge", "fomo"]);
    expect(mistakeOptions(trades)[1].label).toBe("FOMO / погоня");
    expect(tagOptions(trades)).toEqual([{ value: "News", label: "News" }, { value: "halt", label: "halt" }]);
  });

  it("mistakes: only the ones known at the entry (exit / outcome marks would make a circular «what if»)", () => {
    const trades = [mk(1, { mistakes: ["heldLoser", "lateExit", "earlyExit", "movedStop", "averagingDown"] }), mk(2, { mistakes: ["heldLoser", "oversize"] })];
    expect(mistakeOptions(trades).map((o) => o.value)).toEqual(["oversize"]);
    expect(ids("exclude", [mk(1, { mistakes: ["heldLoser"] })])).not.toContain("mistake");
  });

  it("tags: none longer than a rule takes (60 chars)", () => {
    const long = "earnings gap continuation after the open with heavy premarket volume";
    expect(tagOptions([mk(1, { ptags: [long, "news"] }), mk(2, { ptags: [long] })])).toEqual([{ value: "news", label: "news" }]);
    expect(ids("exclude", [mk(1, { ptags: [long] })])).not.toContain("tag");
  });

  it("builds the rules", () => {
    const f = (id: string) => [...EXCLUDE_FIELDS, ...STOP_FIELDS, ...CAP_FIELDS].find((x) => x.id === id)!;
    expect(f("imx").build("is", "")).toEqual({ type: "excludeImx" });
    expect(f("mistake").build("", "fomo")).toEqual({ type: "excludeMistakes", codes: ["fomo"] });
    expect(f("mistake").build("", "nope")).toBeNull();
    expect(f("tag").build("", " news ")).toEqual({ type: "excludeTags", tags: ["news"] });
    expect(f("profitTarget").build("", "250")).toEqual({ type: "dailyProfitTarget", usd: 250 });
    expect(f("sizeRel").build("", "2")).toEqual({ type: "maxSizeRel", x: 2 });
    expect(f("sizeRel").build("", "6")).toBeNull();
  });
});
