import { ImageResponse } from "next/og";

// 기본 글꼴에 한글이 없어 영문 "ON"(온재)으로 그린다.

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#2f6fdf", color: "#fff", fontSize: 210, fontWeight: 700 }}>
      ON
    </div>,
    size,
  );
}
