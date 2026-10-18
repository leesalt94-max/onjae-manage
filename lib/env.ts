// 환경변수 읽기. 없으면 어떤 값이 빠졌는지 바로 알 수 있게 오류를 낸다.
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`환경변수 ${name} 이(가) 설정되지 않았습니다.`);
  return value;
}

export function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}
