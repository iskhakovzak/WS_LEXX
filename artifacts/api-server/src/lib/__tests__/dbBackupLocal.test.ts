/** Волна 2 п. 2.1 — local-disk store of the "db.backup" job (BACKUP_DIR on the owner's own server). */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { deleteLocalFile, listLocalFiles, localBackupPath, writeLocalDump } from "../dbBackupLocal";

const dirs: string[] = [];
async function scratch(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), "ws-lexx-backup-"));
  dirs.push(d);
  return d;
}
afterAll(async () => { for (const d of dirs) await rm(d, { recursive: true, force: true }); });

describe("dbBackupLocal", () => {
  it("writes the dump under its final name only after pg_dump exits 0", async () => {
    const dir = path.join(await scratch(), "nested");
    const size = await writeLocalDump(dir, "2026-10-20T07-15-00Z.dump", Readable.from([Buffer.from("PGDMP"), Buffer.from("-data")]), async () => 0);
    expect(size).toBe(10);
    expect(await readFile(path.join(dir, "2026-10-20T07-15-00Z.dump"), "utf8")).toBe("PGDMP-data");
    expect(await readdir(dir)).toEqual(["2026-10-20T07-15-00Z.dump"]);
  });

  it("a failed pg_dump leaves no file behind", async () => {
    const dir = await scratch();
    await expect(writeLocalDump(dir, "x.dump", Readable.from([Buffer.from("partial")]), async () => 1)).rejects.toThrow(/exited 1/);
    expect(await readdir(dir)).toEqual([]);
  });

  it("lists plain files (no partials), deletes by name, refuses paths outside the directory", async () => {
    const dir = await scratch();
    await writeFile(path.join(dir, "a.dump"), "1");
    await writeFile(path.join(dir, "b.dump.partial"), "2");
    expect((await listLocalFiles(dir)).map((f) => f.file)).toEqual(["a.dump"]);
    expect(await listLocalFiles(path.join(dir, "missing"))).toEqual([]);
    await deleteLocalFile(dir, "a.dump");
    expect((await listLocalFiles(dir)).map((f) => f.file)).toEqual([]);
    expect(localBackupPath(dir, "../etc/passwd")).toBeNull();
    expect(localBackupPath(dir, ".hidden")).toBeNull();
    expect(localBackupPath(dir, "a.dump")).toBe(path.join(dir, "a.dump"));
  });
});
