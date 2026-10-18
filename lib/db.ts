import postgres from "postgres";
import { requireEnv } from "./env";

// 서버리스에서 연결이 쌓이지 않도록 전역에 하나만 둔다.
const globalForDb = globalThis as unknown as { sql?: postgres.Sql };

export function db(): postgres.Sql {
  if (!globalForDb.sql) {
    globalForDb.sql = postgres(requireEnv("DATABASE_URL"), { max: 5, idle_timeout: 20, prepare: false, onnotice: () => {} });
  }
  return globalForDb.sql;
}
