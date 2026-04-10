import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const useSupabase = process.env.USE_SUPABASE === "true" && !!process.env.SUPABASE_DATABASE_URL;
const dbUrl = useSupabase ? process.env.SUPABASE_DATABASE_URL! : process.env.DATABASE_URL;
if (!dbUrl) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: dbUrl,
  ssl: useSupabase ? { rejectUnauthorized: false } : undefined,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
