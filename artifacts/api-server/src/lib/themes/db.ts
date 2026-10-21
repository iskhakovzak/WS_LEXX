/**
 * The pool the personal-theme / board stores query (tests point it at a scratch database built from the migrations).
 */
import { pool } from "@workspace/db";

type Q = { query: <R = any>(sql: string, params?: unknown[]) => Promise<{ rows: R[]; rowCount: number | null }> };
let ref: Q = pool as unknown as Q;

export const db = (): Q => ref;

/** Tests: use another pool. Returns a restore function. */
export function setThemesDb(q: unknown): () => void {
  const prev = ref;
  ref = q as Q;
  return () => {
    ref = prev;
  };
}
