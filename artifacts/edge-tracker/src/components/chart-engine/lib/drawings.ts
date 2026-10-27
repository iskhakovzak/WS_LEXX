/**
 * Drawings (horizontal level, trend line, zone): data model, the API mapping (ChartDrawing, lib/trainer/types.ts) and
 * the browser fallback store. Stored per viewer per ticker-day — the same drawings follow every trade of that day.
 * Pure except for the storage helpers, which guard every access and never throw.
 */
import type { ChartDrawing } from "@/lib/trainer/types";
import type { Drawing, DrawingPoint, DrawingRole, DrawingType } from "../types";
import { chartI18n } from "@/i18n/ns/chart";

export const DRAWING_TYPES: readonly DrawingType[] = ["hline", "trend", "rect"];
export const DRAWING_ROLES: readonly DrawingRole[] = ["accent", "up", "down", "warn"];
/** The server keeps at most this many per ticker-day. */
export const MAX_DRAWINGS = 50;

export const DRAWING_LABEL: Readonly<Record<DrawingType, string>> = {
  get hline() { return chartI18n.t("drawing.hline"); },
  get trend() { return chartI18n.t("drawing.trend"); },
  get rect() { return chartI18n.t("drawing.rect"); },
};

/** Points a tool needs before it is complete. */
export const DRAWING_POINTS: Record<DrawingType, number> = { hline: 1, trend: 2, rect: 2 };

const KEY_PREFIX = "ws-chart:drawings:v2:";

export function newDrawingId(): string {
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** `tradeId`: the trade the drawing was made on (its notes belong to that trade); null = the ticker in general. */
export function makeDrawing(type: DrawingType, points: readonly DrawingPoint[], role: DrawingRole = "accent", tradeId: number | null = null): Drawing {
  return {
    id: newDrawingId(), type, points: points.slice(0, DRAWING_POINTS[type]).map((p) => ({ time: p.time, price: p.price })), role, createdAt: Date.now(),
    ...(tradeId != null && tradeId > 0 ? { tradeId } : {}),
  };
}

/** Longest note on a drawing (the API keeps ≤ 80 characters). */
export const MAX_NOTE = 80;

/** Drawings with a note, the ones of `tradeId` first (newest first inside each group). */
export function notesOf(list: readonly Drawing[], tradeId: number | null): Drawing[] {
  const own = (d: Drawing) => (tradeId != null && d.tradeId === tradeId ? 0 : 1);
  return list.filter((d) => (d.label ?? "").trim()).sort((a, b) => own(a) - own(b) || b.createdAt - a.createdAt);
}

const isRole = (v: unknown): v is DrawingRole => typeof v === "string" && (DRAWING_ROLES as readonly string[]).includes(v);

export function isValidDrawing(d: unknown): d is Drawing {
  if (!d || typeof d !== "object") return false;
  const x = d as Record<string, unknown>;
  if (typeof x.id !== "string" || !x.id || x.id.length > 40 || typeof x.type !== "string" || !(x.type in DRAWING_POINTS)) return false;
  if (!Array.isArray(x.points) || x.points.length < DRAWING_POINTS[x.type as DrawingType]) return false;
  return x.points.every((p: unknown) => p && typeof p === "object" && Number.isFinite((p as DrawingPoint).time) && Number.isFinite((p as DrawingPoint).price) && (p as DrawingPoint).price > 0);
}

/** Web → API shape. */
export function toApiDrawing(d: Drawing): ChartDrawing {
  return {
    id: d.id, kind: d.type, points: d.points.slice(0, DRAWING_POINTS[d.type]).map((p) => ({ t: Math.round(p.time), p: p.price })), label: d.label ?? null, color: d.role ?? "accent",
    ...(d.tradeId != null && d.tradeId > 0 ? { tradeId: d.tradeId } : {}),
  };
}

/** API → web shape; null for anything malformed. */
export function fromApiDrawing(c: unknown): Drawing | null {
  if (!c || typeof c !== "object") return null;
  const x = c as Partial<ChartDrawing>;
  const d: Drawing = {
    id: String(x.id ?? ""),
    type: x.kind as DrawingType,
    points: Array.isArray(x.points) ? x.points.map((p) => ({ time: Number(p?.t), price: Number(p?.p) })) : [],
    role: isRole(x.color) ? x.color : "accent",
    label: typeof x.label === "string" ? x.label.slice(0, MAX_NOTE) : null,
    createdAt: 0,
    ...(typeof x.tradeId === "number" && Number.isInteger(x.tradeId) && x.tradeId > 0 ? { tradeId: x.tradeId } : {}),
  };
  return isValidDrawing(d) ? d : null;
}

/** GET body → drawings ({ drawings: [...] } or a bare array). */
export function parseDrawingsResponse(body: unknown): Drawing[] {
  const list = Array.isArray(body) ? body : body && typeof body === "object" && Array.isArray((body as { drawings?: unknown }).drawings) ? (body as { drawings: unknown[] }).drawings : [];
  return list.map(fromApiDrawing).filter((d): d is Drawing => d != null).slice(0, MAX_DRAWINGS);
}

/** Move a whole drawing by a time / price delta (a horizontal level only moves in price). */
export function moveDrawing(d: Drawing, dTime: number, dPrice: number): Drawing {
  const dt = d.type === "hline" ? 0 : dTime;
  return { ...d, points: d.points.map((p) => ({ time: p.time + dt, price: Math.max(1e-6, p.price + dPrice) })) };
}

/** Replace one anchor point (dragging a handle of a trend line / zone corner). */
export function movePoint(d: Drawing, index: number, to: DrawingPoint): Drawing {
  if (index < 0 || index >= d.points.length) return d;
  const points = d.points.map((p, i) => (i === index ? { time: d.type === "hline" ? p.time : to.time, price: Math.max(1e-6, to.price) } : p));
  return { ...d, points };
}

export function drawingsStorageKey(ticker: string, day: string): string {
  return `${KEY_PREFIX}${ticker.toUpperCase()}:${day}`;
}

export function loadDrawings(ticker: string, day: string): Drawing[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = JSON.parse(localStorage.getItem(drawingsStorageKey(ticker, day)) ?? "null") as unknown;
    return parseDrawingsResponse(raw);
  } catch {
    return [];
  }
}

/**
 * The browser copy. `pending`: kept because a server save failed — it is newer than the server set and wins over it on
 * the next load (then written up); an empty pending list is kept too (everything was deleted).
 */
export function saveDrawings(ticker: string, day: string, items: readonly Drawing[], opts: { pending?: boolean } = {}): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    const key = drawingsStorageKey(ticker, day);
    if (!items.length && !opts.pending) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify({ drawings: items.slice(0, MAX_DRAWINGS).map(toApiDrawing), ...(opts.pending ? { pending: true, savedAt: new Date().toISOString() } : {}) }));
    return true;
  } catch {
    return false;
  }
}

/** The copy left by a failed server save (see saveDrawings `pending`), or null. */
export function loadUnsavedDrawings(ticker: string, day: string): Drawing[] | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = JSON.parse(localStorage.getItem(drawingsStorageKey(ticker, day)) ?? "null") as { pending?: unknown } | null;
    return raw && raw.pending === true ? parseDrawingsResponse(raw) : null;
  } catch {
    return null;
  }
}

/** Geometry helper: distance from point to segment (in pixels), used by hit-testing. */
export function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}
