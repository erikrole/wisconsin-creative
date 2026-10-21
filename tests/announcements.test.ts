import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import {
  announcementState,
  audienceIdForRoles,
  isSafeAnnouncementUrl,
  parseAnnouncementBody,
  validateAnnouncementDraft,
} from "@/lib/announcements";
import { announcementCreateBody, announcementPatchBody } from "@/lib/schemas/announcements";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
  user: { id: "user-1", role: "STUDENT" },
}));

vi.mock("@/lib/db", () => ({
  db: {
    announcement: {
      findFirst: mocks.findFirst,
      findMany: mocks.findMany,
      findUnique: mocks.findUnique,
      count: mocks.count,
    },
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
import { GET as getHistory } from "@/app/api/announcements/history/route";

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

  it("accepts only our own uploaded images, at most 4", () => {
    const blob = "https://abc.public.blob.vercel-storage.com/announcements/1.png";
    expect(announcementCreateBody.parse({ ...base, imageUrls: [blob] }).imageUrls).toEqual([blob]);
    expect(announcementCreateBody.parse(base).imageUrls).toEqual([]);
    expect(() => announcementCreateBody.parse({ ...base, imageUrls: ["https://evil.example/x.png"] })).toThrow(ZodError);
    expect(() => announcementCreateBody.parse({ ...base, imageUrls: Array(5).fill(blob) })).toThrow(ZodError);
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
    mocks.count.mockResolvedValue(0);
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
      imageUrls: ["https://x.public.blob.vercel-storage.com/a.png"], imageAlt: "Shift board",
      publishedAt: new Date("2026-10-18T00:00:00Z"),
    });
    mocks.count.mockResolvedValue(3);
    const json = await (await getActive(new Request("http://test/api/announcements/active"), noParams)).json();
    expect(json.data).toMatchObject({
      id: "a1", kindLabel: "New", title: "Hi", ctaLabel: null, remaining: 2, imageAlt: "Shift board",
      imageUrls: ["https://x.public.blob.vercel-storage.com/a.png"],
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

describe("validateAnnouncementDraft", () => {
  const ok = {
    title: "Scheduling is faster",
    body: "Open trades sit at the top.",
    ctaLabel: "",
    ctaUrl: "",
    showOnWeb: true,
    showOnIos: true,
    endsAt: "",
  };
  const now = new Date("2026-10-18T12:00:00");

  it("accepts a complete draft", () => {
    expect(validateAnnouncementDraft(ok, now)).toEqual({});
  });

  it("asks for a title and a message", () => {
    expect(validateAnnouncementDraft({ ...ok, title: "  ", body: "" }, now)).toEqual({
      title: "Add a title",
      body: "Add a message",
    });
  });

  it("wants a button label and link together, and a safe link", () => {
    expect(validateAnnouncementDraft({ ...ok, ctaLabel: "Open" }, now).ctaUrl).toMatch(/Add a link/);
    expect(validateAnnouncementDraft({ ...ok, ctaUrl: "/releases" }, now).ctaLabel).toMatch(/Add a label/);
    expect(validateAnnouncementDraft({ ...ok, ctaLabel: "Open", ctaUrl: "javascript:x" }, now).ctaUrl).toMatch(/https/);
    expect(validateAnnouncementDraft({ ...ok, ctaLabel: "Open", ctaUrl: "/releases" }, now)).toEqual({});
  });

  it("needs at least one platform and a future end time", () => {
    expect(validateAnnouncementDraft({ ...ok, showOnWeb: false, showOnIos: false }, now).platforms).toBeDefined();
    expect(validateAnnouncementDraft({ ...ok, endsAt: "2026-10-18T11:00" }, now).endsAt).toMatch(/future/);
    expect(validateAnnouncementDraft({ ...ok, endsAt: "2026-10-19T11:00" }, now)).toEqual({});
  });
});

describe("announcement schema end time", () => {
  const base = {
    kind: "FEATURE",
    title: "Hello",
    body: "World",
    imageUrls: [],
    roles: [],
    showOnWeb: true,
    showOnIos: true,
  };

  it("rejects a past end time on create and edit", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(() => announcementCreateBody.parse({ ...base, endsAt: past })).toThrow(ZodError);
    expect(() => announcementPatchBody.parse({ endsAt: past })).toThrow(ZodError);
    expect(() => announcementPatchBody.parse({ showOnWeb: false, showOnIos: false })).toThrow(ZodError);
  });

  it("accepts a future end time or none", () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    expect(announcementCreateBody.parse({ ...base, endsAt: future }).endsAt).toBeInstanceOf(Date);
    expect(announcementCreateBody.parse({ ...base, endsAt: null }).endsAt).toBeNull();
  });
});

describe("announcement history route", () => {
  beforeEach(() => {
    mocks.findMany.mockReset();
    mocks.user.role = "STUDENT";
  });

  it("lists every published announcement for this role and platform, newest first, with seen state", async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: "a2",
        kind: "NOTICE",
        title: "Ended one",
        body: "Gone now",
        ctaLabel: null,
        ctaUrl: null,
        imageUrls: [],
        imageAlt: null,
        publishedAt: new Date("2026-10-10T00:00:00Z"),
        endsAt: new Date("2026-10-12T00:00:00Z"),
        dismissals: [{ dismissedAt: new Date("2026-10-11T00:00:00Z") }],
      },
      {
        id: "a1",
        kind: "FEATURE",
        title: "Fresh one",
        body: "Hello\n\n- A",
        ctaLabel: "Open",
        ctaUrl: "/releases",
        imageUrls: ["https://blob.example/x.jpg"],
        imageAlt: "Alt",
        publishedAt: new Date("2026-10-09T00:00:00Z"),
        endsAt: null,
        dismissals: [],
      },
    ]);

    const res = await getHistory(new Request("https://app.example.com/api/announcements/history?platform=ios"), {
      params: Promise.resolve({}),
    });
    const body = await res.json();

    const call = mocks.findMany.mock.calls[0]?.[0];
    const where = call?.where;
    expect(where.showOnIos).toBe(true);
    expect(where.publishedAt.lte).toBeInstanceOf(Date);
    expect(where.OR).toEqual([{ roles: { isEmpty: true } }, { roles: { has: "STUDENT" } }]);
    // No dismissal filter: history keeps what the splash already showed.
    expect(where.dismissals).toBeUndefined();
    expect(call?.include.dismissals.where).toEqual({ userId: "user-1" });

    expect(body.data).toEqual([
      expect.objectContaining({
        id: "a2",
        kindLabel: "Heads up",
        blocks: [{ type: "paragraph", text: "Gone now" }],
        endsAt: "2026-10-12T00:00:00.000Z",
        seenAt: "2026-10-11T00:00:00.000Z",
      }),
      expect.objectContaining({
        id: "a1",
        kindLabel: "New",
        blocks: [
          { type: "paragraph", text: "Hello" },
          { type: "list", items: ["A"] },
        ],
        ctaLabel: "Open",
        ctaUrl: "/releases",
        imageUrls: ["https://blob.example/x.jpg"],
        endsAt: null,
        seenAt: null,
      }),
    ]);
    expect(body.data[0]).not.toHaveProperty("remaining");
  });
});
