import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    firmwareWatchTarget: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
    notification: {
      createManyAndReturn: vi.fn(),
    },
  },
}));

vi.mock("@/lib/services/notifications", () => ({
  sendPushToUser: vi.fn(),
  deferPush: vi.fn(),
}));

import { db } from "@/lib/db";
import { sendPushToUser } from "@/lib/services/notifications";
import {
  parseSonySupportFirmware,
  pollFirmwareWatchTargets,
} from "@/lib/services/firmware-watch";

const mockedDb = db as unknown as {
  firmwareWatchTarget: {
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  user: {
    findMany: ReturnType<typeof vi.fn>;
  };
  notification: {
    createManyAndReturn: ReturnType<typeof vi.fn>;
  };
};

const sonyHtml = `
  <html>
    <h1>ILCE-7M3 System Software (Firmware) Update Ver. 4.04 (Mac)</h1>
    <h2>File Info</h2>
    <p>Version: 4.04</p>
    <p>Release Date: 04-15-2026</p>
  </html>
`;

const sonyMetadataHtml = `
  <html>
    <script>
      window.__CTX__ = {
        "software": [{
          "name": "ILCE-7M4 System Software (Firmware) Update Ver. 6.02",
          "releaseDate": "Thu, 28 May 2026 00:00:00 +00:00"
        }]
      };
    </script>
  </html>
`;

function target(overrides: Partial<{
  id: string;
  latestVersion: string | null;
  baselineEstablishedAt: Date | null;
  sourceUrl: string;
}> = {}) {
  return {
    id: overrides.id ?? "target-1",
    brand: "Sony",
    model: "ILCE-7M3",
    productName: "Sony A7 III",
    sourceUrl: overrides.sourceUrl ?? "https://www.sony.com/electronics/support/e-mount-body-ilce-7-series/ilce-7m3/software/00257843",
    sourceType: "SONY_SUPPORT",
    supportMode: "MAINTENANCE",
    supportNote: "Older body receiving stability firmware.",
    latestVersion: overrides.latestVersion ?? null,
    latestReleaseDate: null,
    lastChangedAt: null,
    baselineEstablishedAt: overrides.baselineEstablishedAt ?? null,
  };
}

function fetcher(html: string) {
  return vi.fn().mockResolvedValue(new Response(html, { status: 200 }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedDb.firmwareWatchTarget.update.mockResolvedValue({});
  mockedDb.user.findMany.mockResolvedValue([]);
  mockedDb.notification.createManyAndReturn.mockResolvedValue([]);
});

describe("firmware source parsers", () => {
  it("parses Sony support firmware version and release date", () => {
    expect(parseSonySupportFirmware(sonyHtml)).toEqual({
      version: "4.04",
      releaseDate: new Date("2026-04-15T00:00:00.000Z"),
    });
  });

  it("parses Sony embedded software metadata", () => {
    expect(parseSonySupportFirmware(sonyMetadataHtml)).toEqual({
      version: "6.02",
      releaseDate: new Date("2026-05-28T00:00:00.000Z"),
    });
  });
});

describe("firmware watch polling", () => {
  it("establishes the first successful baseline without notifying admins", async () => {
    const now = new Date("2026-06-10T08:00:00.000Z");
    mockedDb.firmwareWatchTarget.findMany.mockResolvedValue([target()]);

    const result = await pollFirmwareWatchTargets({ now, fetcher: fetcher(sonyHtml) });

    expect(result).toEqual({
      checked: 1,
      changed: 0,
      baselined: 1,
      failed: 0,
      skipped: 0,
      notificationsCreated: 0,
      errors: [],
    });
    expect(mockedDb.firmwareWatchTarget.update).toHaveBeenCalledWith({
      where: { id: "target-1" },
      data: expect.objectContaining({
        latestVersion: "4.04",
        latestReleaseDate: new Date("2026-04-15T00:00:00.000Z"),
        lastCheckedAt: now,
        baselineEstablishedAt: now,
        lastError: null,
      }),
    });
    expect(mockedDb.notification.createManyAndReturn).not.toHaveBeenCalled();
    expect(sendPushToUser).not.toHaveBeenCalled();
  });

  it("notifies active admins once a baselined target changes version", async () => {
    const now = new Date("2026-06-10T08:00:00.000Z");
    mockedDb.firmwareWatchTarget.findMany.mockResolvedValue([
      target({
        latestVersion: "4.03",
        baselineEstablishedAt: new Date("2026-06-01T08:00:00.000Z"),
      }),
    ]);
    mockedDb.user.findMany.mockResolvedValue([{ id: "admin-1" }, { id: "admin-2" }]);
    mockedDb.notification.createManyAndReturn.mockResolvedValue([{ userId: "admin-1" }, { userId: "admin-2" }]);

    const result = await pollFirmwareWatchTargets({ now, fetcher: fetcher(sonyHtml) });

    expect(result.changed).toBe(1);
    expect(result.notificationsCreated).toBe(2);
    expect(mockedDb.notification.createManyAndReturn).toHaveBeenCalledWith({
      skipDuplicates: true,
      select: { id: true, userId: true },
      data: [
        expect.objectContaining({
          userId: "admin-1",
          type: "firmware_update_released",
          title: "Firmware update available",
          dedupeKey: "firmware_release:target-1:4.04:admin-1",
          payload: expect.objectContaining({
            sourceUrl: expect.stringContaining("sony.com"),
            href: "/items?search=Sony%20ILCE-7M3",
          }),
        }),
        expect.objectContaining({
          userId: "admin-2",
          dedupeKey: "firmware_release:target-1:4.04:admin-2",
        }),
      ],
    });
    expect(sendPushToUser).toHaveBeenCalledTimes(2);
  });

  it("pushes only admins whose inbox row is new", async () => {
    const now = new Date("2026-06-10T08:00:00.000Z");
    mockedDb.firmwareWatchTarget.findMany.mockResolvedValue([
      target({
        latestVersion: "4.03",
        baselineEstablishedAt: new Date("2026-06-01T08:00:00.000Z"),
      }),
    ]);
    mockedDb.user.findMany.mockResolvedValue([{ id: "admin-1" }, { id: "admin-2" }]);
    // admin-1 already has this release; only the newly added admin-2 is inserted.
    mockedDb.notification.createManyAndReturn.mockResolvedValue([{ userId: "admin-2" }]);

    const result = await pollFirmwareWatchTargets({ now, fetcher: fetcher(sonyHtml) });

    expect(result.notificationsCreated).toBe(1);
    expect(sendPushToUser).toHaveBeenCalledTimes(1);
    expect(sendPushToUser).toHaveBeenCalledWith("admin-2", expect.objectContaining({ category: "systemAlerts" }));
  });

  it("rejects non-official or non-HTTPS source URLs before fetching", async () => {
    const now = new Date("2026-06-10T08:00:00.000Z");
    const blockedFetch = fetcher(sonyHtml);
    mockedDb.firmwareWatchTarget.findMany.mockResolvedValue([
      target({ sourceUrl: "http://127.0.0.1/internal" }),
    ]);

    const result = await pollFirmwareWatchTargets({ now, fetcher: blockedFetch });

    expect(result.failed).toBe(1);
    expect(blockedFetch).not.toHaveBeenCalled();
    expect(mockedDb.firmwareWatchTarget.update).toHaveBeenCalledWith({
      where: { id: "target-1" },
      data: {
        lastCheckedAt: now,
        lastError: "Firmware source URL must use HTTPS",
      },
    });
  });
});
