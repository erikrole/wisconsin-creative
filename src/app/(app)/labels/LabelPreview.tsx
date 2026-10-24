"use client";
import { useEffect, useState } from "react";
import type { LabelKind } from "@/lib/brother-label-csv";
import { renderBrotherLabel, type LabelBitmap } from "@/lib/brother-label-render";
import { cn } from "@/lib/utils";

export function LabelPreview({ kind, dept, model, number, qrCodeValue, height = 76, className }: {
  kind: LabelKind; dept: string; model: string; number: string; qrCodeValue: string; height?: number; className?: string;
}) {
  const key = JSON.stringify([kind, dept, model, number, qrCodeValue]);
  const [result, setResult] = useState<{ key: string; bitmap?: LabelBitmap; error?: string }>();
  useEffect(() => {
    let live = true;
    void renderBrotherLabel({ kind, dept, model, number, qrCodeValue, copies: 1 }).then(
      (bitmap) => { if (live) setResult({ key, bitmap }); },
      (error: unknown) => { if (live) setResult({ key, error: error instanceof Error ? error.message : "Preview unavailable" }); },
    );
    return () => { live = false; };
  }, [key, kind, dept, model, number, qrCodeValue]);
  const current = result?.key === key ? result : undefined;
  if (current?.error) return <span role="status" className="text-xs text-destructive">{current.error}</span>;
  return (
    <span className={cn("block shrink-0 overflow-hidden rounded-[3px] bg-black shadow-[0_0_0_1px_rgba(255,255,255,0.14),0_2px_4px_rgba(0,0,0,0.18)]", className)} style={{ width: current?.bitmap ? height * current.bitmap.width / current.bitmap.height : height * 194 / 76, maxWidth: "100%", aspectRatio: `${current?.bitmap?.width ?? 194} / 76` }}>
      {/* Generated local PNG: identical pixels are sent to the printer. */}
      {!current && <span aria-hidden className="flex h-full min-h-16 items-center justify-center px-3 text-xs text-white/60">Preparing preview…</span>}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {current?.bitmap && <img src={current.bitmap.preview} alt="" aria-hidden width={current.bitmap.width} height={current.bitmap.height} className="block h-auto w-full" style={{ imageRendering: "pixelated" }} />}
    </span>
  );
}
