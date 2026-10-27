/**
 * Guard for the cascading rename (lib/people/renameUserColumns.ts) against the committed schema snapshot
 * (db/schema.sql, built from the migrations): every column that looks like a person name, every json / jsonb and
 * every text[] column is either renamed or kept on purpose, and no listed column is stale. The same check runs on a
 * real migrated database in renameUserDb.test.ts (information_schema); this one needs no Postgres.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KEPT, PERSON_COLUMN_RE, RENAME_TARGETS, staleEntries, unclassifiedColumns, type SchemaColumn } from "../../people/renameUserColumns";

const schemaFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../db/schema.sql");

/** Columns of every `CREATE TABLE public.x (…)` block in the snapshot. */
function parseSchemaSql(sql: string): SchemaColumn[] {
  const out: SchemaColumn[] = [];
  const re = /^CREATE TABLE public\.("?)([a-z0-9_]+)\1 \(\n([\s\S]*?)\n\);$/gm;
  for (const m of sql.matchAll(re)) {
    for (const line of m[3].split("\n")) {
      const col = /^ {2}("?)([a-z0-9_]+)\1 (.+?),?$/.exec(line);
      if (!col || /^CONSTRAINT$/i.test(col[2])) continue;
      const type = col[3].toLowerCase();
      out.push({
        table: m[2],
        column: col[2],
        type: /^jsonb?\b/.test(type) ? "json" : /^(text|character varying(\(\d+\))?)\[\]/.test(type) ? "array" : /^(text|character varying)\b/.test(type) ? "text" : "other",
      });
    }
  }
  return out;
}

describe("rename: every name-holding column is classified (db/schema.sql)", () => {
  // CRLF-safe: a Windows checkout may convert the snapshot's line endings.
  const schema = parseSchemaSql(readFileSync(schemaFile, "utf8").replace(/\r\n/g, "\n"));

  it("parses the snapshot", () => {
    expect(schema.length).toBeGreaterThan(1000);
    expect(schema).toContainEqual({ table: "trades", column: "trader", type: "text" });
    expect(schema).toContainEqual({ table: "notifications", column: "params", type: "json" });
    expect(schema).toContainEqual({ table: "discussions", column: "audience", type: "array" });
  });

  it("no unclassified person / json / text[] column — add it to RENAME_TARGETS or KEPT", () => {
    expect(unclassifiedColumns(schema)).toEqual([]);
  });

  it("no stale entry (a listed table / column that no longer exists)", () => {
    expect(staleEntries(schema)).toEqual([]);
  });

  it("a column is never both renamed and kept, and never listed twice", () => {
    const keys = RENAME_TARGETS.map((t) => `${t.table}.${t.column}:${t.kind}`);
    expect(new Set(keys).size).toBe(keys.length);
    const textOrJson = RENAME_TARGETS.filter((t) => t.kind === "text" || t.kind === "json" || t.kind === "array").map((t) => `${t.table}.${t.column}`);
    expect(textOrJson.filter((k) => Object.prototype.hasOwnProperty.call(KEPT, k))).toEqual([]);
  });

  it("the guard notices a new name-keyed column", () => {
    const grown: SchemaColumn[] = [...schema, { table: "new_table", column: "trader", type: "text" }, { table: "new_table", column: "approved_by", type: "text" }, { table: "new_table", column: "payload", type: "json" }];
    expect(unclassifiedColumns(grown)).toEqual(["new_table.approved_by", "new_table.payload", "new_table.trader"]);
    expect(PERSON_COLUMN_RE.test("notes")).toBe(false);
  });
});
