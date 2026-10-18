import { readFileSync } from "node:fs";
import path from "node:path";
import { databaseUrl, db } from "../lib/db";

async function main() {
  // 빌드 때(--if-configured)는 DB 주소가 아직 없으면 조용히 건너뛴다. Vercel 배포마다 표가 최신으로 맞춰진다.
  if (process.argv.includes("--if-configured") && !databaseUrl()) {
    console.log("DATABASE_URL 이 없어 DB 스키마 적용을 건너뜁니다.");
    return;
  }
  const schema = readFileSync(path.join(__dirname, "..", "db", "schema.sql"), "utf8");
  const sql = db();
  await sql.unsafe(schema);
  console.log("DB 스키마 적용 완료");
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
