import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";

async function isCuratorRole(name: string): Promise<boolean> {
  const { rows } = await pool.query("SELECT 1 FROM users WHERE name = $1 AND role = 'curator' AND active = true", [name]);
  return rows.length > 0;
}

const router: IRouter = Router();

router.get("/ratings", asyncHandler(async (req, res): Promise<void> => {
  const trader = req.query.trader as string | undefined;
  const curator = req.query.curator as string | undefined;
  let sql = `
    SELECT id, trader, curator, week,
      discipline, risk_management AS "riskManagement",
      execution, journaling, improvement, overall,
      comment, created_at AS "createdAt"
    FROM trader_ratings
  `;
  const params: unknown[] = [];
  const where: string[] = [];
  if (trader) { where.push(`trader = $${params.length + 1}`); params.push(trader); }
  if (curator) { where.push(`curator = $${params.length + 1}`); params.push(curator); }
  if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
  sql += ` ORDER BY week DESC, created_at DESC`;
  const { rows } = await pool.query<any>(sql, params);
  res.json(rows);
}));

router.get("/ratings/summary", asyncHandler(async (_req, res): Promise<void> => {
  const { rows } = await pool.query<any>(`
    SELECT trader,
      ROUND(AVG(discipline), 1) AS "avgDiscipline",
      ROUND(AVG(risk_management), 1) AS "avgRiskManagement",
      ROUND(AVG(execution), 1) AS "avgExecution",
      ROUND(AVG(journaling), 1) AS "avgJournaling",
      ROUND(AVG(improvement), 1) AS "avgImprovement",
      ROUND(AVG(overall), 1) AS "avgOverall",
      COUNT(*) AS "totalRatings"
    FROM trader_ratings
    GROUP BY trader
    ORDER BY "avgOverall" DESC
  `);
  res.json(rows.map((r: any) => ({
    ...r,
    avgDiscipline: Number(r.avgDiscipline),
    avgRiskManagement: Number(r.avgRiskManagement),
    avgExecution: Number(r.avgExecution),
    avgJournaling: Number(r.avgJournaling),
    avgImprovement: Number(r.avgImprovement),
    avgOverall: Number(r.avgOverall),
    totalRatings: Number(r.totalRatings),
  })));
}));

router.post("/ratings", asyncHandler(async (req, res): Promise<void> => {
  const { trader, curator, week, discipline, riskManagement, execution, journaling, improvement, overall, comment } = req.body as Record<string, unknown>;
  if (!trader || !curator || !week) { res.status(400).json({ error: "trader, curator, week required" }); return; }
  if (!(await isCuratorRole(String(curator)))) { res.status(403).json({ error: "Only curators can rate" }); return; }
  const { rows } = await pool.query<any>(
    `INSERT INTO trader_ratings (trader, curator, week, discipline, risk_management, execution, journaling, improvement, overall, comment)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id, trader, curator, week,
       discipline, risk_management AS "riskManagement",
       execution, journaling, improvement, overall,
       comment, created_at AS "createdAt"`,
    [
      String(trader), String(curator), String(week),
      discipline ? Number(discipline) : 5,
      riskManagement ? Number(riskManagement) : 5,
      execution ? Number(execution) : 5,
      journaling ? Number(journaling) : 5,
      improvement ? Number(improvement) : 5,
      overall ? Number(overall) : 5,
      comment ? String(comment) : null,
    ]
  );
  res.status(201).json(rows[0]);
}));

router.delete("/ratings/:id", asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await pool.query(`DELETE FROM trader_ratings WHERE id = $1`, [id]);
  res.json({ success: true });
}));

export default router;
