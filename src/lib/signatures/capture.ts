import type { SignatureDraftPoint } from "./drafts";

export type SignatureCanvasSize = {
  width: number;
  height: number;
};

type SignatureCanvasViewport = {
  offsetX: number;
  offsetY: number;
  scale: number;
};

type SignatureCanvasRect = SignatureCanvasSize & {
  left: number;
  top: number;
};

function hasPositiveSize(size: SignatureCanvasSize): boolean {
  return Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0;
}

/**
 * Fits one stable logical drawing surface inside the current canvas without
 * stretching either axis. Rotation may add margins, but it never changes the
 * signature coordinates or proportions.
 */
export function signatureCanvasViewport(
  displaySize: SignatureCanvasSize,
  logicalSize: SignatureCanvasSize,
): SignatureCanvasViewport {
  if (!hasPositiveSize(displaySize) || !hasPositiveSize(logicalSize)) {
    throw new Error("Signature canvas has an invalid size");
  }

  const scale = Math.min(
    displaySize.width / logicalSize.width,
    displaySize.height / logicalSize.height,
  );
  return {
    scale,
    offsetX: (displaySize.width - logicalSize.width * scale) / 2,
    offsetY: (displaySize.height - logicalSize.height * scale) / 2,
  };
}

/**
 * Maps a browser Pointer Event location into stable logical signature space.
 * Margins introduced by rotation are deliberately non-drawing regions.
 */
export function signaturePointFromClient(
  clientX: number,
  clientY: number,
  rect: SignatureCanvasRect,
  logicalSize: SignatureCanvasSize,
): SignatureDraftPoint | null {
  const viewport = signatureCanvasViewport(rect, logicalSize);
  const displayX = clientX - rect.left - viewport.offsetX;
  const displayY = clientY - rect.top - viewport.offsetY;
  const renderedWidth = logicalSize.width * viewport.scale;
  const renderedHeight = logicalSize.height * viewport.scale;

  if (displayX < 0 || displayY < 0 || displayX > renderedWidth || displayY > renderedHeight) {
    return null;
  }

  return {
    x: Math.max(0, Math.min(logicalSize.width, displayX / viewport.scale)),
    y: Math.max(0, Math.min(logicalSize.height, displayY / viewport.scale)),
  };
}

/**
 * Keeps every real sample while removing only exact consecutive duplicates.
 * Returning the original array when nothing changed avoids redundant renders.
 */
export function appendDistinctSignaturePoints(
  existing: SignatureDraftPoint[],
  incoming: readonly SignatureDraftPoint[],
): SignatureDraftPoint[] {
  let next = existing;
  let last = existing.at(-1);

  for (const point of incoming) {
    if (last && last.x === point.x && last.y === point.y) continue;
    if (next === existing) next = existing.slice();
    next.push(point);
    last = point;
  }

  return next;
}

/**
 * iPadOS may present a desktop-style Macintosh user agent in Safari. Its
 * touch-point capability is the distinguishing signal from macOS here.
 */
export function isIpadDevice(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  return /iPad/i.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
}

export function isCurrentDeviceIpad(): boolean {
  if (typeof navigator === "undefined") return false;
  return isIpadDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
}

/**
 * A retryable or ambiguous response must keep the durable request ID so the
 * next tap replays the same server operation. Definite client conflicts keep
 * the local draft but start a fresh operation after the operator resolves it.
 */
export function shouldRetainSignatureSaveRequestId(status: number): boolean {
  return status === 425 || status === 429 || status >= 500;
}
