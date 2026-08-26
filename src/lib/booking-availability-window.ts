export const SERIALIZED_TURNAROUND_BUFFER_MINUTES = 60;
export const TURNAROUND_WARNING_WINDOW_MINUTES = 12 * 60;
export const TURNAROUND_CRITICAL_WINDOW_MINUTES = 2 * 60;

export type TurnaroundSeverity = "warning" | "critical";

export function serializedTurnaroundBufferMs() {
  return SERIALIZED_TURNAROUND_BUFFER_MINUTES * 60_000;
}

export function turnaroundSeverity(gapMinutes: number): TurnaroundSeverity {
  return gapMinutes <= TURNAROUND_CRITICAL_WINDOW_MINUTES ? "critical" : "warning";
}

export function subtractSerializedTurnaroundBuffer(startsAt: Date) {
  return new Date(startsAt.getTime() - serializedTurnaroundBufferMs());
}

export function addSerializedTurnaroundBuffer(endsAt: Date) {
  return new Date(endsAt.getTime() + serializedTurnaroundBufferMs());
}

export function hasSerializedTurnaroundBuffer(args: {
  previousEndsAt: Date | number;
  nextStartsAt: Date | number;
}) {
  const previousEndsAt = args.previousEndsAt instanceof Date ? args.previousEndsAt.getTime() : args.previousEndsAt;
  const nextStartsAt = args.nextStartsAt instanceof Date ? args.nextStartsAt.getTime() : args.nextStartsAt;
  return previousEndsAt + serializedTurnaroundBufferMs() <= nextStartsAt;
}
