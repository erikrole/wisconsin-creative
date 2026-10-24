/**
 * Server-side Pencil sample hygiene. Capture itself now happens in the native
 * Wisconsin app on iPad (web capture retired 2026-10-07); the app applies the
 * same rule as it records (`ios/Wisconsin/Core/SignatureStrokeRecorder.swift`),
 * and `buildSignatureSvg` applies it again so strokes stored by the retired
 * web capture page still export without their duplicated runs.
 */
type SignatureSamplePoint = { x: number; y: number };

/** Longest sample run that can be delivered twice back to back. Observed repeats are 1-9 samples. */
const SIGNATURE_MAX_REPEATED_RUN = 64;

function samePoint(left: SignatureSamplePoint, right: SignatureSamplePoint): boolean {
  return left.x === right.x && left.y === right.y;
}

/**
 * Appends one sample, then drops a run that now repeats the run right before
 * it exactly (A B A B -> A B). Pencil capture in iPad Safari delivered whole
 * sample batches twice, so every 2026-27 signature retraced about a third of its own
 * length; a 240 Hz Pencil never reproduces a byte-identical run from real
 * motion, so an exact tandem repeat is always a delivery duplicate.
 */
function pushSignatureSample(points: SignatureSamplePoint[], point: SignatureSamplePoint): void {
  points.push(point);
  const maxRun = Math.min(SIGNATURE_MAX_REPEATED_RUN, Math.floor(points.length / 2));
  for (let run = 1; run <= maxRun; run += 1) {
    const end = points.length;
    let repeated = true;
    for (let offset = 1; offset <= run; offset += 1) {
      if (!samePoint(points[end - offset]!, points[end - run - offset]!)) {
        repeated = false;
        break;
      }
    }
    if (repeated) {
      points.length = end - run;
      return;
    }
  }
}

/** Removes exact back-to-back repeated sample runs from a stored stroke. */
export function removeRepeatedSignatureSamples<T extends SignatureSamplePoint>(points: readonly T[]): T[] {
  const next: T[] = [];
  for (const point of points) pushSignatureSample(next, point);
  return next;
}
