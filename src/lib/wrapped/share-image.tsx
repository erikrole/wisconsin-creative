import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import type { WrappedCard } from "@/lib/wrapped/recap";

/** 4:5, the size that posts and saves cleanly almost everywhere. */
const SIZE = { width: 1080, height: 1350 };

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}

const FONT_DIR = join(process.cwd(), "src/lib/wrapped/fonts");

/** Barlow, the app's brand face (OFL), so the image matches the product. */
async function loadFonts() {
  const weights = [500, 700, 900] as const;
  const files = await Promise.all(weights.map((weight) => readFile(join(FONT_DIR, `barlow-latin-${weight}-normal.woff`))));
  return weights.map((weight, index) => ({ name: "Barlow", data: files[index]!, weight, style: "normal" as const }));
}

/** The summary card as a PNG, shared by the web and iOS players. */
export async function renderWrappedShareImage(person: { name: string }, summary: WrappedCard): Promise<ImageResponse> {
  const fonts = await loadFonts();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 80,
          backgroundColor: "#c5050c",
          backgroundImage: "radial-gradient(circle at 85% 8%, rgba(255,140,120,0.55), transparent 45%)",
          fontFamily: "Barlow",
        }}
      >
        <div style={{ display: "flex", fontSize: 30, fontWeight: 700, letterSpacing: "0.16em", color: "rgba(255,255,255,0.78)", textTransform: "uppercase" }}>
          Creative Wrapped · Fall 2026
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 36, padding: 56, borderRadius: 56, backgroundColor: "#ffffff", color: "#111318" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 96, height: 96, borderRadius: 48, backgroundColor: "#fde7e7", color: "#c5050c", fontSize: 38, fontWeight: 800 }}>
              {initials(person.name)}
            </div>
            <div style={{ display: "flex", marginLeft: 28, fontSize: 44, fontWeight: 800 }}>{person.name}</div>
          </div>
          <div style={{ display: "flex", marginTop: 52, fontSize: 28, fontWeight: 700, letterSpacing: "0.14em", color: "#5b616e", textTransform: "uppercase" }}>
            My style
          </div>
          <div style={{ display: "flex", fontSize: 84, fontWeight: 900, color: "#c5050c", letterSpacing: "-0.02em" }}>{summary.value}</div>
          <div style={{ display: "flex", flexWrap: "wrap", marginTop: 40, justifyContent: "space-between" }}>
            {(summary.items ?? []).map((item) => (
              <div
                key={item.label}
                style={{ display: "flex", flexDirection: "column", width: "48.5%", marginBottom: 22, padding: "30px 34px", borderRadius: 32, backgroundColor: "#f3f4f6" }}
              >
                <div style={{ display: "flex", fontSize: 56, fontWeight: 900 }}>{item.value}</div>
                <div style={{ display: "flex", fontSize: 28, color: "#5b616e" }}>{item.label}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "center", marginTop: 12, fontSize: 24, color: "#5b616e" }}>{summary.sentence}</div>
        </div>
      </div>
    ),
    { ...SIZE, fonts },
  );
}
