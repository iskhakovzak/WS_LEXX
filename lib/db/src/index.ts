import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

function resolveDbUrl(): string {
  const raw = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
  if (!raw) {
    throw new Error("SUPABASE_DATABASE_URL or DATABASE_URL must be set.");
  }
  try {
    const url = new URL(raw);
    if (url.hostname.startsWith("db.") && url.hostname.endsWith(".supabase.co")) {
      const ref = url.hostname.replace("db.", "").replace(".supabase.co", "");
      url.hostname = "aws-1-ap-northeast-1.pooler.supabase.com";
      url.port = "6543";
      url.username = `postgres.${ref}`;
      return url.toString();
    }
  } catch {}
  return raw;
}

const dbUrl = resolveDbUrl();

export const pool = new Pool({
  connectionString: dbUrl,
  ssl: dbUrl.includes("supabase") ? { rejectUnauthorized: false } : undefined,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
