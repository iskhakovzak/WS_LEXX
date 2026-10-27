// Bento packing (pack.ts): the layout fixtures the owner asked for — every tile, half removed, a single tile, odd
// mixes of sizes — on 12 / 6 / 1 columns, plus invariants over random layouts (no overlaps, no holes, reading order).
import { describe, expect, it } from "vitest";
import { asciiPack, packTiles, spanFor, type PackInput, type Placed } from "./pack";
import { defaultLayout, sectionItems, TILE_SPECS, type TileSize } from "./layout-model";

const T = (id: string, size: TileSize, rows?: 1 | 2): PackInput => ({ id, size, rows });
const pic = (items: PackInput[], cols = 12) => asciiPack(packTiles(items, cols), cols);

function invariants(placed: Placed[], cols: number) {
  const rows = placed.reduce((m, p) => Math.max(m, p.y + p.h), 0);
  const cells = new Map<string, string>();
  for (const p of placed) {
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x + p.w).toBeLessThanOrEqual(cols);
    for (let y = p.y; y < p.y + p.h; y++) {
      for (let x = p.x; x < p.x + p.w; x++) {
        const k = `${x}:${y}`;
        expect(cells.has(k), `overlap at ${k}`).toBe(false);
        cells.set(k, p.id);
      }
    }
  }
  expect(cells.size, "holes").toBe(rows * cols);
  // Reading order (row, then column) is the list order.
  for (let i = 1; i < placed.length; i++) {
    const a = placed[i - 1], b = placed[i];
    expect(b.y > a.y || (b.y === a.y && b.x > a.x), `order ${a.id} → ${b.id}`).toBe(true);
  }
}

describe("spanFor", () => {
  it("12 columns: S/M/L/XL = 4/6/8/12; tablet: S, M half, L, XL full; phone: 1", () => {
    expect((["s", "m", "l", "xl"] as const).map((s) => spanFor(s, 12))).toEqual([4, 6, 8, 12]);
    expect((["s", "m", "l", "xl"] as const).map((s) => spanFor(s, 6))).toEqual([3, 3, 6, 6]);
    expect((["s", "m", "l", "xl"] as const).map((s) => spanFor(s, 1))).toEqual([1, 1, 1, 1]);
  });
});

describe("the default dashboard (all tiles)", () => {
  const edge = sectionItems(defaultLayout(), "edge").map((it) => T(it.id, it.size, it.rows));

  it("«Ваш edge»: «Где уходят деньги» L × 2 rows with «Серия» and «Номер сделки» beside it, three compact tiles, then «Дни недели» across", () => {
    expect(pic(edge)).toEqual([
      "AAAAAAAABBBB",
      "AAAAAAAACCCC",
      "DDDDEEEEFFFF",
      "GGGGGGGGGGGG",
    ]);
  });

  it("«Режим рынка» and the «Ментор» line across, then «План на день» S + «Кривая капитала» M share the row 5 / 7", () => {
    const plan = sectionItems(defaultLayout(), "plan").map((it) => T(it.id, it.size, it.rows));
    expect(pic(plan)).toEqual(["AAAAAAAAAAAA", "BBBBBBBBBBBB", "CCCCCDDDDDDD"]);
  });

  it("«Сделки»: positions full width, recent M + desk M share the row", () => {
    const trades = sectionItems(defaultLayout(), "trades").map((it) => T(it.id, it.size, it.rows));
    expect(pic(trades)).toEqual(["AAAAAAAAAAAA", "BBBBBBCCCCCC"]);
  });

  it("tablet: halves; the full-width tall tile has no neighbour, so it is one row", () => {
    expect(pic(edge, 6)).toEqual([
      "AAAAAA",
      "BBBCCC",
      "DDDEEE",
      "FFFGGG",
    ]);
    invariants(packTiles(edge, 6), 6);
  });

  it("phone: one column in order, no 2-row tiles", () => {
    const placed = packTiles(edge, 1);
    expect(placed.map((p) => [p.y, p.h])).toEqual(edge.map((_, i) => [i, 1]));
  });
});

describe("removing tiles never leaves holes", () => {
  it("half removed: L × 2 + one compact → the compact one grows down beside it", () => {
    expect(pic([T("leaks", "l", 2), T("streaks", "s")])).toEqual([
      "AAAAAAAABBBB",
      "AAAAAAAABBBB",
    ]);
  });

  it("half removed: three compact tiles left → one row of thirds", () => {
    expect(pic([T("a", "s"), T("b", "s"), T("c", "s")])).toEqual(["AAAABBBBCCCC"]);
  });

  it("a lonely compact tile at the end of a section takes the whole row (grown)", () => {
    const placed = packTiles([T("a", "s"), T("b", "s"), T("c", "s"), T("d", "s")], 12);
    expect(asciiPack(placed, 12)).toEqual(["AAAABBBBCCCC", "DDDDDDDDDDDD"]);
    expect(placed[3].grown).toBe(true);
    expect(placed[0].grown).toBe(false);
  });

  it("two compact tiles share the row 6 / 6", () => {
    expect(pic([T("a", "s"), T("b", "s")])).toEqual(["AAAAAABBBBBB"]);
  });

  it("only one tile: the whole row; a tall one is shortened", () => {
    expect(pic([T("a", "s")])).toEqual(["AAAAAAAAAAAA"]);
    const placed = packTiles([T("a", "l", 2)], 12);
    expect(asciiPack(placed, 12)).toEqual(["AAAAAAAAAAAA"]);
    expect(placed[0].shortened).toBe(true);
  });

  it("nothing → nothing", () => {
    expect(packTiles([], 12)).toEqual([]);
  });
});

describe("odd mixes of sizes", () => {
  it("M + M + S: two halves, then the S alone fills its row", () => {
    expect(pic([T("a", "m"), T("b", "m"), T("c", "s")])).toEqual(["AAAAAABBBBBB", "CCCCCCCCCCCC"]);
  });

  it("S + L tall + S + S: the tall tile in the middle, compact tiles around it", () => {
    const placed = packTiles([T("a", "s"), T("b", "l", 2), T("c", "s"), T("d", "s")], 12);
    invariants(placed, 12);
    expect(asciiPack(placed, 12)).toEqual([
      "AAAABBBBBBBB",
      "CCCCBBBBBBBB",
      "DDDDDDDDDDDD",
    ]);
  });

  it("M tall + S: the S grows to fill the space beside it", () => {
    const placed = packTiles([T("a", "m", 2), T("b", "s")], 12);
    invariants(placed, 12);
    expect(asciiPack(placed, 12)).toEqual(["AAAAAABBBBBB", "AAAAAABBBBBB"]);
  });

  it("L tall + S + M: the S grows down, the M takes the next row", () => {
    expect(pic([T("a", "l", 2), T("b", "s"), T("c", "m")])).toEqual([
      "AAAAAAAABBBB",
      "AAAAAAAABBBB",
      "CCCCCCCCCCCC",
    ]);
  });

  it("XL, S, S, S, L, S: rows stay full", () => {
    expect(pic([T("a", "xl"), T("b", "s"), T("c", "s"), T("d", "s"), T("e", "l"), T("f", "s")])).toEqual([
      "AAAAAAAAAAAA",
      "BBBBCCCCDDDD",
      "EEEEEEEEFFFF",
    ]);
  });

  it("two tall tiles side by side", () => {
    expect(pic([T("a", "m", 2), T("b", "m", 2), T("c", "s")])).toEqual([
      "AAAAAABBBBBB",
      "AAAAAABBBBBB",
      "CCCCCCCCCCCC",
    ]);
  });
});

describe("invariants over random layouts", () => {
  // Small deterministic PRNG (mulberry32) so a failure is reproducible.
  function rng(seed: number) {
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const sizes: TileSize[] = ["s", "m", "l", "xl"];

  for (const cols of [12, 6, 1]) {
    it(`${cols} columns: 400 random sections pack without holes or overlaps, in order`, () => {
      const rand = rng(cols * 7919);
      for (let n = 0; n < 400; n++) {
        const count = 1 + Math.floor(rand() * 9);
        const items = Array.from({ length: count }, (_, i) => {
          const size = sizes[Math.floor(rand() * sizes.length)];
          return T(`t${i}`, size, size !== "xl" && rand() < 0.3 ? 2 : 1);
        });
        invariants(packTiles(items, cols), cols);
      }
    });
  }

  it("every tile spec's default size is one of its sizes", () => {
    for (const spec of Object.values(TILE_SPECS)) expect(spec.sizes).toContain(spec.size);
  });
});
