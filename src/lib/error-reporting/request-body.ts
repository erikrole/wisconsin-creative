import { HttpError } from "@/lib/http";

/**
 * Reads a report body as JSON without trusting `content-length`: a chunked
 * upload has none, and `req.json()` would buffer whatever arrives. Reading
 * stops as soon as the body passes `maxBytes`.
 */
export async function readBoundedJson(req: Request, maxBytes: number, label = "Report"): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new HttpError(413, `${label} too large`);
  if (!req.body) throw new HttpError(400, "Request body is required");

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new HttpError(413, `${label} too large`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}
