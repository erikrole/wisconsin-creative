"use client";

import { useEffect, useState } from "react";
import type { LabelKind } from "@/lib/brother-label-csv";
import { cn } from "@/lib/utils";

/** White-on-transparent QR as SVG markup, so it sits on the black tape like the printed label. */
function useQrSvg(value: string) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    if (!value) {
      setSvg(null);
      return;
    }
    let live = true;
    import("qrcode").then((QRCode) =>
      QRCode.toString(value, { type: "svg", margin: 0, color: { dark: "#ffffffff", light: "#00000000" } }).then(
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
 * A small picture of the Brother tape: white print on black, QR on the left and
 * the text lines the template prints. It is a guide, not a to-scale proof.
 */
export function LabelPreview({
  kind,
  dept,
  model,
  number,
  qrCodeValue,
  size = "sm",
  className,
}: {
  kind: LabelKind;
  dept: string;
  model: string;
  number: string;
  qrCodeValue: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const showQr = kind === "body" || kind === "lens" || kind === "numberTag";
  const svg = useQrSvg(showQr ? qrCodeValue : "");
  const lines =
    kind === "text" ? [model] : kind === "numberTag" ? [number || model] : [dept, model, number].filter(Boolean);
  const qrSize = size === "md" ? "size-11" : "size-8";

  return (
    <div
      aria-hidden
      className={cn(
        "flex shrink-0 items-center gap-2 overflow-hidden rounded-[5px] bg-[#111] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]",
        size === "md" ? "h-14 px-2.5" : "h-11 px-2",
        className,
      )}
    >
      {showQr &&
        (svg ? (
          <span className={cn("block shrink-0 [&>svg]:size-full", qrSize)} dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <span className={cn("block shrink-0 rounded-[2px] border border-dashed border-white/30", qrSize)} />
        ))}
      <span
        className={cn(
          "flex min-w-0 flex-col justify-center font-bold uppercase leading-[1.05] tracking-[0.02em]",
          size === "md" ? "max-w-32 text-[11px]" : "max-w-24 text-[9px]",
          kind === "numberTag" && (size === "md" ? "text-xl" : "text-base"),
        )}
      >
        {lines.length > 0 ? (
          lines.map((line, index) => (
            <span key={index} className="truncate">
              {line}
            </span>
          ))
        ) : (
          <span className="text-white/40">No text</span>
        )}
      </span>
    </div>
  );
}
