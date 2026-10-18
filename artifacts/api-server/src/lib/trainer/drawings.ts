/**
 * Chart drawings (replay / analysis): GET/PUT /api/chart/drawings?ticker=&date= — the viewer's ChartDrawing[] of one
 * ticker-day, stored whole in chart_drawings (migration 0211). PUT replaces the set.
 *
 * Validation (zod schema below; a bad item is a 400 VALIDATION with its path): at most MAX_DRAWINGS items; id a client
 * string ≤ 40; kind hline (1 point) | trend (2) | rect (2); points {t: unix seconds, p: price > 0}; label ≤ 80 or null;
 * color a theme role (accent | up | down | warn) or null — never a hex.
 */
import { z } from "zod";
import { pool } from "@workspace/db";
import type { ChartDrawing } from "./types";

export const MAX_DRAWINGS = 50;
const POINTS: Record<ChartDrawing["kind"], number> = { hline: 1, trend: 2, rect: 2 };

const point = z.object({ t: z.number().int().min(0).max(4_102_444_800), p: z.number().finite().positive().max(1_000_000) }).strict();

export const drawingSchema = z
  .object({
    id: z.string().min(1).max(40),
    kind: z.enum(["hline", "trend", "rect"]),
    points: z.array(point).min(1).max(2),
    label: z.string().max(80).nullish(),
    color: z.enum(["accent", "up", "down", "warn"]).nullish(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.points.length !== POINTS[d.kind]) ctx.addIssue({ code: "custom", path: ["points"], message: `points:${d.kind}:${POINTS[d.kind]}` });
  });

export const drawingsSchema = z
  .array(drawingSchema)
  .max(MAX_DRAWINGS)
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    list.forEach((d, i) => {
      if (seen.has(d.id)) ctx.addIssue({ code: "custom", path: [i, "id"], message: "duplicate" });
      seen.add(d.id);
    });
  });

/** Canonical stored form (null label / color kept explicit, nothing else). */
export function normalizeDrawings(list: readonly z.infer<typeof drawingSchema>[]): ChartDrawing[] {
  return list.map((d) => ({ id: d.id, kind: d.kind, points: d.points.map((p) => ({ t: p.t, p: p.p })), label: d.label ?? null, color: d.color ?? null }));
}

export async function loadDrawings(userId: number, ticker: string, day: string): Promise<ChartDrawing[]> {
  const { rows } = await pool.query<{ drawings: ChartDrawing[] }>(
    `SELECT drawings FROM chart_drawings WHERE user_id = $1 AND ticker = $2 AND day = $3`,
    [userId, ticker, day],
  );
  return Array.isArray(rows[0]?.drawings) ? rows[0].drawings : [];
}

/** Replaces the set (an empty list keeps an empty row — no deletes). */
export async function saveDrawings(userId: number, ticker: string, day: string, drawings: ChartDrawing[]): Promise<ChartDrawing[]> {
  await pool.query(
    `INSERT INTO chart_drawings (user_id, ticker, day, drawings) VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (user_id, ticker, day) DO UPDATE SET drawings = EXCLUDED.drawings, updated_at = now()`,
    [userId, ticker, day, JSON.stringify(drawings)],
  );
  return drawings;
}
