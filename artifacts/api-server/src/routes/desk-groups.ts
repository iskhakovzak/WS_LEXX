/**
 * Desk groups (Волна 1 п. 1.19, owner decision 3) — the admin screen «Группы» (Пульт → Настройки деска):
 *
 *   GET  /desk-groups                 users.read.team → {groups:[{id,name,curatorId,curatorName,sortOrder,members}],
 *                                     ungrouped, curators, canEdit}
 *   POST /desk-groups                 settings.manage {name, curatorId?} → 201 {group}
 *   PUT  /desk-groups/members         settings.manage {userId, groupId|null} — move a trader (null = «Без группы»);
 *                                     the group's curator becomes his assigned curator
 *   PUT  /desk-groups/:id             settings.manage {name?, curatorId?, sortOrder?, archived?} — rename, change the
 *                                     curator (also on its traders), reorder, archive (its traders → «Без группы»)
 *
 * Every change writes the audit log. Store and the «my group» scope: lib/people/deskGroups.ts.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { can, requireCap } from "../lib/permissions";
import { logAudit } from "../lib/audit";
import { badRequest, conflict, notFound } from "../lib/http";
import {
  curatorById, groupNameTaken, insertGroup, liveGroup, loadDeskGroups, moveTrader, updateGroup, type DeskGroupMember,
} from "../lib/people/deskGroups";

const router: IRouter = Router();

const name = z.string().trim().min(1).max(60);
const CreateBody = z.object({ name, curatorId: z.number().int().positive().nullable().optional() }).strict();
const UpdateBody = z.object({
  name: name.optional(),
  curatorId: z.number().int().positive().nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  archived: z.literal(true).optional(),
}).strict();
const MoveBody = z.object({ userId: z.number().int().positive(), groupId: z.number().int().positive().nullable() }).strict();

async function curatorOf(id: number | null | undefined): Promise<DeskGroupMember | null | undefined> {
  if (id === undefined) return undefined;
  if (id === null) return null;
  const c = await curatorById(id);
  if (!c) throw badRequest("DESK_GROUP_CURATOR_INVALID");
  return c;
}

router.get("/desk-groups", asyncHandler(async (req, res): Promise<void> => {
  if (!(await requireCap(req, res, "users.read.team"))) return;
  const state = await loadDeskGroups();
  res.json({ ...state, canEdit: await can(req, "settings.manage") });
}));

router.post("/desk-groups", asyncHandler(async (req, res): Promise<void> => {
  if (!(await requireCap(req, res, "settings.manage"))) return;
  const parsed = CreateBody.safeParse(req.body ?? {});
  if (!parsed.success) throw parsed.error;
  const curator = await curatorOf(parsed.data.curatorId ?? null);
  if (await groupNameTaken(parsed.data.name, null)) throw conflict("DESK_GROUP_NAME_TAKEN", undefined, { name: parsed.data.name });
  const id = await insertGroup(parsed.data.name, curator?.id ?? null);
  await logAudit({ actor: req.authUser!.name, action: "desk_groups.create", targetType: "desk_groups", targetId: String(id), details: { name: parsed.data.name, curator: curator?.name ?? null } });
  const state = await loadDeskGroups();
  res.status(201).json({ group: state.groups.find((g) => g.id === id) ?? null });
}));

router.put("/desk-groups/members", asyncHandler(async (req, res): Promise<void> => {
  if (!(await requireCap(req, res, "settings.manage"))) return;
  const parsed = MoveBody.safeParse(req.body ?? {});
  if (!parsed.success) throw parsed.error;
  const { userId, groupId } = parsed.data;
  if (groupId != null && !(await liveGroup(groupId))) throw notFound("DESK_GROUP_NOT_FOUND");
  const moved = await moveTrader(userId, groupId);
  if (!moved) throw notFound("USER_NOT_FOUND");
  await logAudit({ actor: req.authUser!.name, action: "desk_groups.move", targetType: "users", targetId: String(userId), details: { trader: moved.name, from: moved.from, to: groupId } });
  res.json(await loadDeskGroups());
}));

router.put("/desk-groups/:id", asyncHandler(async (req, res): Promise<void> => {
  if (!(await requireCap(req, res, "settings.manage"))) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw notFound("DESK_GROUP_NOT_FOUND");
  const parsed = UpdateBody.safeParse(req.body ?? {});
  if (!parsed.success) throw parsed.error;
  const cur = await liveGroup(id);
  if (!cur) throw notFound("DESK_GROUP_NOT_FOUND");
  const b = parsed.data;
  const curator = await curatorOf(b.curatorId);
  if (b.name && (await groupNameTaken(b.name, id))) throw conflict("DESK_GROUP_NAME_TAKEN", undefined, { name: b.name });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await updateGroup(id, { name: b.name, curator, sortOrder: b.sortOrder, archived: b.archived }, client);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  await logAudit({
    actor: req.authUser!.name, action: b.archived ? "desk_groups.archive" : "desk_groups.update", targetType: "desk_groups", targetId: String(id),
    details: { from: { name: cur.name, curatorId: cur.curatorId }, name: b.name, curator: curator === undefined ? undefined : curator?.name ?? null, sortOrder: b.sortOrder },
  });
  res.json(await loadDeskGroups());
}));

export default router;
