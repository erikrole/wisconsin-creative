/* Client-safe URL normalization for purchase and source links entered by staff. */

const INVALID_URL_MESSAGE = "Enter a valid http or https URL";

/** Trim, default to https, and validate an http(s) URL. Empty input returns "". */
export function normalizeExternalUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error(INVALID_URL_MESSAGE);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(INVALID_URL_MESSAGE);
  }
  return parsed.toString();
}

/** Bare host for display: "https://www.bhphotovideo.com/c/x" → "bhphotovideo.com". */
export function externalUrlHost(value: string): string {
  try {
    return normalizeExternalUrl(value).replace(/^https?:\/\//, "").split("/")[0]?.replace(/^www\./, "") ?? "";
  } catch {
    return "";
  }
}
