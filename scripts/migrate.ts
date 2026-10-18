import { readFileSync } from "node:fs";
import path from "node:path";
import { db } from "../lib/db";

async function main() {
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
