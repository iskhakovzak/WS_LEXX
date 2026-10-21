/**
 * Reference examples of the office setups (Волна 2, item 2.6; lib/playbook/examplesSeed.ts):
 *
 *   POST /api/playbook/examples/seed  { perSetup?: 1–5 (default 3), dryRun?: boolean }
 *        → { perSetup, dryRun, added, setups: [{ setupId, name, before, added: tradeIds }] }
 *
 * Curators / admins (playbook.edit.any). Idempotent: a second run with the same trades adds nothing. Mounted from
 * routes/playbook-today.ts (before routes/playbook.ts, so "/playbook/examples" never reads as a setup id).
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { route } from "../lib/http";
import { seedPlaybookExamples } from "../lib/playbook/examplesSeed";

const router: IRouter = Router();

const SeedBody = z.object({
  perSetup: z.number().int().min(1).max(5).optional(),
  dryRun: z.boolean().optional(),
}).strict();

router.post("/playbook/examples/seed", route({ cap: "playbook.edit.any", body: SeedBody.optional() }, async ({ actor, body }) => {
  return seedPlaybookExamples({ actor: actor.name, perSetup: body?.perSetup, dryRun: body?.dryRun });
}));

export default router;
