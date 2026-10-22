"use client";

import { useEffect, useState } from "react";
import { Barlow_Condensed } from "next/font/google";
import type { LabelKind } from "@/lib/brother-label-csv";
import { cn } from "@/lib/utils";

// Stand-in for Gotham XNarrow, the templates' face; Macs with Gotham installed use the real one.
const condensed = Barlow_Condensed({ subsets: ["latin"], weight: ["700", "900"], display: "swap" });

/** 12 mm TZe tape on the PT-D610BT: 33.6pt across, white ink on black. */
export const TAPE_WIDTH_PT = 33.6;

type TemplateLayout = {
  /** Fixed tape length in pt; autolength templates grow with the text. */
  length?: number;
  /** Distance from the leading edge to the text frame. */
  start: number;
  text: {
    width: number;
    /** Frame top and height across the tape; omitted frames span the tape and center. */
    y?: number;
    height?: number;
    size: number;
    weight: 700 | 900;
    align: "center" | "top";
    /** Batteries.lbx turns its number a quarter turn. */
    rotated?: boolean;
  };
  qr?: { gap: number; y: number; size: number };
  end: number;
};

/**
 * Object frames copied from the .lbx files on the share
 * (Media/RESOURCES/GUIDES/Labels/Brother Printer). Positions are in points
 * along the tape (x) and across it (y), exactly as P-touch Editor stores them.
 */
export const TEMPLATE_LAYOUTS: Record<LabelKind, TemplateLayout> = {
  // Text6 x 8.7 w 12.2 (AUTOLEN), Barcode7 x 25.5 y 1.8 30×30.
  body: { start: 8.7, text: { width: 12.2, size: 7.6, weight: 700, align: "center" }, qr: { gap: 4.6, y: 1.8, size: 30 }, end: 5.6 },
  // Text6 x 6.5 w 30 (AUTOLEN), Barcode7 x 40.5 y 1.5 30×30.
  lens: { start: 6.5, text: { width: 30, size: 7.6, weight: 700, align: "center" }, qr: { gap: 4, y: 1.5, size: 30 }, end: 5.6 },
  // 28.8pt fixed; Text1 x 8.6 w 11.3 h 28.
  sd: { length: 28.8, start: 8.6, text: { width: 11.3, y: 2.8, height: 28, size: 7.7, weight: 700, align: "center" }, end: 8.9 },
  // Numbers.lbx: Text1 x 9 y 8.3 w 13 h 16.6 at 13.8pt (AUTOLEN).
  text: { start: 9, text: { width: 13, y: 8.3, height: 16.6, size: 13.8, weight: 700, align: "center" }, end: 5.6 },
  // Number-Tag.lbx: Text3 x 5.5 y 9.8 w 10.2 h 13.2 at 11pt, Barcode2 x 18.5 y 6.3 20×20.
  numberTag: { start: 5.5, text: { width: 10.2, y: 9.8, height: 13.2, size: 11, weight: 700, align: "top" }, qr: { gap: 2.8, y: 6.3, size: 20 }, end: 5.6 },
  // Batteries.lbx: 57.6pt fixed; Text6 x 7.3 y 4.2 w 14.4 h 25.2 at 12pt heavy, turned 270° (P-touch turns clockwise,
  // so it reads bottom to top); Barcode2 x 20.5 y 1.8 30×30.
  battery: { length: 57.6, start: 7.3, text: { width: 14.4, y: 4.2, height: 25.2, size: 12, weight: 900, align: "center", rotated: true }, qr: { gap: -1.2, y: 1.8, size: 30 }, end: 7.1 },
};

/** The text lines a template prints for a row, blank lines included (they hold the layout). */
export function templateLines(kind: LabelKind, row: { dept: string; model: string; number: string }): string[] {
  switch (kind) {
    case "body":
    case "lens":
    case "sd":
      return [row.dept, row.model, row.number];
    case "text":
      return [row.model];
    case "numberTag":
    case "battery":
      return [row.number || row.model];
  }
}

/** White-on-transparent QR as SVG markup, so it sits on the black tape like the print. */
function useQrSvg(value: string) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    if (!value) {
      setSvg(null);
      return;
    }
    let live = true;
    import("qrcode").then((QRCode) =>
      QRCode.toString(value, {
        type: "svg",
        margin: 1,
        errorCorrectionLevel: "M",
        color: { dark: "#ffffffff", light: "#00000000" },
      }).then(
        (markup) => {
          if (live) setSvg(markup);
        },
        () => {
          if (live) setSvg(null);
        },
      ),
    );
    return () => {
      live = false;
    };
  }, [value]);
  return svg;
}

/**
 * The label as the template prints it, to scale: tape width, frame positions,
 * QR size and font sizes all come from the .lbx file for that template.
 */
export function LabelPreview({
  kind,
  dept,
  model,
  number,
  qrCodeValue,
  height = 44,
  className,
}: {
  kind: LabelKind;
  dept: string;
  model: string;
  number: string;
  qrCodeValue: string;
  /** Rendered tape width in px; everything scales from it. */
  height?: number;
  className?: string;
}) {
  const layout = TEMPLATE_LAYOUTS[kind];
  const scale = height / TAPE_WIDTH_PT;
  const pt = (value: number) => value * scale;
  const svg = useQrSvg(layout.qr ? qrCodeValue : "");
  const lines = templateLines(kind, { dept, model, number });
  const { text } = layout;

  const textFrame = (
    <span
      className={cn("relative flex shrink-0 flex-col", text.align === "top" ? "justify-start" : "justify-center")}
      style={{
        minWidth: pt(text.width),
        marginLeft: pt(layout.start),
        marginTop: pt(text.y ?? 0),
        height: pt(text.height ?? TAPE_WIDTH_PT),
        width: text.rotated || layout.length ? pt(text.width) : undefined,
      }}
    >
      <span
        className="flex flex-col items-center whitespace-pre text-center"
        style={{
          fontSize: pt(text.size),
          lineHeight: 1.2,
          fontWeight: text.weight,
          ...(text.rotated
            ? {
                position: "absolute",
                left: "50%",
                top: "50%",
                width: pt(text.height ?? TAPE_WIDTH_PT),
                transform: "translate(-50%, -50%) rotate(-90deg)",
              }
            : {}),
        }}
      >
        {lines.map((line, index) => (
          <span key={index}>{line || " "}</span>
        ))}
      </span>
    </span>
  );

  return (
    <div
      aria-hidden
      className={cn(
        condensed.className,
        "relative flex shrink-0 items-start overflow-hidden rounded-[3px] bg-black text-white shadow-[0_0_0_1px_rgba(255,255,255,0.14),0_1px_2px_rgba(0,0,0,0.25)]",
        className,
      )}
      style={{
        height,
        width: layout.length ? pt(layout.length) : undefined,
        paddingRight: layout.length ? undefined : pt(layout.end),
        fontFamily: `"Gotham XNarrow", ${condensed.style.fontFamily}`,
      }}
    >
      {textFrame}
      {layout.qr && (
        <span
          className="block shrink-0 [&>svg]:size-full"
          style={{ width: pt(layout.qr.size), height: pt(layout.qr.size), marginLeft: pt(layout.qr.gap), marginTop: pt(layout.qr.y) }}
          dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
        />
      )}
    </div>
  );
}
