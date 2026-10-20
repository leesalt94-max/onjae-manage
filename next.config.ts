import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 수집기(Playwright)는 GitHub Actions에서만 돌고 웹 번들에는 포함되지 않는다.
  serverExternalPackages: ["playwright"],
  poweredByHeader: false,
  // 손님 안내 사진 올리기 (휴대폰에서 줄여 올리지만 여유를 둔다)
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
};

export default nextConfig;
