import crypto from "node:crypto";
import type { Role } from "@prisma/client";
import { Redis } from "@upstash/redis";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/http";
import type { CompanionRole } from "@/lib/companion-projection-contract";

const SESSION_TTL_SECONDS = 90 * 24 * 60 * 60;
const SESSION_PREFIX = "gear-tracker:companion:session:v1:";
const USER_SESSION_PREFIX = "gear-tracker:companion:user-sessions:v1:";
const USER_EPOCH_PREFIX = "gear-tracker:companion:user-epoch:v1:";
const DEVICE_HASH_KEY = "gear-tracker:companion:devices:v1";
const PROJECTION_KEY = "gear-tracker:companion:projection:v1";
const PROJECTION_REVISION_KEY = "gear-tracker:companion:projection-revision:v1";

type CompanionTokenPayload = {
  version: 1;
  jti: string;
  userId: string;
  role: CompanionRole;
  expiresAt: number;
  epoch: number;
};

type CompanionSessionRecord = {
  userId: string;
  role: CompanionRole;
  expiresAt: number;
  epoch: number;
};

type CompanionDeviceRecord = CompanionSessionRecord & {
  jti: string;
  token: string;
};

let redis: Redis | null | undefined;

function getCompanionRedis(): Redis {
  if (redis !== undefined) {
    if (!redis) throw new HttpError(503, "Companion updates are not configured.");
    return redis;
  }

  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  redis = url && token ? new Redis({ url, token }) : null;
  if (!redis) throw new HttpError(503, "Companion updates are not configured.");
  return redis;
}

function signature(value: string): Buffer {
  return crypto.createHmac("sha256", env.sessionSecret).update(value).digest();
}

function encode(payload: CompanionTokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${signature(body).toString("base64url")}`;
}

function decode(token: string): CompanionTokenPayload {
  const [body, suppliedSignature, extra] = token.split(".");
  if (!body || !suppliedSignature || extra) throw new HttpError(401, "Invalid companion credential.");

  const supplied = Buffer.from(suppliedSignature, "base64url");
  const expected = signature(body);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    throw new HttpError(401, "Invalid companion credential.");
  }

  let payload: Partial<CompanionTokenPayload>;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new HttpError(401, "Invalid companion credential.");
  }

  if (
    payload.version !== 1 ||
    typeof payload.jti !== "string" ||
    typeof payload.userId !== "string" ||
    (payload.role !== "ADMIN" && payload.role !== "STAFF") ||
    typeof payload.expiresAt !== "number" ||
    typeof payload.epoch !== "number"
  ) {
    throw new HttpError(401, "Invalid companion credential.");
  }
  if (payload.expiresAt <= Date.now()) throw new HttpError(401, "Companion credential expired.");
  return payload as CompanionTokenPayload;
}

function bearerToken(req: Request): string {
  const authorization = req.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) throw new HttpError(401, "Companion credential required.");
  return authorization.slice("Bearer ".length).trim();
}

export async function issueCompanionSession(user: {
  id: string;
  role: Role;
}, expectedEpoch: number): Promise<string> {
  if (user.role !== "ADMIN" && user.role !== "STAFF") {
    throw new HttpError(403, "The companion is available to staff accounts only.");
  }

  const payload: CompanionTokenPayload = {
    version: 1,
    jti: crypto.randomUUID(),
    userId: user.id,
    role: user.role,
    expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
    epoch: expectedEpoch,
  };
  const record: CompanionSessionRecord = {
    userId: payload.userId,
    role: payload.role,
    expiresAt: payload.expiresAt,
    epoch: payload.epoch,
  };
  const client = getCompanionRedis();
  const userSessionsKey = `${USER_SESSION_PREFIX}${payload.userId}`;
  const issued = await client.eval<[string, string, string, string], number>(
    `
      local current = redis.call("GET", KEYS[1])
      local currentEpoch = current and tonumber(current) or 0
      if currentEpoch ~= tonumber(ARGV[1]) then return 0 end
      redis.call("SET", KEYS[2], ARGV[2], "EX", tonumber(ARGV[3]))
      redis.call("SADD", KEYS[3], ARGV[4])
      redis.call("EXPIRE", KEYS[3], tonumber(ARGV[3]))
      return 1
    `,
    [
      `${USER_EPOCH_PREFIX}${payload.userId}`,
      `${SESSION_PREFIX}${payload.jti}`,
      userSessionsKey,
    ],
    [String(expectedEpoch), JSON.stringify(record), String(SESSION_TTL_SECONDS), payload.jti],
  );
  if (issued !== 1) {
    throw new HttpError(409, "Account access changed during companion enrollment. Sign in again.");
  }
  return encode(payload);
}

/**
 * Renew an authenticated companion lease without waking Neon. The caller's
 * current credential remains valid until the client has durably stored the
 * replacement and explicitly revokes the old session.
 */
export async function renewCompanionSession(req: Request): Promise<string> {
  const payload = await requireCompanion(req);
  return issueCompanionSession(
    { id: payload.userId, role: payload.role },
    payload.epoch,
  );
}

export async function getCompanionUserEpoch(userId: string): Promise<number> {
  return await getCompanionRedis().get<number>(`${USER_EPOCH_PREFIX}${userId}`) ?? 0;
}

export async function requireCompanion(req: Request): Promise<CompanionTokenPayload> {
  const payload = decode(bearerToken(req));
  const client = getCompanionRedis();
  const [record, epoch] = await Promise.all([
    client.get<CompanionSessionRecord>(`${SESSION_PREFIX}${payload.jti}`),
    client.get<number>(`${USER_EPOCH_PREFIX}${payload.userId}`),
  ]);
  if (
    !record ||
    record.userId !== payload.userId ||
    record.role !== payload.role ||
    record.expiresAt !== payload.expiresAt ||
    record.epoch !== payload.epoch ||
    payload.epoch !== (epoch ?? 0)
  ) {
    throw new HttpError(401, "Companion credential expired.");
  }
  return payload;
}

export async function revokeCompanionSession(req: Request): Promise<void> {
  const payload = await requireCompanion(req);
  const client = getCompanionRedis();
  // Remove authority before discovering device rows. A concurrent device
  // registration either lands before this delete and is found below, or sees
  // the missing session in its Lua guard and is rejected.
  await client.del(`${SESSION_PREFIX}${payload.jti}`);
  const devices = await listCompanionDevices();
  const ownedTokens = devices.filter((device) => device.jti === payload.jti).map((device) => device.token);
  await Promise.all([
    client.srem(`${USER_SESSION_PREFIX}${payload.userId}`, payload.jti),
    ...(ownedTokens.length > 0 ? [client.hdel(DEVICE_HASH_KEY, ...ownedTokens)] : []),
  ]);
}

export async function revokeCompanionUser(userId: string): Promise<void> {
  const client = getCompanionRedis();
  const userSessionsKey = `${USER_SESSION_PREFIX}${userId}`;
  // Fence new enrollment before discovering cleanup targets. A credential
  // that was already issued is now invalid, while an overlapping issuer sees
  // the changed epoch and cannot add a new live session after this scan.
  await client.incr(`${USER_EPOCH_PREFIX}${userId}`);
  const [sessionIds, devices] = await Promise.all([
    client.smembers<string[]>(userSessionsKey),
    listCompanionDevices(),
  ]);
  const ownedTokens = devices.filter((device) => device.userId === userId).map((device) => device.token);
  await Promise.all([
    ...sessionIds.map((id) => client.del(`${SESSION_PREFIX}${id}`)),
    ...(ownedTokens.length > 0 ? [client.hdel(DEVICE_HASH_KEY, ...ownedTokens)] : []),
  ]);
  await client.del(userSessionsKey);
}

export async function registerCompanionDevice(
  session: CompanionTokenPayload,
  token: string,
): Promise<void> {
  const record: CompanionDeviceRecord = {
    jti: session.jti,
    userId: session.userId,
    role: session.role,
    expiresAt: session.expiresAt,
    epoch: session.epoch,
    token,
  };
  const registered = await getCompanionRedis().eval<[string, string, string], number>(
    `
      if redis.call("EXISTS", KEYS[1]) == 0 then return 0 end
      local current = redis.call("GET", KEYS[2])
      local currentEpoch = current and tonumber(current) or 0
      if currentEpoch ~= tonumber(ARGV[1]) then return 0 end
      redis.call("HSET", KEYS[3], ARGV[2], ARGV[3])
      return 1
    `,
    [
      `${SESSION_PREFIX}${session.jti}`,
      `${USER_EPOCH_PREFIX}${session.userId}`,
      DEVICE_HASH_KEY,
    ],
    [String(session.epoch), token, JSON.stringify(record)],
  );
  if (registered !== 1) throw new HttpError(401, "Companion credential expired.");
}

export async function listCompanionDevices(): Promise<CompanionDeviceRecord[]> {
  const raw = await getCompanionRedis().hgetall<Record<string, string | CompanionDeviceRecord>>(DEVICE_HASH_KEY);
  if (!raw) return [];
  const now = Date.now();
  const devices: CompanionDeviceRecord[] = [];
  for (const value of Object.values(raw)) {
    try {
      const record = typeof value === "string" ? JSON.parse(value) as CompanionDeviceRecord : value;
      if (record.expiresAt > now && typeof record.token === "string") devices.push(record);
    } catch {
      // Ignore malformed external-cache rows. APNs registration can repair them.
    }
  }
  return devices;
}

export async function revokeCompanionDeviceTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  await getCompanionRedis().hdel(DEVICE_HASH_KEY, ...tokens);
}

export async function writeCompanionProjection<T extends { revision: number }>(
  projection: T,
): Promise<boolean> {
  const script = `
    local current = redis.call("GET", KEYS[1])
    if current then
      local ok, decoded = pcall(cjson.decode, current)
      if ok and decoded["revision"] and tonumber(decoded["revision"]) >= tonumber(ARGV[2]) then
        return 0
      end
    end
    redis.call("SET", KEYS[1], ARGV[1])
    return 1
  `;
  const installed = await getCompanionRedis().eval<[string, string], number>(
    script,
    [PROJECTION_KEY],
    [JSON.stringify(projection), String(projection.revision)],
  );
  return installed === 1;
}

export async function nextCompanionProjectionRevision(): Promise<number> {
  return getCompanionRedis().incr(PROJECTION_REVISION_KEY);
}

export async function readCompanionProjection<T>(): Promise<T | null> {
  return getCompanionRedis().get<T>(PROJECTION_KEY);
}

export function resetCompanionRedisForTests(): void {
  redis = undefined;
}
