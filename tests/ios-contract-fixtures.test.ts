import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Role, ShiftWorkerType } from "@prisma/client";
import { jsonRequest } from "./_helpers/route-request";

// iOS contract fixtures: the JSON these routes really send, produced by the
// real handlers (session lookup, wrappers, serialization) with only the
// database mocked. ios/WisconsinTests/WebContractFixtureTests.swift decodes
// the same files with the app's decoder, so a field renamed, dropped or
// retyped on either side fails a test instead of the app. After an intended
// change, rewrite the files with UPDATE_IOS_FIXTURES=1 and run the Swift tests.
const FIXTURE_DIR = path.join(process.cwd(), "tests/fixtures/ios-contract");
const NOW = new Date("2026-10-26T15:00:00.000Z");
const USER_ID = "cm0000000000000000student1";

const mocks = vi.hoisted(() => {
  process.env.SESSION_COOKIE_NAME ??= "wc_session";
  return {
  sessionFindUnique: vi.fn(),
  userFindUnique: vi.fn(),
  notificationFindMany: vi.fn(),
  notificationCount: vi.fn(),
  };
});

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "session-token" }), delete: vi.fn(), set: vi.fn() }),
  headers: async () => new Headers(),
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  db: {
    session: { findUnique: mocks.sessionFindUnique, updateMany: vi.fn(async () => ({ count: 1 })), deleteMany: vi.fn() },
    user: { findUnique: mocks.userFindUnique, updateMany: vi.fn(async () => ({ count: 1 })) },
    notification: { findMany: mocks.notificationFindMany, count: mocks.notificationCount },
  },
}));
vi.mock("@/lib/services/notification-resolution", () => ({ resolveSettledNotificationsForUser: vi.fn() }));
vi.mock("@/lib/services/companion-projection-publisher", () => ({ deferCompanionProjectionRefresh: vi.fn() }));

import { GET as getMe } from "@/app/api/me/route";
import { GET as getNotifications } from "@/app/api/notifications/route";
import { GET as getProfileCompletion } from "@/app/api/me/profile-completion/route";

const ctx = { params: Promise.resolve({}) };

function sessionRow(user: { onboardingRequired: boolean; onboardingCompletedAt: Date | null }) {
  return {
    id: "session-1",
    expiresAt: new Date("2026-11-02T15:00:00.000Z"),
    createdAt: new Date("2026-10-26T14:00:00.000Z"),
    persistent: true,
    user: {
      id: USER_ID,
      email: "bucky@wisc.edu",
      name: "Bucky Badger",
      role: Role.STUDENT,
      active: true,
      affiliation: null,
      collaboratorProfile: null,
      collaboratorPolicyId: null,
      staffingType: ShiftWorkerType.ST,
      avatarUrl: null,
      forcePasswordChange: false,
      lastActiveAt: NOW,
      collaboratorPolicy: null,
      ...user,
    },
  };
}

const NEW_STUDENT_PROFILE = {
  id: USER_ID,
  name: "Bucky Badger",
  role: Role.STUDENT,
  email: "bucky@wisc.edu",
  athleticsEmail: null,
  phone: null,
  personalPhone: null,
  workPhone: null,
  workPhoneNotApplicable: false,
  wiscardCardNumber: null,
  wiscardIssueCode: null,
  wiscardNumber: null,
  studentYearOverride: null,
  gradYear: null,
  graduationTerm: null,
  topSizeFit: null,
  topSize: null,
  shoeSizeSystem: null,
  shoeSize: null,
  avatarUrl: null,
  profilePromptSnoozedUntil: null,
  hiddenFromRoster: false,
  onboardingRequired: true,
  onboardingCompletedAt: null,
};

const SET_UP_STUDENT_PROFILE = {
  ...NEW_STUDENT_PROFILE,
  athleticsEmail: "bbadger@athletics.wisc.edu",
  phone: "6085550100",
  personalPhone: "6085550100",
  wiscardCardNumber: "1234567890",
  wiscardIssueCode: "2",
  wiscardNumber: "12345678902",
  studentYearOverride: "SOPHOMORE",
  gradYear: 2029,
  graduationTerm: "SPRING",
  topSizeFit: "UNISEX",
  topSize: "M",
  shoeSizeSystem: "US_MENS",
  shoeSize: "10",
  profilePromptSnoozedUntil: new Date("2026-10-27T15:00:00.000Z"),
  onboardingRequired: false,
  onboardingCompletedAt: new Date("2026-10-26T14:30:00.000Z"),
};

async function body(res: Response, status = 200) {
  expect(res.status).toBe(status);
  return JSON.parse(await res.text()) as unknown;
}

function expectMatchesFixture(name: string, actual: unknown) {
  const file = path.join(FIXTURE_DIR, `${name}.json`);
  if (process.env.UPDATE_IOS_FIXTURES === "1") {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(file, `${JSON.stringify(actual, null, 2)}\n`);
  }
  expect(existsSync(file), `${name}.json is missing; run with UPDATE_IOS_FIXTURES=1`).toBe(true);
  expect(actual).toEqual(JSON.parse(readFileSync(file, "utf8")));
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  mocks.sessionFindUnique.mockResolvedValue(sessionRow({ onboardingRequired: true, onboardingCompletedAt: null }));
});

describe("iOS contract fixtures", () => {
  it("GET /api/me for a new student", async () => {
    mocks.userFindUnique.mockResolvedValue({ createdAt: new Date("2026-10-23T21:00:00.000Z") });
    expectMatchesFixture("me-new-student", await body(await getMe(jsonRequest("/api/me", "GET"), ctx)));
  });

  it("GET /api/me/profile-completion before setup", async () => {
    mocks.userFindUnique.mockResolvedValue(NEW_STUDENT_PROFILE);
    const res = await getProfileCompletion(jsonRequest("/api/me/profile-completion", "GET"), ctx);
    expectMatchesFixture("profile-completion-new-student", await body(res));
  });

  it("GET /api/me/profile-completion after setup without a photo", async () => {
    mocks.sessionFindUnique.mockResolvedValue(sessionRow({
      onboardingRequired: false,
      onboardingCompletedAt: SET_UP_STUDENT_PROFILE.onboardingCompletedAt,
    }));
    mocks.userFindUnique.mockResolvedValue(SET_UP_STUDENT_PROFILE);
    const res = await getProfileCompletion(jsonRequest("/api/me/profile-completion", "GET"), ctx);
    expectMatchesFixture("profile-completion-set-up-student", await body(res));
  });

  it("GET /api/notifications before setup is the onboarding gate", async () => {
    const res = await getNotifications(jsonRequest("/api/notifications", "GET"), ctx);
    expectMatchesFixture("error-onboarding-required", await body(res, 403));
  });

  it("GET /api/notifications with a read and an unread row", async () => {
    mocks.sessionFindUnique.mockResolvedValue(sessionRow({
      onboardingRequired: false,
      onboardingCompletedAt: SET_UP_STUDENT_PROFILE.onboardingCompletedAt,
    }));
    mocks.notificationFindMany.mockResolvedValue([
      {
        id: "cm0000000000000000notice01",
        userId: USER_ID,
        type: "shift_assigned",
        title: "You're on Volleyball vs. Nebraska",
        body: "Fri 7:00 PM at the Field House",
        payload: { assignmentId: "cm00000000000000000assign1", eventId: "cm000000000000000000event1" },
        channel: "IN_APP",
        sentAt: new Date("2026-10-26T14:55:00.123Z"),
        readAt: null,
        dedupeKey: "shift_assigned:cm00000000000000000assign1",
        bookingId: null,
        createdAt: new Date("2026-10-26T14:55:00.123Z"),
      },
      {
        id: "cm0000000000000000notice02",
        userId: USER_ID,
        type: "checkout_due",
        title: "Gear due back today",
        body: null,
        payload: null,
        channel: "IN_APP",
        sentAt: null,
        readAt: new Date("2026-10-25T18:00:00.000Z"),
        dedupeKey: null,
        bookingId: "cm0000000000000000booking1",
        createdAt: new Date("2026-10-25T17:00:00.000Z"),
      },
    ]);
    mocks.notificationCount.mockResolvedValueOnce(2).mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    const res = await getNotifications(jsonRequest("/api/notifications?limit=20&offset=0", "GET"), ctx);
    expectMatchesFixture("notifications-inbox", await body(res));
  });
});
