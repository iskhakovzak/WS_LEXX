/**
 * PropReports API v2 extras for staff (under /api/propreports/api, auth required; never called by traders):
 *
 *   GET  /reports                       [read.team] report types (type, description, scope account|group, multiCurrency)
 *                                                    + documented `mode` values per type
 *   GET  /report?type=&from=&to=&accountId=|groupId=&mode=&baseCurrency=&format=csv|json
 *                                       [read.team] one report: csv = file download, json = header + first 500 rows
 *   GET  /locates?from=&to=&accountId=|groupId=&page=
 *                                       [read.team] locates (Date/Time, Account, Qty, Symbol, Cost, Locate Id)
 *   GET  /superuser                     [read.team] remembered answer: does the token have superuser rights (null = unknown)
 *   POST /superuser/check               [read.team] probe with uploadSearch page 1 (read-only) and remember the answer
 *   POST /upload                        [sync] multipart "file" + type, sourceId?, clearingFirmId?, replacementKey?,
 *                                                    processingMode?, reconciliationMode?, forceDuplicateProcessing?
 *   GET  /uploads?sourceId=&type=&replacementKey=&uploadDate=|actionDate=&status=a,b&page=
 *                                       [read.team] uploadSearch (25 per page)
 *   GET  /uploads/status?uploadId=1,2   [read.team] summary + per-date details
 *   GET  /uploads/:id/messages          [read.team] processing messages (empty = still running / nothing to say)
 *
 * Superuser-only actions answer 403 PROPREPORTS_SUPERUSER_REQUIRED without the right, and the answer is remembered
 * (lib/propreports/superuser.ts) so the UI hides the panel. Uploads ≤ 4 MB (Vercel body limit).
 */
import { Router, type IRouter, type RequestHandler } from "express";
import { z } from "zod";
import multer from "multer";
import { requireAuth } from "../lib/auth";
import { AppError, route } from "../lib/http";
import { logAudit } from "../lib/audit";
import { addDays, nyDate } from "../lib/tradingDate";
import { getConfiguredClient, PropReportsError, type PropReportsClient } from "../lib/propreports/client";
import { FilterError } from "../lib/propreports/filters";
import { REPORT_MODES, UPLOAD_SEARCH_STATUSES, UPLOAD_TYPES } from "../lib/propreports/parse-v2";
import { parseCsvTable } from "../lib/propreports/csv";
import { rememberSuperuser, superuserState } from "../lib/propreports/superuser";

const router: IRouter = Router();

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.string().trim().regex(/^-?\d{1,12}$/);
const idList = z.string().trim().regex(/^\d{1,12}(,\d{1,12})*$/);
const MAX_RANGE_DAYS = 400;
export const REPORT_PREVIEW_ROWS = 500;
const UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
const UPLOAD_EXT = new Set([".csv", ".txt", ".zip", ".xls", ".xlsx", ".xml", ".json", ".pdf"]);

async function clientOrThrow(): Promise<PropReportsClient> {
  const c = await getConfiguredClient();
  if (!c) throw new AppError("PROPREPORTS_NOT_CONFIGURED");
  return c;
}

/** Upstream / parameter error → the API error contract (never the token: client.ts redacts upstream texts). */
export function upstreamError(e: unknown): unknown {
  if (e instanceof FilterError) return new AppError("PROPREPORTS_REQUEST_INVALID", 400, { detail: e.message });
  if (!(e instanceof PropReportsError)) return e;
  if (e.key === "conn.deadline") return new AppError("TIMEOUT");
  const detail = e.message.replace(/^PropReports \w+: /, "").slice(0, 200);
  switch (e.kind) {
    case "auth": return new AppError("PROPREPORTS_TOKEN_REJECTED");
    case "forbidden": return new AppError("PROPREPORTS_SUPERUSER_REQUIRED");
    case "rateLimited":
    case "unavailable": return new AppError("PROPREPORTS_BUSY");
    case "badRequest":
    case "notFound":
    case "method": return new AppError("PROPREPORTS_REJECTED", 502, { status: e.status, detail });
    default: return new AppError("UPSTREAM_FAILED", 502);
  }
}

async function upstream<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) { throw upstreamError(e); }
}

/** A superuser-only call: remembers true on success, false on 403 (then 403 PROPREPORTS_SUPERUSER_REQUIRED). */
async function asSuperuser<T>(client: PropReportsClient, via: string, fn: () => Promise<T>): Promise<T> {
  try {
    const out = await fn();
    await rememberSuperuser(client, true, via).catch(() => undefined);
    return out;
  } catch (e) {
    if (e instanceof PropReportsError && e.kind === "forbidden") await rememberSuperuser(client, false, via).catch(() => undefined);
    throw upstreamError(e);
  }
}

function scopeOf(q: { accountId?: string; groupId?: string }) {
  return q.accountId ? { accountIds: q.accountId.split(",") } : q.groupId ? { groupId: q.groupId } : {};
}

function checkRange(from: string, to: string): void {
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (days < 0 || days > MAX_RANGE_DAYS) throw new AppError("INVALID_RANGE", undefined, { max: MAX_RANGE_DAYS });
}

router.get("/propreports/api/reports", requireAuth, route({ cap: "propreports.read.team" }, async () => {
  const client = await clientOrThrow();
  const reports = await upstream(() => client.reports());
  const modes = Object.fromEntries(Object.entries(REPORT_MODES).map(([t, m]) => [t, Object.keys(m)]));
  return { reports, modes };
}));

router.get("/propreports/api/report", requireAuth, route({
  cap: "propreports.read.team",
  query: z.object({
    type: z.string().trim().min(1).max(64),
    from: ymd.optional(),
    to: ymd.optional(),
    accountId: id.optional(),
    groupId: id.optional(),
    mode: z.string().trim().regex(/^\d$/).optional(),
    baseCurrency: z.string().trim().regex(/^[A-Za-z]{3}$/).optional(),
    format: z.enum(["csv", "json"]).optional(),
  }),
}, async ({ query, actor, res }) => {
  const to = query.to ?? nyDate();
  const from = query.from ?? addDays(to, -6);
  checkRange(from, to);
  const client = await clientOrThrow();
  const text = await upstream(() => client.report(query.type, from, to, { accountId: query.accountId, groupId: query.groupId }, query.mode, { baseCurrency: query.baseCurrency }));
  await logAudit({ actor: actor.name, action: "propreports.report.download", details: { type: query.type, from, to, accountId: query.accountId ?? null, groupId: query.groupId ?? null, format: query.format ?? "csv" } });
  if (query.format === "json") {
    const t = parseCsvTable(text);
    return { type: query.type, from, to, header: t.header, rows: t.rows.slice(0, REPORT_PREVIEW_ROWS), totalRows: t.rows.length, truncated: t.rows.length > REPORT_PREVIEW_ROWS };
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="propreports-${query.type.replace(/[^\w-]/g, "")}-${from}_${to}.csv"`);
  res.send(text);
  return undefined;
}));

router.get("/propreports/api/locates", requireAuth, route({
  cap: "propreports.read.team",
  query: z.object({ from: ymd.optional(), to: ymd.optional(), accountId: idList.optional(), groupId: id.optional(), page: z.coerce.number().int().positive().max(10_000).optional() }),
}, async ({ query }) => {
  const to = query.to ?? nyDate();
  const from = query.from ?? addDays(to, -6);
  checkRange(from, to);
  const client = await clientOrThrow();
  const r = await upstream(() => client.locates({ startDate: from, endDate: to, page: query.page ?? null, ...scopeOf(query) }));
  return { from, to, ...r };
}));

router.get("/propreports/api/superuser", requireAuth, route({ cap: "propreports.read.team" }, async () => {
  const client = await clientOrThrow();
  return superuserState(client);
}));

router.post("/propreports/api/superuser/check", requireAuth, route({ cap: "propreports.read.team" }, async () => {
  const client = await clientOrThrow();
  try {
    await client.uploadSearch({ page: 1 });
    return await rememberSuperuser(client, true, "uploadSearch");
  } catch (e) {
    if (e instanceof PropReportsError && e.kind === "forbidden") return rememberSuperuser(client, false, "uploadSearch");
    throw upstreamError(e);
  }
}));

router.get("/propreports/api/uploads", requireAuth, route({
  cap: "propreports.read.team",
  query: z.object({
    sourceId: z.string().trim().regex(/^\d{1,12}$/).optional(),
    type: z.enum(UPLOAD_TYPES).optional(),
    replacementKey: z.string().trim().max(255).optional(),
    uploadDate: ymd.optional(),
    actionDate: ymd.optional(),
    status: z.string().trim().max(200).optional(),
    page: z.coerce.number().int().positive().max(10_000).optional(),
  }),
}, async ({ query }) => {
  const status = query.status ? query.status.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  for (const s of status ?? []) if (!(UPLOAD_SEARCH_STATUSES as readonly string[]).includes(s)) throw new AppError("PROPREPORTS_REQUEST_INVALID", 400, { detail: `status: ${s}` });
  const client = await clientOrThrow();
  return asSuperuser(client, "uploadSearch", () => client.uploadSearch({ ...query, status: status as typeof UPLOAD_SEARCH_STATUSES[number][] | undefined }));
}));

router.get("/propreports/api/uploads/status", requireAuth, route({
  cap: "propreports.read.team",
  query: z.object({ uploadId: idList }),
}, async ({ query }) => {
  const client = await clientOrThrow();
  return asSuperuser(client, "uploadStatus", () => client.uploadStatus(query.uploadId));
}));

router.get("/propreports/api/uploads/:id/messages", requireAuth, route({
  cap: "propreports.read.team",
  params: z.object({ id: z.string().regex(/^\d{1,12}$/) }),
}, async ({ params }) => {
  const client = await clientOrThrow();
  return asSuperuser(client, "uploadMessages", () => client.uploadMessages(params.id));
}));

const uploader = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = (file.originalname.match(/\.[a-z0-9]+$/i)?.[0] ?? "").toLowerCase();
    if (!UPLOAD_EXT.has(ext)) return cb(new AppError("FILE_TYPE", 400, { types: [...UPLOAD_EXT].join(", ") }));
    cb(null, true);
  },
});
const uploadFile: RequestHandler = (req, res, next) => {
  uploader.single("file")(req, res, (err: unknown) => {
    if (!err) return next();
    if ((err as { code?: string }).code === "LIMIT_FILE_SIZE") return next(new AppError("PROPREPORTS_FILE_TOO_LARGE", 413, { max: "4 MB" }));
    next(err);
  });
};

const flag = z.enum(["true", "false"]).transform((v) => v === "true");

router.post("/propreports/api/upload", requireAuth, uploadFile, route({
  cap: "propreports.sync",
  body: z.object({
    type: z.enum(UPLOAD_TYPES),
    sourceId: z.string().trim().regex(/^\d{1,12}$/).optional().or(z.literal("")),
    clearingFirmId: z.string().trim().regex(/^\d{1,12}$/).optional().or(z.literal("")),
    replacementKey: z.string().trim().max(255).optional(),
    processingMode: z.enum(["tradeFeeAdjustments"]).optional().or(z.literal("")),
    reconciliationMode: z.enum(["account", "clearing"]).optional().or(z.literal("")),
    forceDuplicateProcessing: flag.optional(),
  }),
}, async ({ body, req, actor }) => {
  const file = req.file;
  if (!file) throw new AppError("UPLOAD_ERROR");
  const client = await clientOrThrow();
  const uploads = await asSuperuser(client, "upload", () => client.upload(
    { name: file.originalname, data: new Uint8Array(file.buffer), contentType: file.mimetype },
    {
      type: body.type,
      sourceId: body.sourceId || null,
      clearingFirmId: body.clearingFirmId || null,
      replacementKey: body.replacementKey || null,
      processingMode: body.processingMode || null,
      reconciliationMode: body.reconciliationMode || null,
      forceDuplicateProcessing: body.forceDuplicateProcessing ?? null,
    },
  ));
  await logAudit({ actor: actor.name, action: "propreports.upload", details: { type: body.type, fileName: file.originalname, size: file.size, uploadIds: uploads.map((u) => u.uploadId) } });
  return { uploads };
}));

export default router;
