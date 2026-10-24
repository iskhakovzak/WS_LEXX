/**
 * Bento packing for the dashboard sections: tiles in their order and size → grid rectangles on 12 columns (desktop),
 * 6 (tablet) or 1 (phone), with no holes and no ragged rows, whatever was removed.
 *
 *  1. Place in order with a forward cursor (CSS auto-placement): reading order = list order, so keyboard and screen
 *     readers follow what the eye sees; a 2-row tile takes the next free spot, and the following tiles fill the
 *     column beside it.
 *  2. A 2-row tile with nothing beside it is shortened to one row (it would only be a tall stripe).
 *  3. Rows of one-row tiles are justified: the free columns are shared out evenly (S + M = 5 + 7, S + S = 6 + 6, a lone
 *     tile takes the whole row — «растянута»).
 *  4. Holes next to 2-row tiles: the tile above grows down, a neighbour grows sideways.
 *  5. Anything still unfilled → shorten the 2-row tile nearest to it and pack again (terminates: all one-row tiles
 *     always justify).
 * Equal heights per row come from CSS grid (auto rows, stretch).
 */
import { SIZE_SPAN, type TileSize } from "./layout-model";

export type PackInput = { id: string; size: TileSize; rows?: 1 | 2 };
export type Placed = {
  id: string;
  /** 0-based column / row and spans. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Wider or taller than its size asked for (filled a row / a hole). */
  grown: boolean;
  /** Columns added to fill its row (S + M = 5 + 7 adds 1 each; a lone S on 12 columns adds 8). */
  growth: number;
  /** Asked for 2 rows, got 1. */
  shortened: boolean;
};

/** Columns of a size on a 12 / 6 / 1-column grid: on tablets S and M take half the row, L and XL all of it. */
export function spanFor(size: TileSize, cols: number): number {
  if (cols >= 12) return SIZE_SPAN[size];
  if (cols <= 1) return 1;
  const half = Math.max(1, Math.floor(cols / 2));
  return size === "s" || size === "m" ? half : cols;
}

type Rect = { i: number; x: number; y: number; w: number; h: number };

function place(items: { w: number; h: number }[], cols: number): Rect[] {
  const grid: boolean[][] = [];
  const taken = (x: number, y: number) => !!grid[y]?.[x];
  const fits = (x: number, y: number, w: number, h: number) => {
    if (x + w > cols) return false;
    for (let r = y; r < y + h; r++) for (let c = x; c < x + w; c++) if (taken(c, r)) return false;
    return true;
  };
  const rects: Rect[] = [];
  let cx = 0;
  let cy = 0;
  items.forEach((it, i) => {
    const w = Math.min(it.w, cols);
    const h = it.h;
    let x = cx;
    let y = cy;
    while (!fits(x, y, w, h)) {
      x++;
      if (x + w > cols) { x = 0; y++; }
    }
    for (let r = y; r < y + h; r++) {
      grid[r] ??= [];
      for (let c = x; c < x + w; c++) grid[r][c] = true;
    }
    rects.push({ i, x, y, w, h });
    cx = x + w;
    cy = y;
    if (cx >= cols) { cx = 0; cy = y + 1; }
  });
  return rects;
}

const covers = (r: Rect, x: number, y: number) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
const at = (rects: Rect[], x: number, y: number) => rects.find((r) => covers(r, x, y));
const rowsOf = (rects: Rect[]) => rects.reduce((m, r) => Math.max(m, r.y + r.h), 0);

/** Every free cell inside the used rows. */
function holes(rects: Rect[], cols: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const rows = rowsOf(rects);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (!at(rects, x, y)) out.push({ x, y });
  return out;
}

/** Step 3: share the free columns of rows made only of one-row tiles. */
function justify(rects: Rect[], cols: number) {
  const rows = rowsOf(rects);
  for (let y = 0; y < rows; y++) {
    if (rects.some((r) => r.h > 1 && y >= r.y && y < r.y + r.h)) continue;
    const row = rects.filter((r) => r.y === y).sort((a, b) => a.x - b.x);
    if (!row.length) continue;
    const free = cols - row.reduce((s, r) => s + r.w, 0);
    if (free <= 0) continue;
    const base = Math.floor(free / row.length);
    let extra = free - base * row.length;
    let x = 0;
    for (const r of row) {
      r.w += base + (extra > 0 ? 1 : 0);
      if (extra > 0) extra--;
      r.x = x;
      x += r.w;
    }
  }
}

const columnFree = (rects: Rect[], x: number, y0: number, y1: number) => {
  for (let y = y0; y < y1; y++) if (at(rects, x, y)) return false;
  return true;
};

/** Step 4: grow into holes — down from the tile above, then sideways. Returns true when something grew. */
function grow(rects: Rect[], cols: number): boolean {
  let changed = false;
  for (const hole of holes(rects, cols)) {
    if (at(rects, hole.x, hole.y)) continue; // filled by an earlier growth
    const above = at(rects, hole.x, hole.y - 1);
    if (above && above.y + above.h === hole.y) {
      let ok = true;
      for (let c = above.x; c < above.x + above.w; c++) if (at(rects, c, hole.y)) ok = false;
      if (ok) { above.h += 1; changed = true; continue; }
    }
    const left = at(rects, hole.x - 1, hole.y);
    if (left && columnFree(rects, hole.x, left.y, left.y + left.h)) { left.w += 1; changed = true; continue; }
    const right = at(rects, hole.x + 1, hole.y);
    if (right && columnFree(rects, hole.x, right.y, right.y + right.h)) { right.x -= 1; right.w += 1; changed = true; }
  }
  return changed;
}

/** Pack one section's tiles (in order) onto a `cols`-column grid. */
export function packTiles(items: readonly PackInput[], cols: number): Placed[] {
  const want = items.map((it) => ({ w: spanFor(it.size, cols), h: cols > 1 && it.rows === 2 ? 2 : 1 }));
  const hs = want.map((w) => w.h);
  for (let attempt = 0; attempt <= items.length; attempt++) {
    const rects = place(want.map((w, i) => ({ w: w.w, h: hs[i] })), cols);
    // Step 2: a 2-row tile alone across its rows.
    const lonely = rects.find((r) => r.h > 1 && !rects.some((o) => o !== r && o.y < r.y + r.h && o.y + o.h > r.y));
    if (lonely) { hs[lonely.i] = 1; continue; }
    justify(rects, cols);
    for (let n = 0; n < cols * 4 && holes(rects, cols).length; n++) if (!grow(rects, cols)) break;
    const left = holes(rects, cols);
    if (left.length) {
      // Step 5: shorten the 2-row tile nearest to the first hole (by row), then pack again.
      const tall = rects.filter((r) => hs[r.i] > 1);
      if (!tall.length) break; // cannot happen: one-row rows always justify
      const h0 = left[0];
      tall.sort((a, b) => Math.abs(a.y - h0.y) - Math.abs(b.y - h0.y) || b.i - a.i);
      hs[tall[0].i] = 1;
      continue;
    }
    return rects.map((r) => ({
      id: items[r.i].id,
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      grown: r.w > want[r.i].w || r.h > want[r.i].h,
      growth: r.w - want[r.i].w,
      shortened: r.h < want[r.i].h,
    }));
  }
  // Unreachable in practice: everything one row, in order.
  return items.map((it, i) => ({ id: it.id, x: 0, y: i, w: cols, h: 1, grown: true, growth: cols - Math.min(cols, spanFor(it.size, cols)), shortened: it.rows === 2 }));
}

/** Text picture of a packing (tests, debugging): one letter per tile, «.» for a hole. */
export function asciiPack(placed: readonly Placed[], cols: number, letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"): string[] {
  const rows = placed.reduce((m, p) => Math.max(m, p.y + p.h), 0);
  const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => "."));
  placed.forEach((p, i) => {
    for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) grid[y][x] = grid[y][x] === "." ? letters[i % letters.length] : "#";
  });
  return grid.map((r) => r.join(""));
}
