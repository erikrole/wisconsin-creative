import { copy, del, get, head, type GetBlobResult, type HeadBlobResult } from "@vercel/blob";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/http";

type ResourceAssetBlobAuth = { token: string };

function resourceAssetBlobAuth(): ResourceAssetBlobAuth {
  const token = env.resourceAssetBlobReadWriteToken;
  if (!token) {
    throw new HttpError(503, "Brand asset storage is not configured.");
  }
  return { token };
}

export function isResourceAssetStorageConfigured(): boolean {
  return Boolean(env.resourceAssetBlobReadWriteToken);
}

export function assertResourceAssetStorageConfigured(): string {
  return resourceAssetBlobAuth().token;
}

export async function headResourceAsset(pathname: string): Promise<HeadBlobResult> {
  try {
    return await head(pathname, resourceAssetBlobAuth());
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(409, "The file upload was not found or could not be verified.");
  }
}

/** Copy an existing private asset to a fresh pathname for restore-as-new-version. */
export async function copyResourceAsset(pathname: string, targetPathname: string, contentType: string) {
  try {
    return await copy(pathname, targetPathname, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: 60,
      contentType,
      ...resourceAssetBlobAuth(),
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, "The previous brand asset version could not be restored.");
  }
}

/** Best-effort cleanup for a newly copied pathname that was not committed. */
export async function deleteResourceAsset(pathname: string): Promise<void> {
  try {
    await del(pathname, resourceAssetBlobAuth());
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error("Could not clean up an uncommitted brand asset blob", error);
  }
}

export async function getResourceAssetBlob(
  pathname: string,
): Promise<Extract<GetBlobResult, { statusCode: 200 }> | null> {
  try {
    const result = await get(pathname, {
      access: "private",
      useCache: false,
      ...resourceAssetBlobAuth(),
    });
    if (!result || result.statusCode !== 200) return null;
    return result;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, "The brand asset could not be retrieved.");
  }
}
