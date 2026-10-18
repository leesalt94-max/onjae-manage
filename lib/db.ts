import postgres from "postgres";

// Vercel 의 Neon 연동은 접두어 설정에 따라 이름을 다르게 만든다. 흔한 이름을 차례로 찾는다.
const URL_NAMES = ["DATABASE_URL", "DATABASE_POSTGRES_URL", "POSTGRES_URL"];

export function databaseUrl(): string | null {
  for (const name of URL_NAMES) {
    const v = process.env[name];
    if (v) return v;
  }
  return null;
}

// 서버리스에서 연결이 쌓이지 않도록 전역에 하나만 둔다.
const globalForDb = globalThis as unknown as { sql?: postgres.Sql };

export function db(): postgres.Sql {
  if (!globalForDb.sql) {
    const url = databaseUrl();
    if (!url) throw new Error("환경변수 DATABASE_URL 이(가) 설정되지 않았습니다.");
    globalForDb.sql = postgres(url, { max: 5, idle_timeout: 20, prepare: false, onnotice: () => {} });
  }
  return globalForDb.sql;
}
