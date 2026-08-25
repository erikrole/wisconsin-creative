"use client";

import Image from "next/image";
import { useMemo } from "react";
import { buildSignatureSvg, resolveSignatureExportSize, SIGNATURE_PEN_SAMPLE_STROKES } from "@/lib/signatures/geometry";
import type { SignatureExportSize } from "@/lib/signatures/geometry";
import type { SignaturePenSettings } from "@/lib/signatures/types";

type SignaturePenSample =
  | { ok: true; url: string; width: number; height: number; exported: SignatureExportSize }
  | { ok: false; message: string };

const TRANSPARENCY_GROUND =
  "bg-[linear-gradient(45deg,var(--muted)_25%,transparent_25%),linear-gradient(-45deg,var(--muted)_25%,transparent_25%),linear-gradient(45deg,transparent_75%,var(--muted)_75%),linear-gradient(-45deg,transparent_75%,var(--muted)_75%)] bg-[length:16px_16px] bg-[position:0_0,0_8px,8px_-8px,-8px_0px]";

/**
 * Renders a representative signature through the same builder that produces the
 * delivered artifact, so ink and line thickness are configured against real
 * output instead of a bare number. Capture is iPad-only, which otherwise leaves
 * an admin tuning these values with nothing to look at.
 */
export function SignaturePenPreview({ settings }: { settings: SignaturePenSettings }) {
  const sample = useMemo((): SignaturePenSample => {
    try {
      const source = buildSignatureSvg(SIGNATURE_PEN_SAMPLE_STROKES, settings);
      return {
        ok: true,
        url: `data:image/svg+xml,${encodeURIComponent(source.svg)}`,
        width: source.width,
        height: source.height,
        exported: resolveSignatureExportSize(source, settings),
      };
    } catch (previewError) {
      return {
        ok: false,
        message: previewError instanceof Error && previewError.message.startsWith("Signature exceeds")
          ? "A typical signature exceeds these maximum dimensions and would fail to save."
          : "Enter valid pen settings to preview the output.",
      };
    }
  }, [settings]);

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Pen preview</p>
      {!sample.ok ? (
        <div className="flex min-h-28 items-center justify-center rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          {sample.message}
        </div>
      ) : (
        <>
          <div className={`flex min-h-28 items-center justify-center rounded-md border p-4 ${TRANSPARENCY_GROUND}`}>
            <Image
              src={sample.url}
              alt="Sample signature rendered with the current pen settings"
              width={sample.width}
              height={sample.height}
              unoptimized
              className="h-auto max-h-24 w-auto max-w-full object-contain"
              decoding="async"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            A typical signature at these settings exports as a transparent {sample.exported.width} × {sample.exported.height} px PNG.
            Line thickness scales with how large each person signs, so every signature in the roster delivers the same weight.
          </p>
        </>
      )}
    </div>
  );
}
