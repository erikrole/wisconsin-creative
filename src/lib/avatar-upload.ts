import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";

export async function uploadAvatarPhoto(userId: string, file: File, expectedAvatarUrl: string | null, expectedActorId: string | null): Promise<string | undefined> {
  const uploadId = crypto.randomUUID();
  const body = new FormData(); body.append("file", file); body.append("uploadId", uploadId);
  let uncertain = true;
  try {
    const res = await fetch(`/api/users/${encodeURIComponent(userId)}/avatar`, {
    method: "POST", body, headers: { "x-avatar-url": expectedAvatarUrl ?? "", ...(expectedActorId ? { "x-expected-actor-id": expectedActorId } : {}) },
  });
  if (handleAuthRedirect(res)) return undefined;
  if (!res.ok) { uncertain = false; throw new Error(await parseErrorMessage(res, "Your photo couldn’t be saved. Your crop is still here.")); }
  const json = await parseJsonSafely<{ data?: { avatarUrl?: string } }>(res);
  if (!json?.data?.avatarUrl) throw new Error("The upload could not be confirmed. Refresh your profile before trying again.");
  return json.data.avatarUrl;
  } catch (reason) {
    if (uncertain) {
      try {
        const res = await fetch(`/api/users/${encodeURIComponent(userId)}/avatar`);
        const json = await parseJsonSafely<{ data?: { id?: string; avatarUrl?: string | null } }>(res);
        if (res.ok && json?.data?.id === userId && json.data.avatarUrl?.includes(`/${uploadId}-`)) return json.data.avatarUrl;
      } catch { /* Keep the crop when a save cannot be confirmed. */ }
    }
    throw reason;
  }
}

export async function removeAvatarPhoto(userId: string, expectedAvatarUrl: string, expectedActorId: string | null): Promise<boolean> {
  let uncertain = true;
  try {
    const res = await fetch(`/api/users/${encodeURIComponent(userId)}/avatar`, { method: "DELETE", headers: { "x-avatar-url": expectedAvatarUrl, ...(expectedActorId ? { "x-expected-actor-id": expectedActorId } : {}) } });
    if (handleAuthRedirect(res)) return false;
    if (!res.ok) { uncertain = false; throw new Error(await parseErrorMessage(res, "Your photo couldn’t be removed.")); }
    return true;
  } catch (reason) {
    if (uncertain) {
      try {
        const res = await fetch(`/api/users/${encodeURIComponent(userId)}/avatar`);
        const json = await parseJsonSafely<{ data?: { id?: string; avatarUrl?: string | null } }>(res);
        if (res.ok && json?.data?.id === userId && json.data.avatarUrl === null) return true;
      } catch { /* Do not claim removal until the account confirms it. */ }
    }
    throw reason;
  }
}
