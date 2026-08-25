import type { NextResponse } from "next/server";
import { fail, HttpError } from "@/lib/http";
import { isRolePreviewBlockedRequest, readRolePreviewFromRequest } from "@/lib/role-preview";

type HandlerCtx<P extends Record<string, string> = Record<string, string>> = {
  params: P;
};

class MalformedRequestJsonError extends Error {
  constructor(cause: SyntaxError) {
    super("Request body must be valid JSON", { cause });
    this.name = "MalformedRequestJsonError";
  }
}

export function tagRequestJsonParseErrors(req: Request) {
  const parseJson = req.json.bind(req);
  Object.defineProperty(req, "json", {
    configurable: true,
    value: async () => {
      try {
        return await parseJson();
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new MalformedRequestJsonError(error);
        }
        throw error;
      }
    },
  });
  return req;
}

export function failRequest(error: unknown) {
  // Only errors tagged at the actual Request.json() boundary are malformed
  // input. A SyntaxError thrown later by handler code remains a server error.
  if (error instanceof MalformedRequestJsonError) {
    return fail(new HttpError(400, "Request body must be valid JSON"));
  }
  return fail(error);
}

/**
 * Public API route handler (no auth required).
 * Kept separate from the authenticated wrappers so external-only routes do
 * not load the database-backed auth module as a side effect of importing it.
 */
export function withHandler<P extends Record<string, string> = Record<string, string>>(
  handler: (req: Request, ctx: HandlerCtx<P>) => Promise<NextResponse>
) {
  return async (req: Request, context: { params: Promise<P> }): Promise<NextResponse> => {
    try {
      if (await readRolePreviewFromRequest(req) && isRolePreviewBlockedRequest(req)) {
        throw new HttpError(403, "Preview mode is read-only");
      }
      const params = (context?.params ? await context.params : {}) as P;
      return await handler(tagRequestJsonParseErrors(req), { params });
    } catch (error) {
      return failRequest(error);
    }
  };
}
