import { beforeEach, describe, expect, it, vi } from "vitest";

const allowedEmailStorage = vi.hoisted(() => ({ update: vi.fn(), updateMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { allowedEmail: allowedEmailStorage } }));
vi.mock("@/lib/auth", () => ({ randomHex: vi.fn(), tokenHash: vi.fn(async (raw: string) => "hashed-" + raw) }));

import { randomHex } from "@/lib/auth";
import { inviteTokenMatches, issueInviteToken } from "@/lib/services/invite-token";

let invite: { claimedAt: Date | null; inviteTokenHash: string | null; inviteTokenIssuedAt: Date | null };
beforeEach(() => {
  invite = { claimedAt: null, inviteTokenHash: null, inviteTokenIssuedAt: null };
  vi.mocked(randomHex).mockReturnValueOnce("first-token").mockReturnValue("next-token");
  allowedEmailStorage.update.mockImplementation(async ({ data }) => Object.assign(invite, data));
  allowedEmailStorage.updateMany.mockImplementation(async ({ where, data }) => {
    if (where?.claimedAt === null && invite.claimedAt !== null) return { count: 0 };
    Object.assign(invite, data);
    return { count: 1 };
  });
});

describe("invite token lifecycle", () => {
  it("expires at exactly 30 days and refuses missing or incorrect inbox proof", async () => {
    const token = await issueInviteToken("invite-1");
    const issuedAt = invite.inviteTokenIssuedAt!;
    expect(await inviteTokenMatches(invite, token, new Date(issuedAt.getTime() + 30 * 24 * 60 * 60 * 1000 - 1))).toBe(true);
    expect(await inviteTokenMatches(invite, token, new Date(issuedAt.getTime() + 30 * 24 * 60 * 60 * 1000))).toBe(false);
    expect(await inviteTokenMatches(invite, "wrong-token")).toBe(false);
    expect(await inviteTokenMatches(invite, undefined)).toBe(false);
  });

  it("invalidates the previous link when a new token is issued and rejects a cleared token", async () => {
    const first = await issueInviteToken("invite-1");
    const next = await issueInviteToken("invite-1");
    expect(await inviteTokenMatches(invite, first)).toBe(false);
    expect(await inviteTokenMatches(invite, next)).toBe(true);
    invite.inviteTokenHash = null;
    invite.inviteTokenIssuedAt = null;
    expect(await inviteTokenMatches(invite, next)).toBe(false);
  });

  it("cannot restore a token after a registration has claimed the invite", async () => {
    invite.claimedAt = new Date();
    expect(await issueInviteToken("invite-1")).toBeNull();
    expect(invite.inviteTokenHash).toBeNull();
    expect(invite.inviteTokenIssuedAt).toBeNull();
  });
});
