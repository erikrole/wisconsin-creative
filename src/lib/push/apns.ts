import crypto from "crypto";
import http2 from "http2";

const APNS_PROD_HOST = "https://api.push.apple.com";
const APNS_SANDBOX_HOST = "https://api.sandbox.push.apple.com";

// Primary host follows the server environment, but device tokens are minted
// per-build: Xcode development builds carry sandbox tokens even against the
// production server. A sandbox token sent to the production host answers
// BadDeviceToken, so tokens rejected by the primary host are retried on the
// other host before being treated as dead (see dispatch below).
const APNS_PRIMARY_HOST = process.env.NODE_ENV === "production" ? APNS_PROD_HOST : APNS_SANDBOX_HOST;
const APNS_FALLBACK_HOST = APNS_PRIMARY_HOST === APNS_PROD_HOST ? APNS_SANDBOX_HOST : APNS_PROD_HOST;

function makeJWT(): string {
  const keyId = process.env.APNS_KEY_ID!;
  const teamId = process.env.APNS_TEAM_ID!;
  // APNS_P8_KEY is base64-encoded PEM (the entire .p8 file content)
  const p8Key = Buffer.from(process.env.APNS_P8_KEY!, "base64").toString("utf-8");

  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: keyId })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) })
  ).toString("base64url");

  const signingInput = `${header}.${payload}`;
  const sign = crypto.createSign("SHA256");
  sign.update(signingInput);
  const signature = sign.sign({ key: p8Key, dsaEncoding: "ieee-p1363" }, "base64url");

  return `${signingInput}.${signature}`;
}

// Apple rejects provider tokens refreshed more often than every 20 minutes
// (TooManyProviderTokenUpdates); tokens stay valid for an hour. Cache at
// module scope so warm serverless instances reuse one token across a
// notification fan-out instead of minting a JWT per send.
const JWT_TTL_MS = 50 * 60_000;
let cachedJwt: { token: string; mintedAt: number } | null = null;

function getJwt(): string {
  const now = Date.now();
  if (cachedJwt && now - cachedJwt.mintedAt < JWT_TTL_MS) {
    return cachedJwt.token;
  }
  const token = makeJWT();
  cachedJwt = { token, mintedAt: now };
  return token;
}

/**
 * Drop the cached provider token. Called when APNs answers
 * ExpiredProviderToken/InvalidProviderToken — a warm lambda can resume with a
 * token whose wall-clock validity ran out even though the TTL check passed.
 */
function invalidateJwt(): void {
  cachedJwt = null;
}

/**
 * Keep the complete provider exchange inside the Vercel Hobby 10-second
 * function budget. One token can take three serial attempts: primary,
 * provider-token recovery, then the alternate APNs environment.
 */
export const APNS_DISPATCH_TIMEOUT_MS = 7_500;
export const APNS_REQUEST_TIMEOUT_MS = 2_000;
const APNS_STREAM_BATCH_SIZE = 250;
const APNS_PARALLEL_BATCHES = 4;

type DispatchBudget = {
  deadlineAt: number;
  expired: boolean;
  sessions: Set<http2.ClientHttp2Session>;
};

function hasDispatchBudget(budget: DispatchBudget): boolean {
  return !budget.expired && Date.now() < budget.deadlineAt;
}

function remainingDispatchMs(budget: DispatchBudget): number {
  return Math.max(0, budget.deadlineAt - Date.now());
}

/**
 * Connect to APNs with a session error handler attached. Without one, a
 * transient DNS/connection failure emits an unhandled "error" event, which
 * is fatal in Node — it would kill the serverless function mid-request.
 */
function connectApns(host: string, budget: DispatchBudget): http2.ClientHttp2Session {
  const client = http2.connect(host);
  budget.sessions.add(client);
  client.on("error", (err) => {
    console.error("[APNS] session error:", err.message);
  });
  client.once("close", () => {
    budget.sessions.delete(client);
  });
  return client;
}

type TokenOutcome =
  | "ok"
  // BadDeviceToken / Unregistered — token invalid for the host it was sent to
  | "badToken"
  // ExpiredProviderToken / InvalidProviderToken — our JWT, not the device
  | "authError"
  | "error";

interface SendOpts {
  topic: string;
  pushType: "alert" | "background" | "liveactivity";
  priority?: 5 | 10;
}

function sendOne(
  client: http2.ClientHttp2Session,
  jwt: string,
  token: string,
  notification: object,
  opts: SendOpts,
  budget: DispatchBudget,
): Promise<TokenOutcome> {
  if (!hasDispatchBudget(budget)) {
    return Promise.resolve("error");
  }

  return new Promise((resolve) => {
    let settled = false;
    const settle = (outcome: TokenOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };

    let req: http2.ClientHttp2Stream;
    try {
      req = client.request({
        ":method": "POST",
        ":path": `/3/device/${token}`,
        authorization: `bearer ${jwt}`,
        "apns-topic": opts.topic,
        "apns-push-type": opts.pushType,
        ...(opts.priority ? { "apns-priority": String(opts.priority) } : {}),
        "content-type": "application/json",
      });
    } catch (err) {
      // Session already destroyed (e.g. connection error) — requests on a
      // dead session throw synchronously.
      console.error("[APNS] request open failed:", err instanceof Error ? err.message : err);
      return settle("error");
    }

    const requestTimeoutMs = Math.max(
      1,
      Math.min(APNS_REQUEST_TIMEOUT_MS, remainingDispatchMs(budget)),
    );
    req.setTimeout(requestTimeoutMs, () => {
      console.error(`[APNS] ${token.slice(-8)}: request timed out`);
      req.close(http2.constants.NGHTTP2_CANCEL);
      settle("error");
    });

    let status = 0;
    let body = "";

    req.on("response", (headers) => {
      status = headers[":status"] as number;
    });
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      if (status === 200) return settle("ok");
      try {
        const { reason } = JSON.parse(body) as { reason?: string };
        if (reason === "BadDeviceToken" || reason === "Unregistered") {
          settle("badToken");
        } else if (reason === "ExpiredProviderToken" || reason === "InvalidProviderToken") {
          console.error(`[APNS] provider token rejected (${reason})`);
          settle("authError");
        } else {
          console.error(`[APNS] ${token.slice(-8)}: ${status} ${reason}`);
          settle("error");
        }
      } catch {
        console.error(`[APNS] ${token.slice(-8)}: ${status} (unparseable body)`);
        settle("error");
      }
    });
    req.on("error", (err) => {
      console.error("[APNS] request error:", err.message);
      settle("error");
    });
    req.on("close", () => {
      settle("error");
    });

    req.end(JSON.stringify(notification));
  });
}

/** Sends one bounded token batch over a single HTTP/2 session. */
async function sendSessionBatch(
  host: string,
  jwt: string,
  tokens: string[],
  notification: object,
  opts: SendOpts,
  budget: DispatchBudget,
): Promise<Map<string, TokenOutcome>> {
  const outcomes = new Map<string, TokenOutcome>();
  if (!hasDispatchBudget(budget)) {
    for (const token of tokens) outcomes.set(token, "error");
    return outcomes;
  }

  const client = connectApns(host, budget);
  try {
    await Promise.all(
      tokens.map(async (token) => {
        outcomes.set(token, await sendOne(client, jwt, token, notification, opts, budget));
      })
    );
  } finally {
    client.destroy();
    budget.sessions.delete(client);
  }
  return outcomes;
}

/**
 * Bounds open HTTP/2 streams and sessions. Current selectors cap one dispatch
 * at 1,000 tokens, which fits one four-session wave; the loop is defensive for
 * callers that may be added later.
 */
async function sendBatch(
  host: string,
  jwt: string,
  tokens: string[],
  notification: object,
  opts: SendOpts,
  budget: DispatchBudget,
): Promise<Map<string, TokenOutcome>> {
  const chunks: string[][] = [];
  for (let index = 0; index < tokens.length; index += APNS_STREAM_BATCH_SIZE) {
    chunks.push(tokens.slice(index, index + APNS_STREAM_BATCH_SIZE));
  }

  const outcomes = new Map<string, TokenOutcome>();
  for (let index = 0; index < chunks.length; index += APNS_PARALLEL_BATCHES) {
    if (!hasDispatchBudget(budget)) break;
    const wave = await Promise.all(
      chunks
        .slice(index, index + APNS_PARALLEL_BATCHES)
        .map((chunk) => sendSessionBatch(host, jwt, chunk, notification, opts, budget)),
    );
    for (const batch of wave) {
      for (const [token, outcome] of batch) outcomes.set(token, outcome);
    }
  }
  return outcomes;
}

function isConfigured(topic: string): boolean {
  return !!(
    process.env.APNS_KEY_ID &&
    process.env.APNS_TEAM_ID &&
    process.env.APNS_P8_KEY &&
    topic
  );
}

export interface DispatchResult {
  /** Tokens rejected by BOTH APNs environments — safe to mark revoked. */
  revoked: string[];
  /** Tokens APNs accepted (either environment). */
  accepted: string[];
  /** Count of accepted tokens, retained for existing metrics callers. */
  ok: number;
}

/**
 * Delivery core shared by alert and Live Activity sends.
 *
 * 1. Send to the primary host (production in prod, sandbox in dev).
 * 2. Auth failures (expired/invalid provider token) re-mint the JWT and retry
 *    those tokens once.
 * 3. Tokens the primary host rejects as bad are retried on the other APNs
 *    environment — development builds hold sandbox tokens even against the
 *    production server. Only tokens both environments reject are revoked.
 */
async function dispatch(
  tokens: string[],
  notification: object,
  opts: SendOpts
): Promise<DispatchResult> {
  if (!isConfigured(opts.topic) || tokens.length === 0) {
    return { revoked: [], accepted: [], ok: 0 };
  }

  const budget: DispatchBudget = {
    deadlineAt: Date.now() + APNS_DISPATCH_TIMEOUT_MS,
    expired: false,
    sessions: new Set(),
  };
  const deadlineTimer = setTimeout(() => {
    budget.expired = true;
    console.error(`[APNS] dispatch exceeded ${APNS_DISPATCH_TIMEOUT_MS}ms deadline`);
    for (const client of budget.sessions) client.destroy();
  }, APNS_DISPATCH_TIMEOUT_MS);

  try {
    const outcomes = await sendBatch(
      APNS_PRIMARY_HOST,
      getJwt(),
      tokens,
      notification,
      opts,
      budget,
    );

    const authFailed = tokens.filter((t) => outcomes.get(t) === "authError");
    if (authFailed.length > 0 && hasDispatchBudget(budget)) {
      invalidateJwt();
      const retried = await sendBatch(
        APNS_PRIMARY_HOST,
        getJwt(),
        authFailed,
        notification,
        opts,
        budget,
      );
      for (const [token, outcome] of retried) outcomes.set(token, outcome);
    }

    const revoked: string[] = [];
    const wrongEnv = tokens.filter((t) => outcomes.get(t) === "badToken");
    let fallbackAttempted = 0;
    if (wrongEnv.length > 0 && hasDispatchBudget(budget)) {
      fallbackAttempted = wrongEnv.length;
      const fallback = await sendBatch(
        APNS_FALLBACK_HOST,
        getJwt(),
        wrongEnv,
        notification,
        opts,
        budget,
      );
      for (const [token, outcome] of fallback) {
        if (outcome === "badToken") {
          revoked.push(token);
        }
        outcomes.set(token, outcome);
      }
    }

    const accepted = tokens.filter((token) => outcomes.get(token) === "ok");
    const ok = accepted.length;
    if (ok < tokens.length) {
      console.warn(
        `[APNS] dispatch: ${ok}/${tokens.length} delivered` +
          (fallbackAttempted > 0 ? `, ${fallbackAttempted} retried on fallback env` : "") +
          (revoked.length > 0 ? `, ${revoked.length} revoked` : "") +
          (!hasDispatchBudget(budget) ? ", deadline exhausted" : "")
      );
    }

    return { revoked, accepted, ok };
  } finally {
    clearTimeout(deadlineTimer);
    for (const client of budget.sessions) client.destroy();
    budget.sessions.clear();
  }
}

export async function sendPush(
  deviceTokens: string[],
  opts: {
    title: string;
    body: string;
    payload?: Record<string, unknown>;
    /**
     * APNs category, which selects the long-press action set the native client
     * registered under the same identifier. Omit for a tap-only notification.
     * An identifier the installed build does not know is ignored by iOS, so
     * this stays safe to send ahead of a native release.
     */
    category?: string;
  }
): Promise<DispatchResult> {
  const notification = {
    aps: {
      alert: { title: opts.title, body: opts.body },
      sound: "default",
      ...(opts.category ? { category: opts.category } : {}),
    },
    ...(opts.payload ?? {}),
  };

  return dispatch(deviceTokens, notification, {
    topic: process.env.APNS_BUNDLE_ID!,
    pushType: "alert",
  });
}

export async function sendCompanionInvalidation(
  deviceTokens: string[],
  projectionVersion: string,
): Promise<DispatchResult> {
  const topic = process.env.APNS_MACOS_BUNDLE_ID || "com.erikrole.GearOps";
  return dispatch(
    deviceTokens,
    {
      aps: { "content-available": 1 },
      companionProjectionVersion: projectionVersion,
    },
    {
      topic,
      pushType: "background",
      priority: 5,
    },
  );
}

const liveActivityOpts = (): SendOpts => ({
  topic: `${process.env.APNS_BUNDLE_ID!}.push-type.liveactivity`,
  pushType: "liveactivity",
});

export async function endCheckoutReturnLiveActivityTokens(
  tokens: string[]
): Promise<DispatchResult> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const notification = {
    aps: {
      timestamp: nowSeconds,
      event: "end",
      "dismissal-date": nowSeconds + 120,
      "content-state": {
        endsAt: new Date().toISOString(),
        now: new Date().toISOString(),
        nextNeedAt: null,
        allowsExtend: false,
        urgency: "returned",
      },
    },
  };

  return dispatch(tokens, notification, liveActivityOpts());
}

export async function startCheckoutReturnLiveActivityTokens(
  tokens: string[],
  attrs: {
    bookingId: string;
    bookingTitle: string;
    requesterName: string;
    requesterInitials: string;
    requesterAvatarUrl?: string | null;
    returnTimeText: string;
  },
  state: {
    endsAt: Date;
    nextNeedAt?: Date | null;
    allowsExtend: boolean;
    urgency: "normal" | "warning" | "critical" | "overdue";
  }
): Promise<{ revoked: string[]; ok: number }> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const notification = {
    aps: {
      timestamp: nowSeconds,
      event: "start",
      "attributes-type": "CheckoutReturnActivityAttributes",
      attributes: {
        bookingId: attrs.bookingId,
        bookingTitle: attrs.bookingTitle,
        requesterName: attrs.requesterName,
        requesterInitials: attrs.requesterInitials,
        requesterAvatarUrl: attrs.requesterAvatarUrl ?? null,
        returnTimeText: attrs.returnTimeText,
      },
      "content-state": {
        endsAt: state.endsAt.toISOString(),
        now: new Date().toISOString(),
        nextNeedAt: state.nextNeedAt?.toISOString() ?? null,
        allowsExtend: state.allowsExtend,
        urgency: state.urgency,
      },
      "stale-date": Math.floor((state.endsAt.getTime() + 6 * 60 * 60_000) / 1000),
      "input-push-token": 1,
      alert: {
        title: attrs.bookingTitle,
        body: attrs.returnTimeText,
      },
    },
  };

  return dispatch(tokens, notification, liveActivityOpts());
}

export async function updateCheckoutReturnLiveActivityTokens(
  tokens: string[],
  state: {
    endsAt: Date;
    nextNeedAt?: Date | null;
    allowsExtend: boolean;
    urgency: "normal" | "warning" | "critical" | "overdue";
  },
  opts?: { alert?: { title: string; body: string } }
): Promise<DispatchResult> {
  const notification = {
    aps: {
      timestamp: Math.floor(Date.now() / 1000),
      event: "update",
      "content-state": {
        endsAt: state.endsAt.toISOString(),
        now: new Date().toISOString(),
        nextNeedAt: state.nextNeedAt?.toISOString() ?? null,
        allowsExtend: state.allowsExtend,
        urgency: state.urgency,
      },
      ...(opts?.alert ? { alert: { title: opts.alert.title, body: opts.alert.body } } : {}),
    },
  };

  return dispatch(tokens, notification, liveActivityOpts());
}
