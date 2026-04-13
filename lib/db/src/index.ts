import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool, types } = pg;

types.setTypeParser(20, parseInt);
types.setTypeParser(21, parseInt);
types.setTypeParser(23, parseInt);
types.setTypeParser(26, parseInt);
types.setTypeParser(1700, parseFloat);

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  throw new Error("DATABASE_URL must be set.");
}

export const pool = new Pool({ connectionString: dbUrl });
export const db = drizzle(pool, { schema });

export * from "./schema";
