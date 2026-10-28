/**
 * Briefing video library (lib/academyBriefings.ts, migration 0288) — Academy lessons with a recording, theme tags and
 * «must watch». Watching is the lesson's own progress (POST /academy/content/lessons/:id/progress {completed: true}).
 *
 *   GET   /academy/briefings?tag=                  any member: the library, my «watched», tag counts, must-watch left;
 *                                                  staff also get the juniors' watch progress per briefing
 *   POST  /academy/briefings                       curators (academy mentors) and seniors: {title, summary?, tags,
 *                                                  playbookIds, mustWatch, videoUrl? | mediaId? | mediaLink?, durationMin?}
 *   PATCH /academy/briefings/:lessonId             same people: {title?, tags?, mustWatch?, playbookIds?}
 *   POST  /academy/briefings/media                 same people: multipart «file» (video / audio, ≤ 25 MB — the
 *                                                  voice-note limit) → {id}
 *   GET   /academy/briefings/media/:id/url         any member: a 10-minute player URL
 *   GET   /academy/briefings/media/:id/file?token= the file (token-checked; Range supported for seeking)
 */
import { Router, type IRouter, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { AppError, forbidden, idParam, notFound, route, sendError, unauthorized } from "../lib/http";
import { resolveActor } from "../lib/permissions";
import { isAcademyMentor } from "../lib/academyAccess";
import { stageOf } from "../lib/people/stage";
import { videoEmbed } from "../lib/academyContent";
import { safeHttpUrl } from "../lib/safe-url";
import { academyContentT } from "../lib/academyI18n";
import { langOf } from "../i18n";
import { objectStorageClient } from "../lib/objectStorage";
import { config } from "../config";
import {
  MEDIA_MAX_BYTES, MEDIA_MIMES, SUGGESTED_TAGS, ensureBriefingModule, insertBriefing, listBriefings, mediaRow, normTags, saveMedia,
  signMedia, updateBriefing, verifyMedia, watchProgress,
} from "../lib/academyBriefings";

const router: IRouter = Router();
const P = "/academy/briefings";

async function memberOf(req: Request) {
  const a = await resolveActor(req);
  if (!a) throw unauthorized();
  if (a.guest) throw new AppError("GUEST_READ_ONLY");
  return a;
}

/** Curators (academy mentors) and seniors add and tag recordings. */
async function mayAuthor(req: Request, name: string): Promise<boolean> {
  return (await isAcademyMentor(req)) || (await stageOf(name)) === "senior";
}

router.get(P, route({ query: z.object({ tag: z.string().trim().max(25).optional() }) }, async ({ req, query }) => {
  const a = await memberOf(req);
  const staff = await isAcademyMentor(req);
  const tag = query.tag ? normTags([query.tag])[0] ?? null : null;
  const [items, all] = await Promise.all([listBriefings(a.name, { tag, staff }), tag ? listBriefings(a.name, { tag: null, staff }) : null]);
  const counts = new Map<string, number>();
  for (const b of all ?? items) for (const t of b.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  const tags = [...new Set([...SUGGESTED_TAGS, ...counts.keys()])].map((t) => ({ tag: t, count: counts.get(t) ?? 0 }));
  const mustWatchLeft = (all ?? items).filter((b) => b.mustWatch && !b.watched).length;
  const progress = staff ? await watchProgress(items.map((b) => b.lessonId)) : null;
  return { items, tags, mustWatchLeft, canAdd: await mayAuthor(req, a.name), progress };
}));

const Common = {
  tags: z.array(z.string().max(30)).max(20).default([]),
  playbookIds: z.array(z.number().int().positive()).max(10).default([]),
  mustWatch: z.boolean().default(false),
};
const CreateBody = z.object({
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().max(1000).nullish(),
  ...Common,
  videoUrl: z.string().trim().max(1000).nullish(),
  mediaId: z.number().int().positive().nullish(),
  mediaLink: z.string().trim().max(1000).nullish(),
  durationMin: z.number().int().min(1).max(600).nullish(),
}).strict();

router.post(P, route({ body: CreateBody }, async ({ req, body, res }) => {
  const a = await memberOf(req);
  if (!(await mayAuthor(req, a.name))) throw forbidden();
  // A YouTube / Vimeo / Loom link plays inline (videoEmbed allow-list); any other http(s) link is an internal file.
  const raw = body.videoUrl || body.mediaLink || null;
  const embed = raw && videoEmbed(raw) ? raw : null;
  const link = raw && !embed ? safeHttpUrl(raw) : null;
  if (raw && !embed && !link) throw new AppError("INVALID_FIELD", undefined, { field: "videoUrl" });
  if (body.mediaId != null && !(await mediaRow(body.mediaId))) throw notFound();
  if (!embed && !link && body.mediaId == null) throw new AppError("INVALID_FIELD", undefined, { field: "videoUrl" });
  const t = academyContentT.tFor(langOf(req));
  const moduleId = await ensureBriefingModule({ program: t("briefings.programTitle"), module: t("briefings.moduleTitle") }, a.name);
  const id = await insertBriefing(moduleId, {
    title: body.title, summary: body.summary || null, tags: normTags(body.tags), playbookIds: [...new Set(body.playbookIds)], mustWatch: body.mustWatch,
    videoUrl: embed, mediaId: body.mediaId ?? null, mediaLink: link, durationMin: body.durationMin ?? null,
  }, a.name);
  res.status(201).json({ lessonId: id });
}));

router.patch(`${P}/:lessonId`, route({
  params: z.object({ lessonId: idParam }),
  body: z.object({ title: z.string().trim().min(1).max(200).optional(), tags: Common.tags.optional(), mustWatch: z.boolean().optional(), playbookIds: Common.playbookIds.optional() }).strict(),
}, async ({ req, params, body }) => {
  const a = await memberOf(req);
  if (!(await mayAuthor(req, a.name))) throw forbidden();
  const ok = await updateBriefing(params.lessonId, { title: body.title, tags: body.tags ? normTags(body.tags) : undefined, mustWatch: body.mustWatch, playbookIds: body.playbookIds });
  if (!ok) throw notFound();
  return { ok: true };
}));

const uploader = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MEDIA_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const mime = (file.mimetype || "").toLowerCase().split(";")[0].trim();
    if (MEDIA_MIMES.has(mime)) cb(null, true);
    else cb(new Error("REJECTED_MIME"));
  },
});
const uploadOne: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  uploader.single("file")(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof Error && err.message === "REJECTED_MIME") { sendError(res, new AppError("INVALID_FIELD", 415, { field: "file" })); return; }
    next(err); // size → 413 TOO_LARGE through the error middleware (the voice-note path)
  });
};

router.post(`${P}/media`, async (req, res, next) => {
  try {
    const a = await memberOf(req);
    if (!(await mayAuthor(req, a.name))) throw forbidden();
    next();
  } catch (e) { next(e); }
}, uploadOne, route({}, async ({ req, res }) => {
  const a = await memberOf(req);
  if (!req.file) throw new AppError("FIELD_REQUIRED", undefined, { field: "file" });
  const mime = (req.file.mimetype || "").toLowerCase().split(";")[0].trim();
  const id = await saveMedia(req.file.buffer, mime, a.name);
  res.status(201).json({ id, size: req.file.size, mime });
}));

router.get(`${P}/media/:id/url`, route({ params: z.object({ id: idParam }) }, async ({ req, params }) => {
  await memberOf(req);
  if (!(await mediaRow(params.id))) throw notFound();
  return { url: `/api${P}/media/${params.id}/file?token=${encodeURIComponent(signMedia(params.id))}` };
}));

router.get(`${P}/media/:id/file`, route({ params: z.object({ id: idParam }), query: z.object({ token: z.string().max(200) }) }, async ({ params, query, req, res }) => {
  if (!verifyMedia(params.id, query.token)) throw unauthorized();
  const m = await mediaRow(params.id);
  if (!m) throw notFound();
  let buf = m.bytes;
  if (!buf && m.objectPath && config.storage.bucketId) {
    [buf] = await objectStorageClient.bucket(config.storage.bucketId).file(m.objectPath).download();
  }
  if (!buf) throw notFound();
  res.setHeader("Content-Type", m.mime);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, max-age=600");
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, buf.length - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), buf.length - 1) : buf.length - 1;
    if (start >= buf.length || start > end) { res.status(416).setHeader("Content-Range", `bytes */${buf.length}`); res.end(); return; }
    res.status(206).setHeader("Content-Range", `bytes ${start}-${end}/${buf.length}`);
    res.setHeader("Content-Length", String(end - start + 1));
    res.end(buf.subarray(start, end + 1));
    return;
  }
  res.setHeader("Content-Length", String(buf.length));
  res.end(buf);
}));

export default router;
