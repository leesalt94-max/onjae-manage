import bcrypt from "bcryptjs";

const password = process.argv[2];
if (!password) {
  console.error("사용법: npm run hash-password -- '비밀번호'");
  process.exit(1);
}
const hash = bcrypt.hashSync(password, 12);
console.log("Vercel·GitHub 비밀값에 넣을 값:");
console.log(hash);
// .env 파일은 $ 를 변수로 해석하므로 로컬에서는 이스케이프한 값을 쓴다.
console.log("\n로컬 .env.local 에 넣을 줄:");
console.log(`ADMIN_PASSWORD_HASH=${hash.replace(/\$/g, "\\$")}`);
