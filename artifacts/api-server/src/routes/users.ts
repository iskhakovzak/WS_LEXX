import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";

const ADMIN_PASSWORD = "0987";

const router: IRouter = Router();

router.get("/users", asyncHandler(async (_req, res): Promise<void> => {
  const { rows } = await pool.query<any>(`
    SELECT id, name, password, role, active, created_at AS "createdAt"
    FROM users
    WHERE active = true
    ORDER BY created_at ASC
  `);
  res.json(rows);
}));

router.get("/users/all", asyncHandler(async (_req, res): Promise<void> => {
  const { rows } = await pool.query<any>(`
    SELECT id, name, password, role, active, created_at AS "createdAt"
    FROM users
    ORDER BY created_at ASC
  `);
  res.json(rows);
}));

router.post("/users", asyncHandler(async (req, res): Promise<void> => {
  const { name, password, role, adminPassword } = req.body as Record<string, unknown>;
  if (!name || !password) { res.status(400).json({ error: "name and password required" }); return; }
  if (String(adminPassword) !== ADMIN_PASSWORD) { res.status(403).json({ error: "Admin password required" }); return; }
  const userRole = role === "curator" ? "curator" : "trader";
  try {
    const { rows } = await pool.query<any>(
      `INSERT INTO users (name, password, role) VALUES ($1, $2, $3)
       RETURNING id, name, password, role, active, created_at AS "createdAt"`,
      [String(name).trim(), String(password), userRole]
    );
    res.status(201).json(rows[0]);
  } catch (e: any) {
    if (e.code === "23505") { res.status(409).json({ error: "User with this name already exists" }); return; }
    throw e;
  }
}));

router.patch("/users/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { name, password, role, adminPassword } = req.body as Record<string, unknown>;
  if (String(adminPassword) !== ADMIN_PASSWORD) { res.status(403).json({ error: "Admin password required" }); return; }
  const fields: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (name !== undefined) { fields.push(`name = $${i++}`); vals.push(String(name).trim()); }
  if (password !== undefined) { fields.push(`password = $${i++}`); vals.push(String(password)); }
  if (role !== undefined) { fields.push(`role = $${i++}`); vals.push(role === "curator" ? "curator" : "trader"); }
  if (!fields.length) { res.status(400).json({ error: "No fields to update" }); return; }
  vals.push(id);
  try {
    const { rows } = await pool.query<any>(
      `UPDATE users SET ${fields.join(", ")} WHERE id = $${i}
       RETURNING id, name, password, role, active, created_at AS "createdAt"`,
      vals
    );
    if (!rows[0]) { res.status(404).json({ error: "Not found" }); return; }
    res.json(rows[0]);
  } catch (e: any) {
    if (e.code === "23505") { res.status(409).json({ error: "User with this name already exists" }); return; }
    throw e;
  }
}));

router.delete("/users/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { adminPassword } = req.body as Record<string, unknown>;
  if (String(adminPassword) !== ADMIN_PASSWORD) { res.status(403).json({ error: "Admin password required" }); return; }
  await pool.query(`UPDATE users SET active = false WHERE id = $1`, [id]);
  res.json({ success: true });
}));

export default router;
