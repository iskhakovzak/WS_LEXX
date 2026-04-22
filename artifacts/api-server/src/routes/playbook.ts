import { Router, type IRouter } from "express";
import { eq, desc, isNull } from "drizzle-orm";
import { db, pool, playbookTable, tradesTable } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { logActivity } from "../lib/activity";

const router: IRouter = Router();

router.get("/playbook", asyncHandler(async (_req, res): Promise<void> => {
  const { rows } = await pool.query<any>(`
    SELECT
      id, name, folder,
      setup_type        AS "setupType",
      conditions, checklist, notes,
      confidence_level  AS "confidenceLevel",
      screenshot_url    AS "screenshotUrl",
      screenshot_notes  AS "screenshotNotes",
      tags,
      source_type       AS "sourceType",
      source_id         AS "sourceId",
      deleted_at        AS "deletedAt",
      created_at        AS "createdAt",
      parent_id         AS "parentId"
    FROM playbook
    WHERE deleted_at IS NULL
    ORDER BY created_at DESC
  `);
  res.json(rows);
}));

router.get("/playbook/folders", asyncHandler(async (_req, res): Promise<void> => {
  const rows = await db.select({ folder: playbookTable.folder }).from(playbookTable).where(isNull(playbookTable.deletedAt));
  const folders = [...new Set(rows.map(r => r.folder).filter(Boolean))] as string[];
  folders.sort((a, b) => a.localeCompare(b));
  res.json(folders);
}));

router.patch("/playbook/rename-folder", asyncHandler(async (req, res): Promise<void> => {
  const { from: fromName, to: toName, trader } = req.body as { from: string; to: string; trader?: string };
  if (!fromName || !toName) { res.status(400).json({ error: "from and to required" }); return; }
  await db.update(playbookTable).set({ folder: toName.trim() }).where(eq(playbookTable.folder, fromName));
  await pool.query(
    `UPDATE playbook_folder_settings SET folder_name = $1, updated_at = NOW() WHERE folder_name = $2`,
    [toName.trim(), fromName]
  );
  await logActivity({ action: "updated", section: "playbook", entityTitle: fromName, trader: trader ?? "system", details: `Папка переименована: "${fromName}" → "${toName.trim()}"` });
  res.json({ success: true });
}));

router.get("/playbook/folder-settings", asyncHandler(async (_req, res): Promise<void> => {
  const { rows } = await pool.query<{ folder_name: string; color_index: number | null; sort_order: number }>(
    `SELECT folder_name, color_index, sort_order FROM playbook_folder_settings ORDER BY sort_order ASC`
  );
  res.json(rows.map(r => ({ folderName: r.folder_name, colorIndex: r.color_index, sortOrder: r.sort_order })));
}));

router.patch("/playbook/folder-settings", asyncHandler(async (req, res): Promise<void> => {
  const updates = req.body as { folderName: string; colorIndex?: number | null; sortOrder?: number }[];
  if (!Array.isArray(updates) || updates.length === 0) { res.status(400).json({ error: "array required" }); return; }
  for (const u of updates) {
    if (!u.folderName) continue;
    await pool.query(
      `INSERT INTO playbook_folder_settings (folder_name, color_index, sort_order, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (folder_name) DO UPDATE
       SET color_index = COALESCE($2, playbook_folder_settings.color_index),
           sort_order  = COALESCE($3, playbook_folder_settings.sort_order),
           updated_at  = NOW()`,
      [u.folderName, u.colorIndex ?? null, u.sortOrder ?? 0]
    );
  }
  res.json({ success: true });
}));

router.delete("/playbook/delete-folder", asyncHandler(async (req, res): Promise<void> => {
  const { folder, password, trader } = req.body as { folder: string; password?: string; trader?: string };
  if (!folder) { res.status(400).json({ error: "folder required" }); return; }
  if (password !== "1212") { res.status(403).json({ error: "Неверный пароль" }); return; }
  const { rowCount } = await pool.query(
    `UPDATE playbook SET deleted_at = NOW() WHERE folder = $1 AND deleted_at IS NULL`,
    [folder]
  );
  await logActivity({ action: "deleted", section: "playbook", entityTitle: folder, trader: trader ?? "system", details: `Папка удалена (${rowCount} стратегий)` });
  res.json({ success: true, deleted: rowCount });
}));

router.post("/playbook/restore-deleted", asyncHandler(async (req, res): Promise<void> => {
  const { adminPassword, since } = req.body as { adminPassword?: string; since?: string };
  if (adminPassword !== "0987") { res.status(403).json({ error: "Forbidden" }); return; }
  const sinceTs = since ?? "2026-04-22T17:35:00Z";
  const { rowCount } = await pool.query(
    `UPDATE playbook SET deleted_at = NULL WHERE deleted_at >= $1`,
    [sinceTs]
  );
  res.json({ success: true, restored: rowCount });
}));

router.post("/playbook", asyncHandler(async (req, res): Promise<void> => {
  const { name, folder, setupType, conditions, checklist, notes, confidenceLevel, screenshotUrl, screenshotNotes, tags, sourceType, sourceId, parentId, trader } = req.body as Record<string, unknown>;
  if (!name) { res.status(400).json({ error: "name required" }); return; }
  const { rows } = await pool.query<any>(
    `INSERT INTO playbook (name, folder, setup_type, conditions, checklist, notes, confidence_level, screenshot_url, screenshot_notes, tags, source_type, source_id, parent_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id, name, folder,
       setup_type AS "setupType", conditions, checklist, notes,
       confidence_level AS "confidenceLevel",
       screenshot_url AS "screenshotUrl", screenshot_notes AS "screenshotNotes",
       tags, source_type AS "sourceType", source_id AS "sourceId",
       deleted_at AS "deletedAt", created_at AS "createdAt", parent_id AS "parentId"`,
    [
      String(name),
      folder ? String(folder) : null,
      setupType ? String(setupType) : null,
      conditions ? String(conditions) : null,
      checklist ? String(checklist) : null,
      notes ? String(notes) : null,
      confidenceLevel ? Number(confidenceLevel) : null,
      screenshotUrl ? String(screenshotUrl) : null,
      screenshotNotes ? String(screenshotNotes) : null,
      tags ? String(tags) : null,
      sourceType ? String(sourceType) : null,
      sourceId ? Number(sourceId) : null,
      parentId ? Number(parentId) : null,
    ]
  );
  const row = rows[0];
  await logActivity({ action: "created", section: "playbook", entityId: String(row.id), entityTitle: String(name), trader: trader ? String(trader) : "system", details: folder ? `Папка: ${folder}` : undefined });
  res.json(row);
}));

router.patch("/playbook/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { name, folder, setupType, conditions, checklist, notes, confidenceLevel, screenshotUrl, screenshotNotes, tags, parentId, trader } = req.body as Record<string, unknown>;
  const fields: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (name !== undefined) { fields.push(`name = $${i++}`); vals.push(name ? String(name) : null); }
  if (folder !== undefined) { fields.push(`folder = $${i++}`); vals.push(folder ? String(folder) : null); }
  if (setupType !== undefined) { fields.push(`setup_type = $${i++}`); vals.push(setupType ? String(setupType) : null); }
  if (conditions !== undefined) { fields.push(`conditions = $${i++}`); vals.push(conditions ? String(conditions) : null); }
  if (checklist !== undefined) { fields.push(`checklist = $${i++}`); vals.push(checklist ? String(checklist) : null); }
  if (notes !== undefined) { fields.push(`notes = $${i++}`); vals.push(notes ? String(notes) : null); }
  if (confidenceLevel !== undefined) { fields.push(`confidence_level = $${i++}`); vals.push(confidenceLevel ? Number(confidenceLevel) : null); }
  if (screenshotUrl !== undefined) { fields.push(`screenshot_url = $${i++}`); vals.push(screenshotUrl ? String(screenshotUrl) : null); }
  if (screenshotNotes !== undefined) { fields.push(`screenshot_notes = $${i++}`); vals.push(screenshotNotes ? String(screenshotNotes) : null); }
  if (tags !== undefined) { fields.push(`tags = $${i++}`); vals.push(tags ? String(tags) : null); }
  if (parentId !== undefined) { fields.push(`parent_id = $${i++}`); vals.push(parentId ? Number(parentId) : null); }
  if (!fields.length) { res.status(400).json({ error: "No fields to update" }); return; }
  vals.push(id);
  const { rows } = await pool.query<any>(
    `UPDATE playbook SET ${fields.join(", ")} WHERE id = $${i}
     RETURNING id, name, folder,
       setup_type AS "setupType", conditions, checklist, notes,
       confidence_level AS "confidenceLevel",
       screenshot_url AS "screenshotUrl", screenshot_notes AS "screenshotNotes",
       tags, source_type AS "sourceType", source_id AS "sourceId",
       deleted_at AS "deletedAt", created_at AS "createdAt", parent_id AS "parentId"`,
    vals
  );
  if (!rows[0]) { res.status(404).json({ error: "Not found" }); return; }
  await logActivity({ action: "updated", section: "playbook", entityId: String(id), entityTitle: rows[0].name, trader: trader ? String(trader) : "system", details: `Обновлён сетап` });
  res.json(rows[0]);
}));

router.get("/playbook/:id/children", asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { rows } = await pool.query<any>(`
    SELECT
      id, name, folder,
      setup_type        AS "setupType",
      conditions, checklist, notes,
      confidence_level  AS "confidenceLevel",
      screenshot_url    AS "screenshotUrl",
      screenshot_notes  AS "screenshotNotes",
      tags,
      source_type       AS "sourceType",
      source_id         AS "sourceId",
      deleted_at        AS "deletedAt",
      created_at        AS "createdAt",
      parent_id         AS "parentId"
    FROM playbook
    WHERE parent_id = $1 AND deleted_at IS NULL
    ORDER BY created_at DESC
  `, [id]);
  res.json(rows);
}));

router.delete("/playbook/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { rows } = await pool.query<any>(`SELECT name, folder FROM playbook WHERE id = $1`, [id]);
  await db.update(playbookTable).set({ deletedAt: new Date() }).where(eq(playbookTable.id, id));
  const trader = (req.body as any)?.trader;
  await logActivity({ action: "deleted", section: "playbook", entityId: String(id), entityTitle: rows[0]?.name ?? `#${id}`, trader: trader ?? "system", details: rows[0]?.folder ? `Папка: ${rows[0].folder}` : undefined });
  res.json({ success: true });
}));

router.post("/playbook/:id/restore", asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.update(playbookTable).set({ deletedAt: null }).where(eq(playbookTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const trader = (req.body as any)?.trader;
  await logActivity({ action: "created", section: "playbook", entityId: String(id), entityTitle: row.name ?? `#${id}`, trader: trader ?? "system", details: "Восстановлен из корзины" });
  res.json({ success: true });
}));

router.get("/playbook/trades/bulk", asyncHandler(async (req, res): Promise<void> => {
  const idsParam = req.query.ids;
  if (!idsParam || typeof idsParam !== "string") { res.json([]); return; }
  const ids = idsParam.split(",").map(Number).filter((n) => !isNaN(n));
  if (ids.length === 0) { res.json([]); return; }
  const { rows } = await pool.query<any>(
    `SELECT id, ticker, date, side, result, pnl, r_multiple AS "rMultiple",
            setup, entry, exit, stop, slippage, relative_volume AS "relativeVolume",
            playbook_id AS "playbookId", created_at AS "createdAt"
     FROM trades WHERE playbook_id = ANY($1)`,
    [ids]
  );
  const grouped: Record<number, any[]> = {};
  for (const id of ids) grouped[id] = [];
  for (const t of rows) {
    const pid = t.playbookId;
    if (grouped[pid]) grouped[pid].push({
      ...t,
      entry: t.entry ? Number(t.entry) : null,
      exit: t.exit ? Number(t.exit) : null,
      stop: t.stop ? Number(t.stop) : null,
      pnl: t.pnl ? Number(t.pnl) : null,
      rMultiple: t.rMultiple ? Number(t.rMultiple) : null,
      slippage: t.slippage ? Number(t.slippage) : null,
      relativeVolume: t.relativeVolume ? Number(t.relativeVolume) : null,
      createdAt: t.createdAt?.toISOString?.() ?? t.createdAt,
    });
  }
  res.json(Object.entries(grouped).map(([entryId, trades]) => ({ entryId: Number(entryId), trades })));
}));

router.get("/playbook/:id/trades", asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db.select().from(tradesTable).where(eq((tradesTable as any).playbookId, id));
  res.json(rows.map((t: any) => ({
    ...t,
    entry: t.entry ? Number(t.entry) : null,
    exit: t.exit ? Number(t.exit) : null,
    stop: t.stop ? Number(t.stop) : null,
    pnl: t.pnl ? Number(t.pnl) : null,
    rMultiple: t.rMultiple ? Number(t.rMultiple) : null,
    slippage: t.slippage ? Number(t.slippage) : null,
    relativeVolume: t.relativeVolume ? Number(t.relativeVolume) : null,
    createdAt: t.createdAt.toISOString(),
  })));
}));

router.post("/playbook/:id/link-trade", asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { tradeId } = req.body as { tradeId: number };
  if (isNaN(id) || !tradeId) { res.status(400).json({ error: "Invalid params" }); return; }
  await db.update(tradesTable).set({ playbookId: id } as any).where(eq(tradesTable.id, tradeId));
  res.json({ success: true });
}));

router.delete("/playbook/:id/link-trade/:tradeId", asyncHandler(async (req, res): Promise<void> => {
  const tradeId = Number(req.params.tradeId);
  if (isNaN(tradeId)) { res.status(400).json({ error: "Invalid tradeId" }); return; }
  await db.update(tradesTable).set({ playbookId: null } as any).where(eq(tradesTable.id, tradeId));
  res.json({ success: true });
}));

router.get("/playbook/:id/ideas", asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { rows } = await pool.query<any>(
    `SELECT * FROM playbook_trade_ideas WHERE playbook_entry_id = $1 ORDER BY created_at DESC`,
    [id]
  );
  res.json(rows.map((r: any) => ({ ...r, createdAt: r.created_at })));
}));

router.post("/playbook/:id/ideas", asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { ticker, side, entryZone, target, stop, status, notes, date } = req.body as Record<string, unknown>;
  if (!ticker) { res.status(400).json({ error: "ticker required" }); return; }
  const { rows } = await pool.query<any>(
    `INSERT INTO playbook_trade_ideas (playbook_entry_id, ticker, side, entry_zone, target, stop, status, notes, date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [id, String(ticker), side ?? null, entryZone ?? null, target ?? null, stop ?? null, status ?? "watching", notes ?? null, date ?? null]
  );
  res.json({ ...rows[0], createdAt: rows[0].created_at });
}));

router.patch("/playbook/:id/ideas/:ideaId", asyncHandler(async (req, res): Promise<void> => {
  const ideaId = Number(req.params.ideaId);
  if (isNaN(ideaId)) { res.status(400).json({ error: "Invalid ideaId" }); return; }
  const { ticker, side, entryZone, target, stop, status, notes, date } = req.body as Record<string, unknown>;
  const { rows } = await pool.query<any>(
    `UPDATE playbook_trade_ideas SET
      ticker = COALESCE($1, ticker),
      side = $2,
      entry_zone = $3,
      target = $4,
      stop = $5,
      status = COALESCE($6, status),
      notes = $7,
      date = $8
     WHERE id = $9 RETURNING *`,
    [ticker ?? null, side ?? null, entryZone ?? null, target ?? null, stop ?? null, status ?? null, notes ?? null, date ?? null, ideaId]
  );
  if (!rows[0]) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...rows[0], createdAt: rows[0].created_at });
}));

router.delete("/playbook/:id/ideas/:ideaId", asyncHandler(async (req, res): Promise<void> => {
  const ideaId = Number(req.params.ideaId);
  if (isNaN(ideaId)) { res.status(400).json({ error: "Invalid ideaId" }); return; }
  await pool.query(`DELETE FROM playbook_trade_ideas WHERE id = $1`, [ideaId]);
  res.json({ success: true });
}));

export default router;
