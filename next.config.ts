import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 수집기(Playwright)는 GitHub Actions에서만 돌고 웹 번들에는 포함되지 않는다.
  serverExternalPackages: ["playwright"],
  poweredByHeader: false,
};

export default nextConfig;
