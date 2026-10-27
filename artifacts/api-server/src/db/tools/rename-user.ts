/**
 * Rename a desk person everywhere (lib/people/renameUser: users.name + every row keyed by the old name, one
 * transaction, audited as «user.rename»). For the server, where the admin UI is not at hand. Run from
 * artifacts/api-server with DATABASE_URL = the target database (non-local hosts need --allow-remote):
 *
 *   pnpm run rename-user -- --id 1 --name "Zakir Iskhakov" --latin "Zakir Iskhakov" --dry-run   # per-table counts, rolled back
 *   pnpm run rename-user -- --id 1 --name "Zakir Iskhakov" --latin "Zakir Iskhakov" --confirm   # the real rename
 *
 * Several people in one run: repeat the pair, `--id 1 --name "A" --id 7 --name "B"` (each in its own transaction).
 * --latin sets users.name_latin as well (Latin display name for EN / UZ readers and sign-in by the Latin name);
 * --latin "" clears it. Restart the API afterwards: its in-memory caches (Latin names, settings) reload on start, and
 * the person signs in again under the new name (the token version is bumped).
 */
import { cleanNameLatin } from "../../lib/people/nameLatin";
import { RenameError, renameUser, type RenameReport } from "../../lib/people/renameUser";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const all = (name: string) => args.flatMap((a, i) => (a === name && i + 1 < args.length ? [args[i + 1]!] : []));
const say = (s: string) => process.stdout.write(`rename-user: ${s}\n`);
const usage = 'usage: DATABASE_URL=… node scripts/run-ts.mjs src/db/tools/rename-user.ts --id <id> --name "<new name>" [--latin "<Latin name>"] (--dry-run | --confirm) [--actor "<who>"] [--allow-remote]';

const url = process.env.DATABASE_URL;
const ids = all("--id").map(Number);
const names = all("--name");
const latins = all("--latin");
const dryRun = flag("--dry-run");
const confirm = flag("--confirm");
if (!url || !ids.length || ids.length !== names.length || ids.some((n) => !Number.isInteger(n) || n <= 0) || dryRun === confirm || (latins.length && latins.length !== ids.length)) {
  console.error(usage);
  console.error("rename-user: give each --id its --name (and --latin, if any), and exactly one of --dry-run / --confirm");
  process.exit(2);
}
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host) && !flag("--allow-remote")) {
  console.error(`rename-user: refusing non-local database host "${host}" (pass --allow-remote on purpose)`);
  process.exit(2);
}
const actor = all("--actor")[0] ?? "rename-user (CLI)";

function print(r: RenameReport): void {
  say(`${r.dryRun ? "DRY RUN — nothing written. " : ""}user ${r.userId}: «${r.from}» → «${r.to}», ${r.total} rows in ${r.counts.length} columns`);
  for (const c of [...r.counts].sort((a, b) => b.rows - a.rows)) say(`  ${`${c.table}.${c.column}`.padEnd(48)} ${String(c.rows).padStart(7)}  ${c.kind}`);
  if (r.nameLatin) say(`  users.name_latin: ${r.nameLatin.from ?? "∅"} → ${r.nameLatin.to ?? "∅"}`);
  if (r.missing.length) say(`  not on this database (skipped): ${r.missing.join(", ")}`);
}

const { pool } = await import("@workspace/db"); // reads DATABASE_URL at import time
let failed = false;
try {
  for (let k = 0; k < ids.length; k++) {
    let nameLatin: string | null | undefined;
    if (latins.length) {
      const l = cleanNameLatin(latins[k]);
      if (!l.ok) { console.error(`rename-user: --latin "${latins[k]}" is not accepted (${l.code})`); failed = true; break; }
      nameLatin = l.value;
    }
    try {
      print(await renameUser(pool, { userId: ids[k]!, newName: names[k]!, nameLatin, actor, dryRun }));
    } catch (e) {
      if (!(e instanceof RenameError)) throw e;
      failed = true;
      console.error(`rename-user: user ${ids[k]} → «${names[k]}» refused: ${e.code}${e.details ? ` ${JSON.stringify(e.details)}` : ""}`);
    }
  }
  if (!failed && confirm) say("done. Restart the API (sudo systemctl restart ws-lexx-api) and sign in under the new name.");
} finally {
  await pool.end();
}
process.exit(failed ? 1 : 0);
