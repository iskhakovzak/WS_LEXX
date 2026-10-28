/**
 * Briefing video library of the Academy (migration 0288) — built on the lessons, not beside them: a briefing is an
 * academy_lessons row with a recording (an embeddable video_url, an uploaded academy_media file or a link to an
 * internal file), theme tags and «must watch»; it lives in the «Брифинги» program the first briefing creates; watched =
 * academy_lesson_progress.completed_at (the lesson's own «пройден»).
 *
 *   normTags(raw)                 «#Tilt, fomo» → ["tilt", "fomo"] (codes, ≤ 12, ≤ 24 chars)
 *   listBriefings(viewer, …)      the library with my «watched», the tag counts, «must watch» left for me
 *   watchProgress(lessonIds)      staff: per briefing, which juniors watched it
 *   ensureBriefingModule(...)     the program + module a new briefing goes to (created once, published)
 *   media: saveMedia / mediaRow / signMedia / verifyMedia   upload storage and the short-lived player token
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { pool } from "@workspace/db";
import { config } from "../config";
import { objectStorageClient } from "./objectStorage";
import { videoEmbed } from "./academyContent";
import { loadStageInfo } from "./people/stage";
import type { Queryable } from "./interventions/log";

export const BRIEFING_SLUG = "briefings";
export const MEDIA_MAX_BYTES = 25 * 1024 * 1024; // the voice-note upload limit (routes/voicenotes.ts)
export const MEDIA_MIMES: ReadonlySet<string> = new Set(["video/mp4", "video/webm", "video/quicktime", "audio/mpeg", "audio/mp4", "audio/webm", "audio/ogg", "audio/wav"]);
/** The theme tags offered first (any other code may be typed). */
export const SUGGESTED_TAGS = ["tilt", "fomo", "g2r", "2ndday", "execution"] as const;
const TAG_RE = /^[a-z0-9][a-z0-9_-]{0,23}$/;

export function normTags(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : String(raw ?? "").split(/[\s,;]+/);
  const out: string[] = [];
  for (const x of list) {
    const t = String(x ?? "").trim().toLowerCase().replace(/^#+/, "");
    if (TAG_RE.test(t) && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 12);
}

export type Briefing = {
  lessonId: number; title: string; summary: string | null; tags: string[]; mustWatch: boolean;
  setups: { id: number; name: string }[];
  video: ReturnType<typeof videoEmbed>; videoUrl: string | null; mediaId: number | null; mediaLink: string | null;
  durationMin: number | null; createdBy: string | null; createdAt: string; watched: boolean;
};

/** Lessons that are briefings: a recording of any kind, or a tag. Drafts / archived only for staff. */
export async function listBriefings(me: string, opts: { tag: string | null; staff: boolean }, db: Queryable = pool): Promise<Briefing[]> {
  const { rows } = await db.query(
    `SELECT l.id, l.title, l.summary, l.tags, l.must_watch, l.video_url, l.media_id, l.media_link, l.duration_min, l.created_by, l.created_at,
            l.playbook_ids, (pr.completed_at IS NOT NULL) AS watched
       FROM academy_lessons l
       JOIN academy_modules m ON m.id = l.module_id AND m.archived_at IS NULL
       JOIN academy_programs p ON p.id = m.program_id AND p.archived_at IS NULL
       LEFT JOIN academy_lesson_progress pr ON pr.lesson_id = l.id AND pr.user_name = $1
      WHERE l.archived_at IS NULL AND (l.video_url IS NOT NULL OR l.media_id IS NOT NULL OR l.media_link IS NOT NULL OR cardinality(l.tags) > 0)
        AND ($2::boolean OR (NOT l.draft AND p.published))
        AND ($3::text IS NULL OR $3 = ANY(l.tags))
      ORDER BY l.must_watch DESC, l.created_at DESC
      LIMIT 300`,
    [me, opts.staff, opts.tag],
  );
  const ids = [...new Set(rows.flatMap((r) => (r.playbook_ids ?? []) as number[]))];
  const names = new Map<number, string>();
  if (ids.length) {
    const { rows: ps } = await db.query(`SELECT id, name FROM playbook WHERE id = ANY($1::int[]) AND deleted_at IS NULL`, [ids]);
    for (const p of ps) names.set(Number(p.id), String(p.name));
  }
  return rows.map((r) => ({
    lessonId: Number(r.id), title: String(r.title), summary: r.summary ?? null, tags: (r.tags ?? []) as string[], mustWatch: r.must_watch === true,
    setups: ((r.playbook_ids ?? []) as number[]).filter((id) => names.has(id)).map((id) => ({ id, name: names.get(id)! })),
    video: videoEmbed(r.video_url), videoUrl: r.video_url ?? null, mediaId: r.media_id == null ? null : Number(r.media_id), mediaLink: r.media_link ?? null,
    durationMin: r.duration_min == null ? null : Number(r.duration_min), createdBy: r.created_by ?? null,
    createdAt: new Date(r.created_at).toISOString(), watched: r.watched === true,
  }));
}

export type WatchRow = { lessonId: number; juniors: number; watched: number; missing: string[] };

/** Per briefing: active juniors (ladder stage «Джун») who watched it, and who did not yet (names: staff view). */
export async function watchProgress(lessonIds: readonly number[], db: Queryable = pool): Promise<WatchRow[]> {
  if (!lessonIds.length) return [];
  const { rows: people } = await db.query(`SELECT name FROM users WHERE active = true AND COALESCE(banned, false) = false AND role = 'trader' ORDER BY name`);
  const stages = await loadStageInfo(people.map((p) => String(p.name)));
  const juniors = [...stages].filter(([, s]) => s.stage === "junior").map(([n]) => n);
  const { rows } = juniors.length
    ? await db.query(
      `SELECT lesson_id, user_name FROM academy_lesson_progress WHERE lesson_id = ANY($1::int[]) AND user_name = ANY($2::text[]) AND completed_at IS NOT NULL`,
      [[...lessonIds], juniors],
    )
    : { rows: [] as any[] };
  const done = new Map<number, Set<string>>();
  for (const r of rows) {
    const id = Number(r.lesson_id);
    done.set(id, (done.get(id) ?? new Set()).add(String(r.user_name)));
  }
  return lessonIds.map((id) => {
    const d = done.get(id) ?? new Set<string>();
    return { lessonId: id, juniors: juniors.length, watched: d.size, missing: juniors.filter((n) => !d.has(n)) };
  });
}

/** The «Брифинги» program and its module (created once, published so juniors can mark progress). */
export async function ensureBriefingModule(titles: { program: string; module: string }, by: string, db: Queryable = pool): Promise<number> {
  const found = await db.query(
    `SELECT m.id FROM academy_programs p JOIN academy_modules m ON m.program_id = p.id AND m.archived_at IS NULL
      WHERE p.slug = $1 AND p.archived_at IS NULL ORDER BY m.position, m.id LIMIT 1`,
    [BRIEFING_SLUG],
  );
  if (found.rows[0]) return Number(found.rows[0].id);
  const prog = await db.query(
    `INSERT INTO academy_programs (slug, title, published, position, created_by) VALUES ($1, $2, true, 1000, $3)
     ON CONFLICT (slug) DO UPDATE SET archived_at = NULL RETURNING id`,
    [BRIEFING_SLUG, titles.program, by],
  );
  const mod = await db.query(`INSERT INTO academy_modules (program_id, title, position, seed_key) VALUES ($1, $2, 0, $3) RETURNING id`, [Number(prog.rows[0].id), titles.module, BRIEFING_SLUG]);
  return Number(mod.rows[0].id);
}

export type BriefingInput = {
  title: string; summary: string | null; tags: string[]; playbookIds: number[]; mustWatch: boolean;
  videoUrl: string | null; mediaId: number | null; mediaLink: string | null; durationMin: number | null;
};

export async function insertBriefing(moduleId: number, x: BriefingInput, by: string, db: Queryable = pool): Promise<number> {
  const { rows } = await db.query(
    `INSERT INTO academy_lessons (module_id, title, summary, body_md, video_url, media_id, media_link, tags, must_watch, playbook_ids, duration_min, position, created_by)
     VALUES ($1, $2, $3, '', $4, $5, $6, $7, $8, $9, $10, COALESCE((SELECT MAX(position) + 1 FROM academy_lessons WHERE module_id = $1), 0), $11)
     RETURNING id`,
    [moduleId, x.title, x.summary, x.videoUrl, x.mediaId, x.mediaLink, x.tags, x.mustWatch, x.playbookIds, x.durationMin, by],
  );
  return Number(rows[0].id);
}

/** Tags / must-watch / title of a lesson (any lesson may join the library by getting a tag). */
export async function updateBriefing(lessonId: number, x: Partial<Pick<BriefingInput, "title" | "tags" | "mustWatch" | "playbookIds">>, db: Queryable = pool): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE academy_lessons SET title = COALESCE($2, title), tags = COALESCE($3, tags), must_watch = COALESCE($4, must_watch),
            playbook_ids = COALESCE($5, playbook_ids), updated_at = now()
      WHERE id = $1 AND archived_at IS NULL`,
    [lessonId, x.title ?? null, x.tags ?? null, x.mustWatch ?? null, x.playbookIds ?? null],
  );
  return (rowCount ?? 0) > 0;
}

// ─── media ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function saveMedia(buf: Buffer, mime: string, by: string, db: Queryable = pool): Promise<number> {
  const bucket = config.storage.bucketId;
  let objectPath: string | null = null;
  if (bucket) {
    objectPath = `${config.storage.privateDir || "objects"}/academy-media/${randomUUID()}`;
    await objectStorageClient.bucket(bucket).file(objectPath).save(buf, { contentType: mime, resumable: false });
  }
  const { rows } = await db.query(
    `INSERT INTO academy_media (mime, size_bytes, bytes, object_path, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [mime, buf.length, objectPath ? null : buf, objectPath, by],
  );
  return Number(rows[0].id);
}

export async function mediaRow(id: number, db: Queryable = pool): Promise<{ mime: string; size: number; bytes: Buffer | null; objectPath: string | null } | null> {
  const { rows } = await db.query(`SELECT mime, size_bytes, bytes, object_path FROM academy_media WHERE id = $1 AND deleted_at IS NULL`, [id]);
  const r = rows[0];
  return r ? { mime: String(r.mime), size: Number(r.size_bytes), bytes: r.bytes ?? null, objectPath: r.object_path ?? null } : null;
}

const TOKEN_TTL_SEC = 600;
const sig = (id: number, exp: number) => createHmac("sha256", config.mediaTokenSecret).update(`academy-media:${id}:${exp}`).digest("hex");

/** A 10-minute token for one file (a <video src> cannot carry the session header; the session never goes in a URL). */
export function signMedia(id: number, nowMs = Date.now()): string {
  const exp = Math.floor(nowMs / 1000) + TOKEN_TTL_SEC;
  return `${exp}.${sig(id, exp)}`;
}

export function verifyMedia(id: number, raw: unknown, nowMs = Date.now()): boolean {
  if (!config.mediaTokenSecret || typeof raw !== "string") return false;
  const [e, s] = raw.split(".");
  const exp = Number(e);
  if (!Number.isInteger(exp) || exp * 1000 < nowMs || !/^[0-9a-f]{64}$/.test(s ?? "")) return false;
  const a = Buffer.from(sig(id, exp), "hex");
  const b = Buffer.from(s, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
