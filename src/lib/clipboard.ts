/**
 * Copy text when the browser exposes a usable clipboard API.
 *
 * Callers own the user-facing recovery message because they can name the
 * value that remains visible for manual copying.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text || typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
