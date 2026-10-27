/** Undo / redo stack for the «Вид» editor (pure; the context keeps one per open session). */

export type History<T> = { past: T[]; present: T; future: T[] };

export const HISTORY_LIMIT = 50;

export function initHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/** A new state: the old one goes to `past`, redo is cleared. Same value (by JSON) → unchanged. */
export function pushHistory<T>(h: History<T>, next: T): History<T> {
  if (JSON.stringify(next) === JSON.stringify(h.present)) return h;
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] };
}

export function undoHistory<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redoHistory<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}
