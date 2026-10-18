import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import {
  announcementState,
  audienceIdForRoles,
  isSafeAnnouncementUrl,
  parseAnnouncementBody,
} from "@/lib/announcements";
import { announcementCreateBody, announcementPatchBody } from "@/lib/schemas/announcements";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
  user: { id: "user-1", role: "STUDENT" },
}));

vi.mock("@/lib/db", () => ({
  db: {
    announcement: { findFirst: mocks.findFirst, findUnique: mocks.findUnique },
    announcementDismissal: { upsert: mocks.upsert },
  },
}));
vi.mock("@/lib/api", () => ({
  withAuth: <P extends Record<string, string>>(
    handler: (req: Request, ctx: { user: typeof mocks.user; params: P }) => Promise<Response>,
  ) => async (req: Request, ctx: { params?: Promise<P> }) =>
    handler(req, { user: mocks.user, params: (await ctx?.params) as P }),
}));
vi.mock("@/lib/rbac", () => ({ requirePermission: vi.fn() }));

import { GET as getActive } from "@/app/api/announcements/active/route";
import { POST as dismiss } from "@/app/api/announcements/[id]/dismiss/route";

describe("parseAnnouncementBody", () => {
  it("splits paragraphs and bullets and drops empty lines", () => {
    expect(parseAnnouncementBody("Hello there.\nStill one paragraph.\n\n- One\n- Two\n\nBye")).toEqual([
      { type: "paragraph", text: "Hello there. Still one paragraph." },
      { type: "list", items: ["One", "Two"] },
      { type: "paragraph", text: "Bye" },
    ]);
  });

  it("treats markup as plain text", () => {
    expect(parseAnnouncementBody("<script>alert(1)</script>")).toEqual([
      { type: "paragraph", text: "<script>alert(1)</script>" },
    ]);
  });
});

describe("announcement links", () => {
  it("allows app paths and https only", () => {
    expect(isSafeAnnouncementUrl("/releases")).toBe(true);
    expect(isSafeAnnouncementUrl("https://wisconsincreative.com/x")).toBe(true);
    expect(isSafeAnnouncementUrl("//evil.example")).toBe(false);
    expect(isSafeAnnouncementUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeAnnouncementUrl("http://insecure.example")).toBe(false);
  });
});

describe("announcement state", () => {
  const now = new Date("2026-10-18T12:00:00Z");
  it("derives draft, scheduled, live, and ended", () => {
    expect(announcementState({ publishedAt: null, endsAt: null }, now)).toBe("draft");
    expect(announcementState({ publishedAt: "2026-10-19T00:00:00Z", endsAt: null }, now)).toBe("scheduled");
    expect(announcementState({ publishedAt: "2026-10-17T00:00:00Z", endsAt: null }, now)).toBe("live");
    expect(announcementState({ publishedAt: "2026-10-17T00:00:00Z", endsAt: "2026-10-18T11:00:00Z" }, now)).toBe("ended");
  });
  it("maps roles back to an audience preset", () => {
    expect(audienceIdForRoles([])).toBe("everyone");
    expect(audienceIdForRoles(["STAFF", "ADMIN"])).toBe("team");
  });
});

describe("announcement schemas", () => {
  const base = { kind: "FEATURE", title: "Hi", body: "There", roles: [], showOnWeb: true, showOnIos: true };

  it("requires a button label and link together", () => {
    expect(() => announcementCreateBody.parse({ ...base, ctaLabel: "Go" })).toThrow(ZodError);
    expect(announcementCreateBody.parse({ ...base, ctaLabel: "Go", ctaUrl: "/releases" }).publish).toBe(false);
  });

  it("rejects an unsafe link and an announcement shown nowhere", () => {
    expect(() => announcementCreateBody.parse({ ...base, ctaLabel: "Go", ctaUrl: "javascript:x" })).toThrow(ZodError);
    expect(() => announcementCreateBody.parse({ ...base, showOnWeb: false, showOnIos: false })).toThrow(ZodError);
  });

  it("turns blank optional text into null on edit", () => {
    expect(announcementPatchBody.parse({ ctaLabel: "", ctaUrl: "" })).toMatchObject({ ctaLabel: null, ctaUrl: null });
  });
});

const noParams = { params: Promise.resolve({}) };

describe("announcement read routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user = { id: "user-1", role: "STUDENT" };
  });

  it("returns null when nothing is unseen", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const res = await getActive(new Request("http://test/api/announcements/active"), noParams);
    expect(await res.json()).toEqual({ data: null });
  });

  it("filters to published, not ended, this role and platform, not yet dismissed", async () => {
    mocks.findFirst.mockResolvedValue(null);
    await getActive(new Request("http://test/api/announcements/active?platform=ios"), noParams);
    const { where } = mocks.findFirst.mock.calls[0]![0];
    expect(where.showOnIos).toBe(true);
    expect(where.showOnWeb).toBeUndefined();
    expect(where.dismissals).toEqual({ none: { userId: "user-1" } });
    expect(where.AND[1]).toEqual({ OR: [{ roles: { isEmpty: true } }, { roles: { has: "STUDENT" } }] });
  });

  it("shapes the payload the apps decode", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "a1", kind: "FEATURE", title: "Hi", body: "One\n\n- Two", ctaLabel: null, ctaUrl: null,
      publishedAt: new Date("2026-10-18T00:00:00Z"),
    });
    const json = await (await getActive(new Request("http://test/api/announcements/active"), noParams)).json();
    expect(json.data).toMatchObject({
      id: "a1", kindLabel: "New", title: "Hi", ctaLabel: null,
      blocks: [{ type: "paragraph", text: "One" }, { type: "list", items: ["Two"] }],
    });
  });

  it("dismissing is idempotent and 404s on an unknown id", async () => {
    mocks.findUnique.mockResolvedValue({ id: "a1" });
    const ctx = { params: Promise.resolve({ id: "a1" }) };
    await dismiss(new Request("http://test", { method: "POST" }), ctx);
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: {} }));
    mocks.findUnique.mockResolvedValue(null);
    await expect(dismiss(new Request("http://test", { method: "POST" }), ctx)).rejects.toThrow("Announcement not found");
  });
});
