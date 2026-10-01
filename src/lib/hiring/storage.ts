import { del, get, put, type GetBlobResult } from "@vercel/blob";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/http";

function auth(): { token: string } {
  const token = env.applicantBlobReadWriteToken;
  if (!token) throw new HttpError(503, "Applicant file storage is not configured.");
  return { token };
}

export async function putApplicantFile(pathname: string, body: ArrayBuffer, contentType: string): Promise<void> {
  try {
    await put(pathname, body, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType,
      ...auth(),
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, "The applicant file could not be stored.");
  }
}

export async function getApplicantFile(
  pathname: string,
): Promise<Extract<GetBlobResult, { statusCode: 200 }> | null> {
  try {
    const result = await get(pathname, { access: "private", useCache: false, ...auth() });
    if (!result || result.statusCode !== 200) return null;
    return result;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, "The applicant file could not be retrieved.");
  }
}

/** Best-effort delete; a missing blob counts as deleted. */
export async function deleteApplicantFile(pathname: string): Promise<void> {
  try {
    await del(pathname, auth());
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error("Could not delete an applicant blob", error);
  }
}
