"use client";

import { useActionState } from "react";
import { createPcTokenAction } from "../actions";

// 코드를 만들면 이 화면에만 한 번 보여 준다. 새로 만들면 예전 코드는 더 이상 쓸 수 없다.
export function PcTokenForm({ hasToken }: { hasToken: boolean }) {
  const [state, action, pending] = useActionState(async () => createPcTokenAction(), null);
  return (
    <form action={action} className="stack">
      {state?.token ? (
        <>
          <p>아래 코드를 복사해서 컴퓨터 수집 프로그램이 물어볼 때 붙여 넣으세요. 이 화면을 벗어나면 다시 볼 수 없어요.</p>
          <input readOnly value={state.token} onFocus={(e) => e.currentTarget.select()} style={{ fontFamily: "monospace" }} />
        </>
      ) : (
        <p className="muted">{hasToken ? "연결 코드가 만들어져 있어요. 컴퓨터를 바꾸거나 코드를 잃어버렸으면 새로 만드세요." : "아직 연결 코드가 없어요."}</p>
      )}
      <button type="submit" className="secondary" disabled={pending}>
        {hasToken || state?.token ? "새 연결 코드 만들기 (예전 코드는 끊김)" : "연결 코드 만들기"}
      </button>
    </form>
  );
}
