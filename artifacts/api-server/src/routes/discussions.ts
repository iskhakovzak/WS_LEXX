import { Router, type IRouter } from "express";
import { eq, desc, isNull } from "drizzle-orm";
import { db, discussionsTable, commentsTable } from "@workspace/db";
import { logActivity } from "../lib/activity";
import { asyncHandler } from "../lib/asyncHandler";
import {
  CreateDiscussionBody,
  GetDiscussionParams,
  DeleteDiscussionParams,
  AddCommentParams,
  AddCommentBody,
  ListDiscussionsResponse,
  GetDiscussionResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function getDiscussionWithComments(id: number) {
  const [discussion] = await db
    .select()
    .from(discussionsTable)
    .where(eq(discussionsTable.id, id));
  if (!discussion) return null;

  const comments = await db
    .select()
    .from(commentsTable)
    .where(eq(commentsTable.discussionId, id))
    .orderBy(commentsTable.createdAt);

  return {
    ...discussion,
    createdAt: discussion.createdAt.toISOString(),
    comments: comments.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })),
  };
}

router.get("/discussions", asyncHandler(async (_req, res): Promise<void> => {
  const discussions = await db
    .select()
    .from(discussionsTable)
    .where(isNull(discussionsTable.deletedAt))
    .orderBy(desc(discussionsTable.createdAt));

  const withComments = await Promise.all(
    discussions.map(async (d) => {
      const comments = await db
        .select()
        .from(commentsTable)
        .where(eq(commentsTable.discussionId, d.id))
        .orderBy(commentsTable.createdAt);
      return {
        ...d,
        createdAt: d.createdAt.toISOString(),
        comments: comments.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })),
      };
    }),
  );

  res.json(ListDiscussionsResponse.parse(withComments));
}));

router.post("/discussions", asyncHandler(async (req, res): Promise<void> => {
  const parsed = CreateDiscussionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [discussion] = await db.insert(discussionsTable).values(parsed.data).returning();
  logActivity({ action: "created", section: "discussions", entityId: String(discussion.id), entityTitle: discussion.topic, trader: discussion.trader ?? undefined });
  const full = await getDiscussionWithComments(discussion.id);
  res.status(201).json(GetDiscussionResponse.parse(full));
}));

router.get("/discussions/:id", asyncHandler(async (req, res): Promise<void> => {
  const params = GetDiscussionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const full = await getDiscussionWithComments(params.data.id);
  if (!full) {
    res.status(404).json({ error: "Discussion not found" });
    return;
  }
  res.json(GetDiscussionResponse.parse(full));
}));

router.delete("/discussions/:id", asyncHandler(async (req, res): Promise<void> => {
  const params = DeleteDiscussionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [discussion] = await db
    .update(discussionsTable)
    .set({ deletedAt: new Date() })
    .where(eq(discussionsTable.id, params.data.id))
    .returning();
  if (!discussion) {
    res.status(404).json({ error: "Discussion not found" });
    return;
  }
  res.sendStatus(204);
}));

router.post("/discussions/:id/restore", asyncHandler(async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [discussion] = await db.update(discussionsTable).set({ deletedAt: null }).where(eq(discussionsTable.id, id)).returning();
  if (!discussion) { res.status(404).json({ error: "Discussion not found" }); return; }
  res.json({ success: true });
}));

router.post("/discussions/:id/comments", asyncHandler(async (req, res): Promise<void> => {
  const params = AddCommentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = AddCommentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [comment] = await db
    .insert(commentsTable)
    .values({ discussionId: params.data.id, ...parsed.data })
    .returning();
  res.status(201).json({ ...comment, createdAt: comment.createdAt.toISOString() });
}));

router.patch("/discussions/:id/comments/:commentId", asyncHandler(async (req, res): Promise<void> => {
  const commentId = Number(req.params.commentId);
  if (!commentId || isNaN(commentId)) {
    res.status(400).json({ error: "Invalid comment ID" });
    return;
  }
  const { text, trader } = req.body as { text?: string; trader?: string };
  if (!text) {
    res.status(400).json({ error: "Text is required" });
    return;
  }
  const [existing] = await db.select().from(commentsTable).where(eq(commentsTable.id, commentId));
  if (!existing) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }
  if (trader && existing.trader !== trader) {
    res.status(403).json({ error: "You can only edit your own comments" });
    return;
  }
  const [updated] = await db.update(commentsTable).set({ text }).where(eq(commentsTable.id, commentId)).returning();
  res.json({ ...updated, createdAt: updated.createdAt.toISOString() });
}));

router.delete("/discussions/:id/comments/:commentId", asyncHandler(async (req, res): Promise<void> => {
  const commentId = Number(req.params.commentId);
  if (!commentId || isNaN(commentId)) {
    res.status(400).json({ error: "Invalid comment ID" });
    return;
  }
  const trader = req.query.trader as string | undefined;
  const [existing] = await db.select().from(commentsTable).where(eq(commentsTable.id, commentId));
  if (!existing) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }
  if (trader && existing.trader !== trader) {
    res.status(403).json({ error: "You can only delete your own comments" });
    return;
  }
  await db.delete(commentsTable).where(eq(commentsTable.id, commentId));
  res.sendStatus(204);
}));

export default router;
