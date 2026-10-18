import { notFound } from "next/navigation";
import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";

// 처음 설정할 때만 여는 화면. 관리자 비밀번호가 등록되면 자동으로 닫힌다.
export default function SetupPage() {
  if (process.env.ADMIN_PASSWORD_HASH) notFound();
  return (
    <main style={{ maxWidth: 640 }}>
      <h1>비밀값 만들기</h1>
      <p>
        이 화면의 값은 지금 쓰고 계신 브라우저 안에서만 만들어지고, 어디로도 전송되지 않습니다. 만든 값은 Vercel·GitHub 설정에
        붙여넣은 뒤 이 창을 닫으세요. 관리자 비밀번호를 등록하면 이 화면은 더 이상 열리지 않습니다.
      </p>
      <SetupForm />
    </main>
  );
}
