import {
  penSettingsSchema,
  SIGNATURE_MAX_COORDINATE,
  SIGNATURE_MAX_POINTS_PER_STROKE,
  SIGNATURE_MAX_STROKES,
  type SignaturePenSettings,
  type SignatureStroke,
} from "./types";

export type SignatureCropBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SignaturePoint = { x: number; y: number };

export type SignatureCurveSegment =
  | { type: "L"; to: SignaturePoint }
  | { type: "Q"; control: SignaturePoint; to: SignaturePoint };

export type SignatureCurve = {
  start: SignaturePoint;
  segments: SignatureCurveSegment[];
};

type SignatureBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

/**
 * A pen can leave a tiny isolated mark when it touches down in a corner
 * before the signer starts. Keep short marks that sit inside/near the real
 * signature (for example, the dot in an initial), but remove an isolated
 * corner mark when there is other substantive ink.
 */
export function removeAccidentalSignatureStrokes(
  strokes: SignatureStroke[],
  settings: Pick<SignaturePenSettings, "strokeWidth" | "cropPadding">,
): SignatureStroke[] {
  if (strokes.length < 2) return strokes;

  const maxAccidentalLength = Math.max(8, settings.strokeWidth * 2);
  const shortStrokeIndexes = new Set(
    strokes.flatMap((stroke, index) => signatureStrokeLength(stroke) <= maxAccidentalLength ? [index] : []),
  );
  if (shortStrokeIndexes.size === strokes.length) return strokes;

  const substantiveBounds = strokes
    .filter((_stroke, index) => !shortStrokeIndexes.has(index))
    .map(signatureStrokeBounds)
    .reduce(combineSignatureBounds, null);
  if (!substantiveBounds) return strokes;

  const allowedGap = Math.max(32, settings.cropPadding * 1.5);
  const cleaned = strokes.filter((stroke, index) => {
    if (!shortStrokeIndexes.has(index)) return true;
    return signatureBoundsGap(signatureStrokeBounds(stroke), substantiveBounds) <= allowedGap;
  });

  return cleaned.length > 0 ? cleaned : strokes;
}

/**
 * Builds the shared display/artifact curve for a normalized stroke. Midpoints
 * keep the curve close to the Pencil path while removing the visible corners
 * produced by drawing every coalesced point as an independent line segment.
 */
export function buildSignatureCurve(points: readonly SignaturePoint[]): SignatureCurve {
  const [start, ...rest] = points;
  if (!start) throw new Error("Signature stroke has no first point");
  if (rest.length === 0) return { start, segments: [{ type: "L", to: start }] };
  if (rest.length === 1) return { start, segments: [{ type: "L", to: rest[0]! }] };

  const segments: SignatureCurveSegment[] = [];
  for (let index = 1; index < points.length - 1; index += 1) {
    const control = points[index]!;
    const next = points[index + 1]!;
    segments.push({
      type: "Q",
      control,
      to: { x: (control.x + next.x) / 2, y: (control.y + next.y) / 2 },
    });
  }
  const last = points.at(-1)!;
  segments.push({ type: "Q", control: last, to: last });
  return { start, segments };
}

export function normalizeSignatureStrokes(
  strokes: SignatureStroke[],
): SignatureStroke[] {
  if (strokes.length < 1 || strokes.length > SIGNATURE_MAX_STROKES) {
    throw new Error(`Signature must contain between 1 and ${SIGNATURE_MAX_STROKES} strokes`);
  }

  return strokes.map((stroke) => {
    if (stroke.points.length < 1 || stroke.points.length > SIGNATURE_MAX_POINTS_PER_STROKE) {
      throw new Error("Signature stroke has an invalid point count");
    }
    return {
      points: stroke.points.map((point) => {
        if (
          !Number.isFinite(point.x) ||
          !Number.isFinite(point.y) ||
          point.x < 0 ||
          point.y < 0 ||
          point.x > SIGNATURE_MAX_COORDINATE ||
          point.y > SIGNATURE_MAX_COORDINATE
        ) {
          throw new Error("Signature coordinates are outside the allowed canvas");
        }
        return { x: Number(point.x.toFixed(3)), y: Number(point.y.toFixed(3)) };
      }),
    };
  });
}

function signatureStrokeLength(stroke: SignatureStroke): number {
  let length = 0;
  for (let index = 1; index < stroke.points.length; index += 1) {
    const previous = stroke.points[index - 1]!;
    const current = stroke.points[index]!;
    length += Math.hypot(current.x - previous.x, current.y - previous.y);
  }
  return length;
}

function signatureStrokeBounds(stroke: SignatureStroke): SignatureBounds {
  return stroke.points.reduce<SignatureBounds>((bounds, point) => ({
    minX: Math.min(bounds.minX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxX: Math.max(bounds.maxX, point.x),
    maxY: Math.max(bounds.maxY, point.y),
  }), {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  });
}

function combineSignatureBounds(left: SignatureBounds | null, right: SignatureBounds): SignatureBounds {
  if (!left) return right;
  return {
    minX: Math.min(left.minX, right.minX),
    minY: Math.min(left.minY, right.minY),
    maxX: Math.max(left.maxX, right.maxX),
    maxY: Math.max(left.maxY, right.maxY),
  };
}

function signatureBoundsGap(left: SignatureBounds, right: SignatureBounds): number {
  const horizontalGap = left.maxX < right.minX
    ? right.minX - left.maxX
    : right.maxX < left.minX
      ? left.minX - right.maxX
      : 0;
  const verticalGap = left.maxY < right.minY
    ? right.minY - left.maxY
    : right.maxY < left.minY
      ? left.minY - right.maxY
      : 0;
  return Math.hypot(horizontalGap, verticalGap);
}

export function computeSignatureCropBounds(
  strokes: SignatureStroke[],
  settings: SignaturePenSettings,
): SignatureCropBounds {
  const points = strokes.flatMap((stroke) => stroke.points);
  if (points.length === 0) throw new Error("Signature has no points");

  const radius = settings.strokeWidth / 2;
  const minX = Math.floor(Math.min(...points.map((point) => point.x)) - radius - settings.cropPadding);
  const minY = Math.floor(Math.min(...points.map((point) => point.y)) - radius - settings.cropPadding);
  const maxX = Math.ceil(Math.max(...points.map((point) => point.x)) + radius + settings.cropPadding);
  const maxY = Math.ceil(Math.max(...points.map((point) => point.y)) + radius + settings.cropPadding);
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);

  if (width > settings.maxWidth || height > settings.maxHeight) {
    throw new Error("Signature exceeds the configured crop dimensions");
  }

  return { x: minX, y: minY, width, height };
}

export function formatSignatureNumber(value: number): string {
  return Number(value.toFixed(3)).toString();
}

export function signaturePathData(
  stroke: SignatureStroke,
  crop: SignatureCropBounds,
): string {
  const curve = buildSignatureCurve(stroke.points);
  const point = (value: SignaturePoint) => `${formatSignatureNumber(value.x - crop.x)} ${formatSignatureNumber(value.y - crop.y)}`;
  const commands = [`M ${point(curve.start)}`];
  for (const segment of curve.segments) {
    if (segment.type === "L") {
      commands.push(`L ${point(segment.to)}`);
    } else {
      commands.push(`Q ${point(segment.control)} ${point(segment.to)}`);
    }
  }
  return commands.join(" ");
}

export const SIGNATURE_REFERENCE_CROP_WIDTH = 640;
export const SIGNATURE_REFERENCE_CROP_HEIGHT = 256;
export const SIGNATURE_STROKE_SCALE_MIN = 0.5;
export const SIGNATURE_STROKE_SCALE_MAX = 2;

type SignatureExportLimits = Pick<SignaturePenSettings, "maxWidth" | "maxHeight">;

function signatureExportScale(width: number, height: number, limits: SignatureExportLimits): number {
  return Math.min(limits.maxWidth / width, limits.maxHeight / height);
}

/**
 * The exported artifact is the tight crop scaled into the configured export
 * box, so one absolute canvas width lands at a different apparent weight for
 * every signer: a small signature is magnified more than a large one. Scaling
 * the rendered width by the same factor the export applies keeps one uniform
 * line across a roster. The multiplier is clamped so a degenerate crop degrades
 * toward the configured width instead of a hairline or a blob.
 */
export function resolveSignatureStrokeWidth(
  crop: Pick<SignatureCropBounds, "width" | "height">,
  settings: SignaturePenSettings,
): number {
  const referenceScale = signatureExportScale(
    SIGNATURE_REFERENCE_CROP_WIDTH,
    SIGNATURE_REFERENCE_CROP_HEIGHT,
    settings,
  );
  const cropScale = signatureExportScale(crop.width, crop.height, settings);
  const multiplier = Math.min(
    SIGNATURE_STROKE_SCALE_MAX,
    Math.max(SIGNATURE_STROKE_SCALE_MIN, referenceScale / cropScale),
  );
  return Number((settings.strokeWidth * multiplier).toFixed(3));
}

function escapeSignatureAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

export type SignatureSvgSource = {
  svg: string;
  width: number;
  height: number;
  strokeWidth: number;
  cropBounds: SignatureCropBounds;
};

/**
 * Shared sanitized path-only SVG for both the server artifact pipeline and the
 * admin settings sample, so a configured pen is previewed through the same
 * renderer that produces the delivered file.
 */
export function buildSignatureSvg(
  strokes: SignatureStroke[],
  settingsInput: SignaturePenSettings,
): SignatureSvgSource {
  const settings = penSettingsSchema.parse(settingsInput);
  const normalized = removeAccidentalSignatureStrokes(normalizeSignatureStrokes(strokes), settings);
  // Crop padding depends on the rendered width and the rendered width depends
  // on the crop, so measure against the configured width first and settle the
  // bounds against the width actually drawn.
  const measuredCrop = computeSignatureCropBounds(normalized, settings);
  const strokeWidth = resolveSignatureStrokeWidth(measuredCrop, settings);
  const cropBounds = computeSignatureCropBounds(normalized, { ...settings, strokeWidth });
  const paths = normalized
    .map((stroke) => `<path d="${signaturePathData(stroke, cropBounds)}"/>`)
    .join("");

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cropBounds.width}" height="${cropBounds.height}" viewBox="0 0 ${cropBounds.width} ${cropBounds.height}">`,
    `<g fill="none" stroke="${escapeSignatureAttribute(settings.strokeColor)}" stroke-width="${formatSignatureNumber(strokeWidth)}" stroke-linecap="round" stroke-linejoin="round">`,
    paths,
    "</g>",
    "</svg>",
  ].join("");

  return { svg, width: cropBounds.width, height: cropBounds.height, strokeWidth, cropBounds };
}

/**
 * A representative signature used only to preview pen settings. It is sized
 * near the reference crop so the sample reads as a typical capture rather than
 * an extreme one.
 */
export const SIGNATURE_PEN_SAMPLE_STROKES: SignatureStroke[] = [
  {
    points: [
      { x: 60, y: 150 }, { x: 70, y: 110 }, { x: 90, y: 80 }, { x: 115, y: 62 }, { x: 140, y: 60 },
      { x: 155, y: 75 }, { x: 150, y: 100 }, { x: 130, y: 120 }, { x: 108, y: 132 }, { x: 95, y: 145 },
      { x: 100, y: 158 }, { x: 120, y: 164 }, { x: 150, y: 160 }, { x: 175, y: 148 }, { x: 195, y: 132 },
      { x: 210, y: 120 }, { x: 222, y: 135 }, { x: 234, y: 150 }, { x: 246, y: 132 }, { x: 258, y: 116 },
      { x: 268, y: 132 }, { x: 280, y: 148 }, { x: 292, y: 130 }, { x: 305, y: 112 },
    ],
  },
  {
    points: [
      { x: 330, y: 150 }, { x: 340, y: 115 }, { x: 352, y: 85 }, { x: 368, y: 68 }, { x: 386, y: 66 },
      { x: 398, y: 80 }, { x: 394, y: 104 }, { x: 378, y: 124 }, { x: 360, y: 138 }, { x: 350, y: 150 },
      { x: 356, y: 162 }, { x: 376, y: 166 }, { x: 404, y: 158 }, { x: 430, y: 142 }, { x: 452, y: 124 },
      { x: 466, y: 112 }, { x: 478, y: 128 }, { x: 490, y: 144 }, { x: 502, y: 126 }, { x: 514, y: 110 },
      { x: 526, y: 126 }, { x: 538, y: 142 }, { x: 552, y: 124 }, { x: 566, y: 106 },
    ],
  },
  {
    points: [
      { x: 120, y: 182 }, { x: 200, y: 176 }, { x: 300, y: 172 }, { x: 400, y: 174 },
      { x: 500, y: 180 }, { x: 570, y: 188 },
    ],
  },
];

export const SIGNATURE_EXPORT_MIN_WIDTH = 1_000;

export type SignatureExportSize = { width: number; height: number; scale: number };

/**
 * Mirrors the raster fit the artifact pipeline applies, including the minimum
 * exported width, so an admin can be shown the real delivered size before any
 * signature exists. `tests/signature-capture.test.ts` pins this against the
 * bytes sharp actually produces.
 */
export function resolveSignatureExportSize(
  source: Pick<SignatureCropBounds, "width" | "height">,
  limits: SignatureExportLimits,
): SignatureExportSize {
  const scale = signatureExportScale(source.width, source.height, limits);
  const height = Math.round(source.height * scale);
  const width = Math.round(source.width * scale);
  return { width: Math.max(width, SIGNATURE_EXPORT_MIN_WIDTH), height, scale };
}
