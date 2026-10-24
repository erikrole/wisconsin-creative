import { useState, type Dispatch, type SetStateAction } from "react";

/**
 * Local draft state that starts from `source` and resets whenever `source`
 * changes (by Object.is). The reset happens during render, so the field never
 * paints a stale value the way a syncing effect would.
 */
export function useSyncedDraft<T>(source: T): [T, Dispatch<SetStateAction<T>>];
export function useSyncedDraft<S, T>(source: S, toDraft: (source: S) => T): [T, Dispatch<SetStateAction<T>>];
export function useSyncedDraft<S, T>(source: S, toDraft?: (source: S) => T): [T, Dispatch<SetStateAction<T>>] {
  const derive = (value: S) => (toDraft ? toDraft(value) : (value as unknown as T));
  const [draft, setDraft] = useState(() => derive(source));
  const [syncedSource, setSyncedSource] = useState(source);
  if (!Object.is(syncedSource, source)) {
    setSyncedSource(source);
    setDraft(derive(source));
  }
  return [draft, setDraft];
}
