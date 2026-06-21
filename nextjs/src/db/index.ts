import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import * as relations from "./relations";

// Max connections in the shared Postgres pool. Exported so callers that fan
// out concurrent transactions (e.g. pushVideoDescriptions) can derive their
// in-flight limit from it and leave headroom for other requests in the process.
export const DB_POOL_MAX = 10;

const client = postgres(process.env.DATABASE_URL!, {
  connect_timeout: 10,
  idle_timeout: 20,
  max: DB_POOL_MAX,
});

export const db = drizzle(client, { schema: { ...schema, ...relations } });

export type Database = typeof db;
