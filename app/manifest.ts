import type { MetadataRoute } from "next";

// 휴대폰 "홈 화면에 추가" 용. 앱처럼 주소창 없이 열린다.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "온재 숙소 관리",
    short_name: "온재",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f7f5",
    theme_color: "#2f6fdf",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
