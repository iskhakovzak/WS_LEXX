import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool, types } = pg;

types.setTypeParser(20, parseInt);
types.setTypeParser(21, parseInt);
types.setTypeParser(23, parseInt);
types.setTypeParser(26, parseInt);
types.setTypeParser(1700, parseFloat);

function resolveDbUrl(): string {
  if (process.env.SUPABASE_DB_PASSWORD) {
    const ref = "egrxucyrgcqaubjnzzxs";
    const pass = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD);
    return `postgresql://postgres.${ref}:${pass}@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres`;
  }
  const raw = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
  if (!raw) {
    throw new Error("SUPABASE_DB_PASSWORD or DATABASE_URL must be set.");
  }
  return raw;
}

const dbUrl = resolveDbUrl();

export const pool = new Pool({
  connectionString: dbUrl,
  ssl: dbUrl.includes("supabase") ? { rejectUnauthorized: false } : undefined,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
