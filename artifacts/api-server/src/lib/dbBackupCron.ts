import { spawn } from "child_process";
import { createGzip } from "zlib";
import { objectStorageClient } from "./objectStorage";
import { logger } from "./logger";
import { logAudit } from "./audit";

const BUCKET_ID = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID ?? "";
const BACKUP_PREFIX = "ws-lexx-backups/";
const KEEP_BACKUPS = 10;
const INTERVAL_MS = 48 * 60 * 60 * 1000;
const SIDECAR = "http://127.0.0.1:1106";

export interface BackupMeta {
  name: string;
  objectName: string;
  createdAt: string;
  sizeKb: number;
}

function nowLabel(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "Z";
}

async function runPgDump(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) { reject(new Error("DATABASE_URL not set")); return; }
    const chunks: Buffer[] = [];
    const pg = spawn("pg_dump", ["--format=plain", "--no-password", `--dbname=${dbUrl}`], {
      env: { ...process.env },
    });
    const gz = createGzip({ level: 9 });
    pg.stdout.pipe(gz);
    gz.on("data", (c: Buffer) => chunks.push(c));
    gz.on("end", () => resolve(Buffer.concat(chunks)));
    gz.on("error", reject);
    pg.stderr.on("data", (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg) logger.debug({ msg }, "pg_dump stderr");
    });
    pg.on("error", reject);
    pg.on("close", (code) => { if (code !== 0) reject(new Error(`pg_dump exited ${code}`)); });
  });
}

async function pruneOldBackups(): Promise<void> {
  if (!BUCKET_ID) return;
  const bucket = objectStorageClient.bucket(BUCKET_ID);
  const [files] = await bucket.getFiles({ prefix: BACKUP_PREFIX });
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  const toDelete = sorted.slice(0, Math.max(0, sorted.length - KEEP_BACKUPS));
  for (const f of toDelete) {
    await f.delete().catch(() => {});
    logger.info({ name: f.name }, "dbBackup: pruned old backup");
  }
}

export async function runDbBackup(): Promise<BackupMeta> {
  if (!BUCKET_ID) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not configured — set up Object Storage first");
  const label = nowLabel();
  const objectName = `${BACKUP_PREFIX}${label}.sql.gz`;
  logger.info({ label }, "dbBackup: starting pg_dump");
  const buf = await runPgDump();
  const bucket = objectStorageClient.bucket(BUCKET_ID);
  await bucket.file(objectName).save(buf, { contentType: "application/gzip", resumable: false });
  await pruneOldBackups();
  const sizeKb = Math.round(buf.length / 1024);
  logger.info({ objectName, sizeKb }, "dbBackup: completed");
  await logAudit({
    actor: "system", action: "db.backup",
    targetType: "backup", targetId: label,
    details: { sizeKb, objectName },
  });
  return { name: label, objectName, createdAt: new Date().toISOString(), sizeKb };
}

export async function listBackups(): Promise<BackupMeta[]> {
  if (!BUCKET_ID) return [];
  const bucket = objectStorageClient.bucket(BUCKET_ID);
  const [files] = await bucket.getFiles({ prefix: BACKUP_PREFIX });
  const result: BackupMeta[] = [];
  for (const f of files) {
    const [meta] = await f.getMetadata();
    const name = f.name.replace(BACKUP_PREFIX, "").replace(".sql.gz", "");
    result.push({
      name,
      objectName: f.name,
      createdAt: String(meta.timeCreated ?? meta.updated ?? ""),
      sizeKb: Math.round(Number(meta.size ?? 0) / 1024),
    });
  }
  return result.sort((a, b) => b.name.localeCompare(a.name));
}

export async function getBackupDownloadUrl(objectName: string): Promise<string> {
  const parts = objectName.split("/");
  const bucketName = BUCKET_ID;
  const req = {
    bucket_name: bucketName,
    object_name: objectName,
    method: "GET",
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  };
  const resp = await fetch(`${SIDECAR}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new Error(`Signed URL failed: ${resp.status}`);
  const { signed_url } = await resp.json() as { signed_url: string };
  void parts; // used for validation
  return signed_url;
}

let started = false;
let lastBackupAt: Date | null = null;

export function startDbBackupCron(): void {
  if (started) return;
  started = true;

  setTimeout(() => {
    lastBackupAt = new Date();
    runDbBackup().catch((e) => logger.error({ error: e.message }, "dbBackup: startup backup failed"));
  }, 3 * 60 * 1000);

  setInterval(() => {
    const msSince = lastBackupAt ? Date.now() - lastBackupAt.getTime() : Infinity;
    if (msSince >= INTERVAL_MS) {
      lastBackupAt = new Date();
      runDbBackup().catch((e) => logger.error({ error: e.message }, "dbBackup: scheduled backup failed"));
    }
  }, 60 * 60 * 1000);

  logger.info({ intervalH: 48, keepLast: KEEP_BACKUPS, delayMin: 3 }, "dbBackup cron started");
}
