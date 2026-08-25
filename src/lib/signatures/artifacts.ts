import { createHash } from "node:crypto";
import sharp from "sharp";
import { buildSignatureSvg } from "./geometry";
import type { SignatureCropBounds } from "./geometry";
import type { SignaturePenSettings, SignatureStroke } from "./types";

export { buildSignatureSvg };

export type SignatureArtifactBundle = {
  svg: string;
  png: Buffer;
  pngHash: string;
  svgHash: string;
  width: number;
  height: number;
  strokeWidth: number;
  cropBounds: SignatureCropBounds;
};

export const SIGNATURE_PNG_MIN_WIDTH = 1_000;

type RenderedSignaturePng = {
  png: Buffer;
  width: number;
  height: number;
};

export async function renderSignaturePngFromSvg(
  svg: string,
  limits: Pick<SignaturePenSettings, "maxWidth" | "maxHeight"> = { maxWidth: 1_600, maxHeight: 900 },
): Promise<RenderedSignaturePng> {
  const rasterized = await sharp(Buffer.from(svg, "utf8"), { density: 144 })
    .resize({
      width: limits.maxWidth,
      height: limits.maxHeight,
      fit: "inside",
      withoutEnlargement: false,
    })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer({ resolveWithObject: true });

  if (rasterized.info.width >= SIGNATURE_PNG_MIN_WIDTH) {
    return {
      png: rasterized.data,
      width: rasterized.info.width,
      height: rasterized.info.height,
    };
  }

  const missingWidth = SIGNATURE_PNG_MIN_WIDTH - rasterized.info.width;
  const left = Math.floor(missingWidth / 2);
  const right = missingWidth - left;
  const padded = await sharp(rasterized.data)
    .extend({
      left,
      right,
      top: 0,
      bottom: 0,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer({ resolveWithObject: true });

  return {
    png: padded.data,
    width: padded.info.width,
    height: padded.info.height,
  };
}

export async function renderSignatureArtifacts(
  strokes: SignatureStroke[],
  settings: SignaturePenSettings,
): Promise<SignatureArtifactBundle> {
  const source = buildSignatureSvg(strokes, settings);
  const renderedPng = await renderSignaturePngFromSvg(source.svg, settings);
  return {
    ...source,
    png: renderedPng.png,
    width: renderedPng.width,
    height: renderedPng.height,
    pngHash: createHash("sha256").update(renderedPng.png).digest("hex"),
    svgHash: createHash("sha256").update(source.svg, "utf8").digest("hex"),
  };
}
