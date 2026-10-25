// The dashboard layout model: the default composition, migration of the v6 prefs (localStorage, order + hidden), the
// stored block (sanitising what comes from the account), the edit operations and the content layout per width.
import { describe, expect, it } from "vitest";
import {
  addItem, defaultLayout, layoutFromV6, moveItem, moveOnto, removeItem, resizeItem, sanitizeLayout, sectionItems, stepSize,
  TILE_SPECS, variantFor, type DashLayout,
} from "./layout-model";
import { reconcile } from "./dashboard-layout";

const ids = (l: DashLayout) => l.items.map((it) => it.id);

describe("defaultLayout", () => {
  it("every tile is on by default (owner: «по стандарту у всех всё включено»), in section order", () => {
    const l = defaultLayout();
    expect(ids(l)).toEqual([
      "attention", "equity",
      "leaks", "streaks", "seqDay", "afterLoss", "holdTime", "fees", "weekdays",
      "positions", "recent", "desk",
      "brief", "checkin", "sectors", "macro", "dna", "quote", "psychology",
    ]);
    expect(l.items.find((it) => it.id === "leaks")).toEqual({ id: "leaks", size: "l", rows: 2 });
    expect(l.items.find((it) => it.id === "attention")?.size).toBe("s");
  });

  it("staff-only and «Мои»-only tiles are marked", () => {
    expect(TILE_SPECS.desk.staffOnly).toBe(true);
    expect(TILE_SPECS.leaks.meOnly).toBe(true);
    expect(TILE_SPECS.recent.meOnly).toBeUndefined();
  });
});

describe("layoutFromV6 (one-time migration)", () => {
  it("keeps the viewer's order and shown tiles, at default sizes", () => {
    const v6 = {
      order: ["recent", "attention", "equity", "streaks", "leaks", "seqDay", "afterLoss", "holdTime", "fees", "weekdays", "positions", "desk", "checkin", "brief"],
      hidden: ["fees", "checkin", "quote", "sectors", "macro", "dna", "psychology"],
      scope: "me",
    };
    const l = layoutFromV6(v6);
    expect(l).not.toBeNull();
    expect(ids(l as DashLayout)).toEqual(["attention", "equity", "streaks", "leaks", "seqDay", "afterLoss", "holdTime", "weekdays", "recent", "positions", "desk", "brief"]);
  });

  it("a v6 «Команда» default had the own tiles hidden: they come back (they hide on «Команда» by themselves)", () => {
    const l = layoutFromV6({ order: [], hidden: ["leaks", "streaks", "seqDay", "afterLoss", "holdTime", "fees", "weekdays", "checkin"], scope: "team" });
    expect(ids(l as DashLayout)).toEqual(expect.arrayContaining(["leaks", "streaks", "fees"]));
    expect(ids(l as DashLayout)).toContain("weekdays");
    expect(ids(l as DashLayout)).not.toContain("checkin");
  });

  it("unreadable → null (the default is used)", () => {
    expect(layoutFromV6(null)).toBeNull();
    expect(layoutFromV6({ order: "x" })).toBeNull();
  });
});

describe("sanitizeLayout (what comes from the account)", () => {
  it("drops unknown ids and duplicates, clamps sizes to the tile's own, 2 rows only where allowed", () => {
    const l = sanitizeLayout({
      v: 1,
      items: [
        { id: "futureTile", size: "s" },
        { id: "positions", size: "s" },
        { id: "fees", size: "xl" },
        { id: "leaks", size: "l", rows: 2 },
        { id: "leaks", size: "s" },
        { id: "recent", size: "m", rows: 2 },
      ],
    });
    expect(l?.items).toEqual([
      { id: "fees", size: "s" },
      { id: "leaks", size: "l", rows: 2 },
      { id: "positions", size: "xl" },
      { id: "recent", size: "m" },
    ]);
  });

  it("junk → null", () => {
    expect(sanitizeLayout({ v: 2, items: [] })).toBeNull();
    expect(sanitizeLayout("x")).toBeNull();
  });
});

describe("edit operations", () => {
  it("move inside a section only; the others stay", () => {
    const l = moveItem(defaultLayout(), "fees", 0);
    expect(sectionItems(l, "edge").map((it) => it.id)).toEqual(["fees", "leaks", "streaks", "seqDay", "afterLoss", "holdTime", "weekdays"]);
    expect(ids(l).slice(0, 2)).toEqual(["attention", "equity"]);
    expect(moveOnto(defaultLayout(), "fees", "recent")).toEqual(defaultLayout());
  });

  it("remove + undo puts the tile back where it was, at its size", () => {
    const l0 = resizeItem(defaultLayout(), "seqDay", "m");
    const { layout, undo } = removeItem(l0, "seqDay");
    expect(ids(layout)).not.toContain("seqDay");
    const back = undo(layout);
    expect(back).toEqual(l0);
  });

  it("add: at the end of its section by default, at its default size", () => {
    const l = addItem(removeItem(defaultLayout(), "weekdays").layout, "weekdays");
    expect(sectionItems(l, "edge").at(-1)).toEqual({ id: "weekdays", size: "m" });
    const l2 = addItem(removeItem(defaultLayout(), "quote").layout, "quote", { index: 0 });
    expect(sectionItems(l2, "extras").map((it) => it.id)).toEqual(["quote", "brief", "checkin", "sectors", "macro", "dna", "psychology"]);
  });

  it("resize keeps 2 rows only where the size allows it", () => {
    let l = resizeItem(defaultLayout(), "leaks", "xl");
    expect(l.items.find((it) => it.id === "leaks")).toEqual({ id: "leaks", size: "xl" });
    l = resizeItem(l, "leaks", "m", 2);
    expect(l.items.find((it) => it.id === "leaks")).toEqual({ id: "leaks", size: "m", rows: 2 });
  });

  it("+ / − walk the allowed sizes, 2-row steps included", () => {
    expect(stepSize({ id: "seqDay", size: "s" }, 1)).toEqual({ size: "s", rows: 2 });
    expect(stepSize({ id: "seqDay", size: "s", rows: 2 }, 1)).toEqual({ size: "m", rows: 1 });
    expect(stepSize({ id: "seqDay", size: "l" }, 1)).toBeNull();
    expect(stepSize({ id: "seqDay", size: "s" }, -1)).toBeNull();
    expect(stepSize({ id: "positions", size: "xl" }, 1)).toBeNull();
  });
});

describe("variantFor (content layout per packed width)", () => {
  it("12 columns: up to 5 compact, 6–7 medium, 8+ large; a tall compact tile gets its chart", () => {
    expect(variantFor({ size: "s" }, 4, 1, 12)).toBe("s");
    expect(variantFor({ size: "s" }, 5, 1, 12)).toBe("s");
    expect(variantFor({ size: "s" }, 6, 1, 12)).toBe("m");
    expect(variantFor({ size: "m" }, 7, 1, 12)).toBe("m");
    expect(variantFor({ size: "l" }, 8, 1, 12)).toBe("l");
    expect(variantFor({ size: "s" }, 12, 1, 12)).toBe("l");
    expect(variantFor({ size: "s" }, 4, 2, 12)).toBe("m");
  });

  it("tablet halves are medium; phones follow the chosen size", () => {
    expect(variantFor({ size: "s" }, 3, 1, 6)).toBe("m");
    expect(variantFor({ size: "l" }, 6, 1, 6)).toBe("l");
    expect(variantFor({ size: "s" }, 1, 1, 1)).toBe("s");
    expect(variantFor({ size: "m" }, 1, 1, 1)).toBe("m");
    expect(variantFor({ size: "xl" }, 1, 1, 1)).toBe("l");
  });
});

describe("reconcile (server vs this device)", () => {
  const mine = moveItem(defaultLayout(), "fees", 0);
  it("the server's layout wins over a saved local copy", () => {
    expect(reconcile(defaultLayout(), { layout: mine, pending: false })).toEqual({ layout: defaultLayout(), push: false });
  });
  it("an unsaved local edit is written up", () => {
    expect(reconcile(defaultLayout(), { layout: mine, pending: true })).toEqual({ layout: mine, push: true });
  });
  it("nothing on the server (never saved / reset elsewhere) → the default", () => {
    expect(reconcile(null, { layout: mine, pending: false })).toEqual({ layout: defaultLayout(), push: false });
  });
});
