import { Router, type IRouter, type Request, type Response } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { pool } from "@workspace/db";

const router: IRouter = Router();

const KIND_VALUES = ["entry", "add", "trim", "exit", "stop"] as const;
type ExecutionKind = (typeof KIND_VALUES)[number];

export type ExecutionRow = {
  id: number;
  tradeId: number;
  kind: ExecutionKind;
  price: string;
  qty: string | null;
  executedAt: string | null;
  note: string | null;
  sortOrder: number;
};

type CreateExecutionInput = {
  kind: ExecutionKind;
  price: number;
  qty: number | null;
  executedAt: string | null;
  note: string | null;
  sortOrder: number | null;
};

function parseCreateBody(body: unknown): { ok: true; value: CreateExecutionInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "body must be an object" };
  const b = body as Record<string, unknown>;

  const kind = b.kind;
  if (typeof kind !== "string" || !(KIND_VALUES as readonly string[]).includes(kind)) {
    return { ok: false, error: `kind must be one of: ${KIND_VALUES.join(", ")}` };
  }

  const priceNum = typeof b.price === "number" ? b.price : Number(b.price);
  if (!Number.isFinite(priceNum) || priceNum <= 0) return { ok: false, error: "price must be a positive number" };

  let qty: number | null = null;
  if (b.qty != null && b.qty !== "") {
    const q = typeof b.qty === "number" ? b.qty : Number(b.qty);
    if (!Number.isFinite(q) || q <= 0) return { ok: false, error: "qty must be a positive number" };
    qty = q;
  }

  let executedAt: string | null = null;
  if (b.executedAt != null && b.executedAt !== "") {
    if (typeof b.executedAt !== "string") return { ok: false, error: "executedAt must be a string" };
    const d = new Date(b.executedAt);
    if (Number.isNaN(d.getTime())) return { ok: false, error: "executedAt must be a valid ISO datetime" };
    executedAt = d.toISOString();
  }

  let note: string | null = null;
  if (b.note != null && b.note !== "") {
    if (typeof b.note !== "string") return { ok: false, error: "note must be a string" };
    if (b.note.length > 500) return { ok: false, error: "note too long (max 500)" };
    note = b.note;
  }

  let sortOrder: number | null = null;
  if (b.sortOrder != null) {
    const s = typeof b.sortOrder === "number" ? b.sortOrder : Number(b.sortOrder);
    if (!Number.isFinite(s) || !Number.isInteger(s)) return { ok: false, error: "sortOrder must be integer" };
    sortOrder = s;
  }

  return { ok: true, value: { kind: kind as ExecutionKind, price: priceNum, qty, executedAt, note, sortOrder } };
}

/**
 * Resolves the parent trade and enforces ownership: traders may only read/modify
 * executions of their own (non-deleted) trades; curators/admins may access all.
 * Sends the error response itself and returns false when access is denied.
 */
async function assertTradeAccess(req: Request, res: Response, tradeId: number): Promise<boolean> {
  const { rows } = await pool.query<{ trader: string | null }>(
    `SELECT trader FROM trades WHERE id = $1 AND deleted_at IS NULL`,
    [tradeId]
  );
  if (rows.length === 0) {
    res.status(404).json({ error: "trade not found" });
    return false;
  }
  const auth = req.authUser;
  if (auth && auth.role === "trader" && rows[0].trader !== auth.name) {
    res.status(403).json({ error: "Можно изменять исполнения только своих трейдов" });
    return false;
  }
  return true;
}

// GET /api/trades/:tradeId/executions
router.get(
  "/trades/:tradeId/executions",
  asyncHandler(async (req: Request, res: Response) => {
    const tradeId = Number(req.params.tradeId);
    if (!Number.isFinite(tradeId) || tradeId <= 0) {
      res.status(400).json({ error: "invalid trade id" });
      return;
    }
    if (!(await assertTradeAccess(req, res, tradeId))) return;
    const { rows } = await pool.query(
      `SELECT id, trade_id, kind, price, qty, executed_at, note, sort_order
         FROM trade_executions
        WHERE trade_id = $1
        ORDER BY sort_order ASC, id ASC`,
      [tradeId]
    );
    const data: ExecutionRow[] = rows.map((r) => ({
      id: r.id,
      tradeId: r.trade_id,
      kind: r.kind,
      price: String(r.price),
      qty: r.qty != null ? String(r.qty) : null,
      executedAt: r.executed_at ? new Date(r.executed_at).toISOString() : null,
      note: r.note,
      sortOrder: r.sort_order,
    }));
    res.json({ tradeId, executions: data });
  })
);

// POST /api/trades/:tradeId/executions
router.post(
  "/trades/:tradeId/executions",
  asyncHandler(async (req: Request, res: Response) => {
    const tradeId = Number(req.params.tradeId);
    if (!Number.isFinite(tradeId) || tradeId <= 0) {
      res.status(400).json({ error: "invalid trade id" });
      return;
    }
    const parsed = parseCreateBody(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    if (!(await assertTradeAccess(req, res, tradeId))) return;
    const v = parsed.value;
    const { rows } = await pool.query(
      `INSERT INTO trade_executions (trade_id, kind, price, qty, executed_at, note, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 0))
       RETURNING id`,
      [tradeId, v.kind, v.price, v.qty, v.executedAt, v.note, v.sortOrder]
    );
    res.status(201).json({ id: rows[0].id });
  })
);

// DELETE /api/trades/:tradeId/executions/:execId
router.delete(
  "/trades/:tradeId/executions/:execId",
  asyncHandler(async (req: Request, res: Response) => {
    const tradeId = Number(req.params.tradeId);
    const execId = Number(req.params.execId);
    const validId = (n: number) => Number.isInteger(n) && n > 0;
    if (!validId(tradeId) || !validId(execId)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    if (!(await assertTradeAccess(req, res, tradeId))) return;
    const { rowCount } = await pool.query(
      `DELETE FROM trade_executions WHERE id = $1 AND trade_id = $2`,
      [execId, tradeId]
    );
    if (rowCount === 0) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.status(204).end();
  })
);

export default router;
