import { del, get, put, type GetBlobResult } from "@vercel/blob";
import { isPreviewEnvironment, isolatedIntegrationValue } from "@/lib/environment-safety";

type SignatureArtifactKind = "png" | "svg";

type SignatureBlobAuthOptions = Pick<Parameters<typeof put>[2], "token" | "oidcToken" | "storeId">;

function privateSignatureBlobAuth(): SignatureBlobAuthOptions {
  const token = isolatedIntegrationValue("SIGNATURE_BLOB_READ_WRITE_TOKEN");
  if (token) return { token };

  const storeId = isPreviewEnvironment() ? "" : process.env.SIGNATURE_BLOB_STORE_ID;
  const oidcToken = process.env.VERCEL_OIDC_TOKEN;
  if (storeId && oidcToken) return { storeId, oidcToken };

  throw new Error("Private Signature Blob storage is not configured");
}

export function isPrivateSignatureStorageConfigured(): boolean {
  return Boolean(
    isolatedIntegrationValue("SIGNATURE_BLOB_READ_WRITE_TOKEN") ||
      (!isPreviewEnvironment() && process.env.VERCEL_OIDC_TOKEN && process.env.SIGNATURE_BLOB_STORE_ID),
  );
}

export function buildSignatureArtifactPath(
  collectionId: string,
  memberId: string,
  revisionId: string,
  kind: SignatureArtifactKind,
): string {
  return `signatures/${collectionId}/${memberId}/${revisionId}.${kind}`;
}

export async function uploadPrivateSignatureArtifact(input: {
  path: string;
  body: Buffer;
  contentType: "image/png" | "image/svg+xml";
  allowOverwrite?: boolean;
}): Promise<void> {
  const auth = privateSignatureBlobAuth();
  await put(input.path, input.body, {
    access: "private",
    ...auth,
    addRandomSuffix: false,
    allowOverwrite: input.allowOverwrite ?? false,
    contentType: input.contentType,
    cacheControlMaxAge: 60,
  });
}

export async function deletePrivateSignatureArtifacts(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await del(paths, privateSignatureBlobAuth());
}

export async function getPrivateSignatureArtifact(
  path: string,
): Promise<Extract<GetBlobResult, { statusCode: 200 }> | null> {
  const result = await get(path, { access: "private", useCache: false, ...privateSignatureBlobAuth() });
  if (!result || result.statusCode !== 200) return null;
  return result;
}
