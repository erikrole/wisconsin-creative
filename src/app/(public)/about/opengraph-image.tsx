import { ImageResponse } from "next/og";

export const alt = "Wisconsin Creative Wisconsin Creative: reservations, Schedule, and gear custody.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          backgroundColor: "#050505",
          backgroundImage: "radial-gradient(circle at 50% 0%, rgba(160,0,0,0.45), transparent 55%)",
          color: "#ffffff",
        }}
      >
        <div
          style={{
            fontSize: 26,
            fontWeight: 600,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.6)",
          }}
        >
          Wisconsin Creative Wisconsin Creative
        </div>
        <div
          style={{
            marginTop: 32,
            fontSize: 88,
            fontWeight: 800,
            lineHeight: 1.02,
            maxWidth: 980,
          }}
        >
          Reservations, Schedule, and gear custody.
        </div>
        <div
          style={{
            marginTop: 36,
            fontSize: 30,
            lineHeight: 1.4,
            maxWidth: 900,
            color: "rgba(255,255,255,0.72)",
          }}
        >
          Public pages about Wisconsin Creative for Wisconsin Creative.
        </div>
      </div>
    ),
    { ...size }
  );
}
