import { describe, expect, it } from "vitest";
import { buildDeskDay, type DeskTradeRow } from "../deskDay";
import { deskAliases } from "../deskAliases";
import { computeStructures, type ExecRowLite, type TradeRowLite } from "../tradeStructureStore";
import type { MoneyViewer } from "../playbookPrivacy";

// Real-looking names (Cyrillic and Latin) that must never reach a trader in the anonymous view.
const NAMES = ["Kirill B.", "Roman S.", "Gleb T.", "Pavel K.", "Олег В."];
const DATE = "2026-09-16";
type Row = TradeRowLite & DeskTradeRow;

let seq = 0;
function trade(id: number, trader: string, ticker: string, side: "Long" | "Short", p: Partial<Row> = {}): Row {
  return {
    id, trader, broker_account: null, ticker, date: DATE, side, stop: null, risk_usd: null, qty: null, result: null,
    source: "propreports", context_snapshot: null, entry: null, exit: null, r_multiple: null, pnl: null, fees: null, ...p,
  };
}
const at = (hm: string) => `${DATE}T${String(Number(hm.slice(0, 2)) + 4).padStart(2, "0")}:${hm.slice(3, 5)}:00.000Z`;
const ex = (tradeId: number, kind: ExecRowLite["kind"], price: number, qty: number, hm: string): ExecRowLite => {
  seq++;
  return { id: seq, trade_id: tradeId, kind, price, qty, executed_at: at(hm), sort_order: seq, order_id: null };
};

const meta: Row[] = [
  trade(101, NAMES[0], "META", "Long", { result: "win", pnl: 50, fees: 2, r_multiple: 1 }),
  trade(102, NAMES[1], "META", "Short", { result: "win", pnl: 300, fees: 5, r_multiple: 3 }),
  trade(103, NAMES[2], "META", "Long", { result: "loss", pnl: -150, fees: 3, r_multiple: -1.5 }),
];
const metaEx = [
  ex(101, "entry", 670, 100, "09:40"), ex(101, "exit", 671, 100, "09:55"),
  ex(102, "entry", 675, 100, "09:45"), ex(102, "exit", 672, 100, "10:10"),
  ex(103, "entry", 674, 200, "10:20"), ex(103, "exit", 673.2, 200, "10:50"),
];
const amd: Row[] = [
  trade(201, NAMES[1], "AMD", "Long", { result: "loss", pnl: -40, fees: 1, r_multiple: -0.5 }),
  trade(202, NAMES[3], "AMD", "Long", { result: "win", pnl: 90, fees: 1, r_multiple: 1.2 }),
];
const amdEx = [ex(201, "entry", 160, 300, "09:35"), ex(201, "exit", 159.8, 300, "09:50"), ex(202, "entry", 160.1, 200, "09:36"), ex(202, "exit", 160.6, 200, "10:05")];

// Desk-wide roster of the day (includes a trader who traded neither ticker).
const aliases = deskAliases(NAMES, DATE);
const asKirill: MoneyViewer = { name: NAMES[0], staff: false };
const asStaff: MoneyViewer = { name: "Admin", staff: true };
const build = (rows: Row[], execs: ExecRowLite[], v: MoneyViewer, hideNames: boolean) =>
  buildDeskDay(rows[0].ticker, DATE, rows, computeStructures(rows, execs), v, { hideNames, aliases });

describe("desk-day views — anonymous (names hidden from traders)", () => {
  const day = build(meta, metaEx, asKirill, true);

  it("no real name anywhere in the trader's JSON (rows, trades, takeaways, office, me)", () => {
    const json = JSON.stringify(day);
    for (const n of NAMES) expect(json).not.toContain(n);
    expect(day.view).toBe("anonymous");
    expect(day.traders.every((t) => /^t\d+$/.test(t.name))).toBe(true);
    expect(day.trades.every((t) => /^t\d+$/.test(t.trader))).toBe(true);
  });

  it("own row is marked «me»; only the own row and own trades reach a trader (owner rule 2026-10-21)", () => {
    const me = day.traders.find((t) => t.me)!;
    expect(me.name).toBe(`t${aliases.get(NAMES[0])}`);
    expect(day.me).toBe(me.name);
    expect(day.traders.map((t) => t.name)).toEqual([me.name]);
    expect(day.trades.map((t) => t.id)).toEqual([101]);
  });

  it("own $ kept; the office walk is a desk aggregate (>= 3 traders), its size staff-only", () => {
    expect(day.trades.every((t) => !t.redacted && t.net != null && t.qty != null)).toBe(true);
    expect(day.office?.net).toBe(190); // a sum over 3 traders (lib/moneyVisibility canSeeDeskAggregate)
    expect(day.office?.peakShares).toBeNull(); // office size stays staff-only
    expect(day.office?.contributors.every((c) => c.trader === day.me)).toBe(true);
    const two = build(amd, amdEx, { name: NAMES[1], staff: false }, true);
    expect(two.office).toBeNull(); // 2 traders: the aggregate would reveal the other one
    expect(two.traders.map((t) => t.alias)).toEqual([aliases.get(NAMES[1])]);
    expect(build(meta, metaEx, asStaff, true).trades.every((t) => t.net != null)).toBe(true);
  });

  it("the same trader has the same alias on two tickers of one day", () => {
    const asRoman: MoneyViewer = { name: NAMES[1], staff: false };
    const m = build(meta, metaEx, asRoman, true);
    const a = build(amd, amdEx, asRoman, true);
    expect(m.me).not.toBeNull();
    expect(m.me).toBe(a.me);
    expect(build(amd, amdEx, asKirill, true).me).toBeNull(); // the viewer did not trade AMD
    expect(JSON.stringify(a)).not.toContain(NAMES[1]);
  });
});

describe("desk-day views — staff and named", () => {
  it("staff see names, $ and the office size", () => {
    const s = build(meta, metaEx, asStaff, true);
    expect(s.view).toBe("staff");
    expect(s.traders.map((t) => t.name).sort()).toEqual([NAMES[0], NAMES[1], NAMES[2]].sort());
    expect(s.traders.every((t) => t.alias === aliases.get(t.name))).toBe(true);
    expect(s.office?.peakShares).not.toBeNull();
    expect(s.office?.contributors.every((c) => NAMES.includes(c.trader) && c.alias === aliases.get(c.trader))).toBe(true);
  });

  it("setting off: own name and trades only; office $ only with >= 3 traders", () => {
    const n = build(meta, metaEx, asKirill, false);
    expect(n.view).toBe("named");
    expect(n.trades.map((t) => t.trader)).toEqual([NAMES[0]]);
    expect(n.traders.map((t) => t.name)).toEqual([NAMES[0]]);
    expect(n.office?.net).toBe(190);
    expect(build(amd, amdEx, { name: NAMES[1], staff: false }, false).office).toBeNull();
  });
});
