/**
 * Local-disk store for the "db.backup" job (Волна 2 п. 2.1 — the owner's own server, docs/DEPLOY.md): with
 * BACKUP_DIR set, `pg_dump -Fc` files land in that directory instead of Object Storage. Same names, retention and
 * listing as the bucket store (lib/dbBackupCron.ts), so the admin console («Бэкапы», «нет свежего бэкапа») works
 * unchanged. A dump is written to `<name>.dump.partial` and renamed only after pg_dump exits 0 — a half-written file
 * never looks like a backup.
 */
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export type LocalFile = { file: string; createdAt: string; size: number };

/** Absolute path of a stored backup; null for anything that is not a plain file name inside the directory. */
export function localBackupPath(dir: string, file: string): string | null {
  if (!file || file !== path.basename(file) || file.startsWith(".")) return null;
  return path.join(dir, file);
}

/** Stream a dump into `<dir>/<file>`; `done()` resolves to pg_dump's exit code. Removes the partial file on failure. */
export async function writeLocalDump(dir: string, file: string, source: Readable, done: () => Promise<number>): Promise<number> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const target = localBackupPath(dir, file);
  if (!target) throw new Error(`bad backup file name: ${file}`);
  const partial = `${target}.partial`;
  try {
    await pipeline(source, createWriteStream(partial, { mode: 0o600 }));
    const code = await done();
    if (code !== 0) throw new Error(`pg_dump exited ${code}`);
    await rename(partial, target);
    return (await stat(target)).size;
  } catch (err) {
    await unlink(partial).catch(() => undefined);
    throw err;
  }
}

/** Backup files of the directory (partials and other files are skipped by the caller's name check). */
export async function listLocalFiles(dir: string): Promise<LocalFile[]> {
  const names = await readdir(dir).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return [] as string[];
    throw err;
  });
  const out: LocalFile[] = [];
  for (const file of names) {
    if (file.endsWith(".partial")) continue;
    const s = await stat(path.join(dir, file)).catch(() => null);
    if (s?.isFile()) out.push({ file, createdAt: s.mtime.toISOString(), size: s.size });
  }
  return out;
}

export async function deleteLocalFile(dir: string, file: string): Promise<void> {
  const p = localBackupPath(dir, file);
  if (p) await unlink(p);
}
