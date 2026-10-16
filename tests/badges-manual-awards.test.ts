import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockTx } = vi.hoisted(() => ({
  mockTx: {
    user: {
      findUnique: vi.fn(),
    },
    badgeDefinition: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    studentBadge: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    notification: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
    _mockTx: mockTx,
  },
}));

vi.mock("@/lib/services/notifications", () => ({
  sendPushToUser: vi.fn().mockResolvedValue(undefined),
}));

import { awardBadgeManually } from "@/lib/badges/queries";
import { sendPushToUser } from "@/lib/services/notifications";

const targetUser = {
  id: "staff-1",
  name: "Staff One",
  role: "STAFF",
  active: true,
  notificationPrefs: null,
};

const definition = {
  id: "badge-1",
  key: "first_trade",
  name: "Team Player",
  active: true,
};

const award = {
  id: "award-1",
  userId: "staff-1",
  definitionId: "badge-1",
  awardedAt: new Date("2026-05-09T20:00:00.000Z"),
  source: "MANUAL",
  note: "Staff pick",
  definition: {
    id: "badge-1",
    key: "first_trade",
    name: "Team Player",
    description: "Complete a shift trade.",
    icon: "Handshake",
    category: "TRADE",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockTx.user.findUnique.mockResolvedValue(targetUser);
  mockTx.badgeDefinition.findUnique.mockResolvedValue(definition);
  mockTx.badgeDefinition.create.mockResolvedValue({
    id: "badge-custom",
    key: "custom_guinea_pig",
    name: "Guinea Pig",
    active: true,
  });
  mockTx.studentBadge.findUnique.mockResolvedValue(null);
  mockTx.studentBadge.create.mockResolvedValue(award);
  mockTx.notification.create.mockResolvedValue({});
});

describe("manual badge awards", () => {
  it("creates a manual award and persistent inbox notification by default", async () => {
    await awardBadgeManually({
      userId: "staff-1",
      definitionId: "badge-1",
      awardedById: "admin-1",
      note: "Staff pick",
    });

    expect(mockTx.studentBadge.create).toHaveBeenCalledWith({
      data: {
        userId: "staff-1",
        definitionId: "badge-1",
        source: "MANUAL",
        awardedById: "admin-1",
        note: "Staff pick",
      },
      include: {
        definition: {
          select: {
            id: true,
            key: true,
            name: true,
            description: true,
            icon: true,
            category: true,
            kind: true,
            trigger: true,
            threshold: true,
            ruleKey: true,
            active: true,
            sortOrder: true,
          },
        },
      },
    });
    expect(mockTx.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "staff-1",
        type: "badge_awarded",
        payload: expect.objectContaining({
          href: "/staff/staff-1?tab=badges",
        }),
      }),
    });
    expect(sendPushToUser).not.toHaveBeenCalled();
  });

  it("skips the inbox notification when badge notifications are muted", async () => {
    mockTx.user.findUnique.mockResolvedValue({
      ...targetUser,
      notificationPrefs: {
        pausedUntil: null,
        channels: { email: true, push: true },
        badges: false,
      },
    });

    await awardBadgeManually({
      userId: "staff-1",
      definitionId: "badge-1",
      awardedById: "admin-1",
    });

    expect(mockTx.studentBadge.create).toHaveBeenCalled();
    expect(mockTx.notification.create).not.toHaveBeenCalled();
    expect(sendPushToUser).not.toHaveBeenCalled();
  });

  it("rejects duplicate manual awards", async () => {
    mockTx.studentBadge.findUnique.mockResolvedValue({ id: "award-existing" });

    await expect(
      awardBadgeManually({
        userId: "staff-1",
        definitionId: "badge-1",
        awardedById: "admin-1",
      }),
    ).rejects.toThrow("Badge already awarded");
    expect(mockTx.studentBadge.create).not.toHaveBeenCalled();
    expect(mockTx.notification.create).not.toHaveBeenCalled();
  });

  it("rejects manual awards for inactive users", async () => {
    mockTx.user.findUnique.mockResolvedValue({
      ...targetUser,
      active: false,
    });

    await expect(
      awardBadgeManually({
        userId: "staff-1",
        definitionId: "badge-1",
        awardedById: "admin-1",
      }),
    ).rejects.toThrow("Active user not found");
    expect(mockTx.studentBadge.create).not.toHaveBeenCalled();
  });

  it("creates a reusable custom definition before awarding it", async () => {
    mockTx.badgeDefinition.findUnique.mockResolvedValue(null);
    mockTx.studentBadge.create.mockResolvedValue({
      ...award,
      definitionId: "badge-custom",
      definition: {
        id: "badge-custom",
        key: "custom_guinea_pig",
        name: "Guinea Pig",
        description: "Signed up early to help test the app.",
        icon: "Trophy",
        category: "MILESTONE",
      },
    });

    await awardBadgeManually({
      userId: "staff-1",
      customDefinition: {
        name: "Guinea Pig",
        description: "Signed up early to help test the app.",
        icon: "Trophy",
      },
      awardedById: "admin-1",
      note: "Testing cohort",
    });

    expect(mockTx.badgeDefinition.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        key: "custom_guinea_pig",
        name: "Guinea Pig",
        description: "Signed up early to help test the app.",
        icon: "Trophy",
        category: "MILESTONE",
        kind: "RULE",
        trigger: "manual",
        ruleKey: "custom_guinea_pig",
        active: true,
      }),
      select: {
        id: true,
        key: true,
        name: true,
        active: true,
      },
    });
    expect(mockTx.studentBadge.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        definitionId: "badge-custom",
        note: "Testing cohort",
      }),
    }));
  });
});
