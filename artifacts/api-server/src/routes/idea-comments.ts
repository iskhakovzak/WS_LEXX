import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { asyncHandler } from "../lib/asyncHandler";
import { notifyPublicComment, notifyTraderTelegram, notifyUser } from "../lib/notifyUtils";
import { notifLinks } from "../lib/notificationCore";
import { inBackground } from "../lib/notifyEvents";
import { preview as textPreview } from "../lib/notifyEventsCore";
import { isGuest, requireMember } from "../lib/auth";
import { can } from "../lib/permissions";

const router: IRouter = Router();

router.get("/trade-ideas/:id/comments", asyncHandler(async (req, res): Promise<void> => {
  const ideaId = Number(req.params.id);
  if (!Number.isInteger(ideaId) || ideaId <= 0) { res.status(400).json({ error: "invalid id" }); return; }
  if (!req.authUser) { res.status(401).json({ error: "Требуется вход" }); return; }
  const viewer = isGuest(req) ? null : req.authUser.name;
  const isCuratorOrAdmin = await can(req, "ideas.review");

  const { rows: ideaRows } = await pool.query(
    `SELECT trader, status FROM trade_ideas WHERE id = $1 AND deleted_at IS NULL`,
    [ideaId],
  );
  if (!ideaRows[0]) { res.status(404).json({ error: "idea not found" }); return; }
  const ideaAuthor = (ideaRows[0] as { trader: string | null }).trader;
  // Comments on another trader's draft are as invisible as the draft itself.
  if ((ideaRows[0] as { status: string }).status === "draft" && !isCuratorOrAdmin && (!viewer || viewer !== ideaAuthor)) {
    res.status(404).json({ error: "idea not found" }); return;
  }

  const { rows } = await pool.query(
    `SELECT id, idea_id, author_name, text, is_private, source, created_at
     FROM trade_idea_comments
     WHERE idea_id = $1
     ORDER BY created_at ASC`,
    [ideaId],
  );

  type CommentRow = { id: number; idea_id: number; author_name: string; text: string; is_private: boolean; source: string; created_at: string };
  const filtered = (rows as CommentRow[]).filter((c) => {
    if (!c.is_private) return true;
    if (isCuratorOrAdmin) return true;
    if (viewer && (viewer === c.author_name || viewer === ideaAuthor)) return true;
    return false;
  });

  res.json(filtered);
}));

router.post("/trade-ideas/:id/comments", asyncHandler(async (req, res): Promise<void> => {
  const ideaId = Number(req.params.id);
  if (!Number.isInteger(ideaId) || ideaId <= 0) { res.status(400).json({ error: "invalid id" }); return; }
  if (!requireMember(req, res)) return;
  const author = req.authUser!.name;
  const { text, is_private } = req.body as { text?: string; is_private?: boolean };

  if (!text || !String(text).trim()) { res.status(400).json({ error: "text required" }); return; }
  if (String(text).length > 5000) { res.status(400).json({ error: "Комментарий слишком длинный (макс. 5000 символов)" }); return; }

  const { rows: ideaRows } = await pool.query(
    `SELECT id, ticker, trader, status FROM trade_ideas WHERE id = $1 AND deleted_at IS NULL`,
    [ideaId],
  );
  if (!ideaRows[0]) { res.status(404).json({ error: "idea not found" }); return; }
  const idea = ideaRows[0] as { id: number; ticker: string; trader: string | null; status: string };
  if (idea.status === "draft" && idea.trader !== author && !(await can(req, "ideas.review", idea.trader ? { trader: idea.trader } : undefined))) {
    res.status(404).json({ error: "idea not found" }); return;
  }

  const isPrivate = Boolean(is_private);
  const { rows } = await pool.query(
    `INSERT INTO trade_idea_comments (idea_id, author_name, text, is_private, source)
     VALUES ($1, $2, $3, $4, 'website')
     RETURNING id, idea_id, author_name, text, is_private, source, created_at`,
    [ideaId, author, String(text).trim(), isPrivate],
  );

  if (isPrivate) {
    // Private reply — only the idea creator is notified
    if (idea.trader && idea.trader !== author) {
      const preview = String(text).trim().slice(0, 100);
      const recipient = idea.trader;
      inBackground("idea-comments.private", () => notifyUser({
        userName: recipient, type: "idea_comment", ideaId, actor: author, source: "website",
        title: `Личный ответ к идее ${idea.ticker}`,
        message: `${author}: «${textPreview(String(text), 100)}»`,
        link: notifLinks.idea(ideaId), entityType: "idea", entityId: ideaId,
      }));
      await notifyTraderTelegram(idea.trader,
        `🔒 Личный ответ по идее <b>#${ideaId} ${idea.ticker}</b> от <b>${author}</b>:\n\n<i>"${preview}"</i>`);
    }
  } else {
    // Public comment — fan-out to creator + curator + risk manager + prior commenters
    notifyPublicComment({
      ideaId, ticker: idea.ticker, traderName: idea.trader,
      authorName: author, commentText: String(text).trim(), source: "website",
    }).catch(() => {});
  }

  res.status(201).json(rows[0]);
}));

/** Delete a comment: its author (within 24h) or a curator/admin. */
router.delete("/trade-ideas/:id/comments/:commentId", asyncHandler(async (req, res): Promise<void> => {
  const ideaId = Number(req.params.id);
  const commentId = Number(req.params.commentId);
  if (!Number.isInteger(ideaId) || ideaId <= 0 || !Number.isInteger(commentId) || commentId <= 0) {
    res.status(400).json({ error: "invalid id" }); return;
  }
  if (!requireMember(req, res)) return;
  const actor = req.authUser!;
  const { rows } = await pool.query(
    `SELECT author_name, created_at FROM trade_idea_comments WHERE id = $1 AND idea_id = $2`,
    [commentId, ideaId],
  );
  const c = rows[0] as { author_name: string; created_at: string } | undefined;
  if (!c) { res.status(404).json({ error: "comment not found" }); return; }
  const isReviewer = await can(req, "ideas.review");
  const isFreshOwn = c.author_name === actor.name && Date.now() - new Date(c.created_at).getTime() < 24 * 60 * 60 * 1000;
  if (!isReviewer && !isFreshOwn) {
    res.status(403).json({ error: "Удалить комментарий может автор (в течение суток) или куратор" }); return;
  }
  await pool.query(`DELETE FROM trade_idea_comments WHERE id = $1`, [commentId]);
  res.json({ success: true });
}));

export default router;
