import { Role } from "@prisma/client";

/** Same-origin JSON request, as the browser sends it, for withAuth/withKiosk routes. */
export function jsonRequest(path: string, method: string, body?: unknown): Request {
  return new Request(`https://app.example.com${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      host: "app.example.com",
      origin: "https://app.example.com",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function routeCtx<P extends Record<string, string>>(params: P) {
  return { params: Promise.resolve(params) };
}

export function authUser(role: Role, id = `${role.toLowerCase()}-1`) {
  return { id, email: `${id}@example.com`, name: id, role, avatarUrl: null };
}

/** cuid-shaped ids that pass `z.string().cuid()`. */
export const CUID_A = "cm000000000000000000000001";
export const CUID_B = "cm000000000000000000000002";
export const CUID_C = "cm000000000000000000000003";
