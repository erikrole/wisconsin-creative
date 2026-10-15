import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  OPERATIONAL_POLLING_IDLE_MS,
  QUIET_HOURS_RECHECK_MS,
  getOperationalPollingState,
  isBackgroundPollingPaused,
} from "@/hooks/use-operational-polling-activity";
import { isOvernightQuietHours } from "@/lib/app-time";

describe("operational polling activity", () => {
  const now = 1_000_000;

  it("keeps polling active only for a visible, online, recently active user", () => {
    expect(getOperationalPollingState({
      enabled: true,
      visible: true,
      online: true,
      lastActivityAt: now - OPERATIONAL_POLLING_IDLE_MS + 1,
      now,
    })).toBe("active");

    expect(getOperationalPollingState({
      enabled: true,
      visible: true,
      online: true,
      lastActivityAt: now - OPERATIONAL_POLLING_IDLE_MS,
      now,
    })).toBe("idle");
  });

  it("prioritizes disabled, hidden, and offline states", () => {
    const base = { lastActivityAt: now, now };

    expect(getOperationalPollingState({ ...base, enabled: false, visible: true, online: true }))
      .toBe("disabled");
    expect(getOperationalPollingState({ ...base, enabled: true, visible: false, online: true }))
      .toBe("hidden");
    expect(getOperationalPollingState({ ...base, enabled: true, visible: true, online: false }))
      .toBe("offline");
  });

  it("uses a two-minute idle window and resumes from browser activity", () => {
    const source = readFileSync("src/hooks/use-operational-polling-activity.ts", "utf8");

    expect(OPERATIONAL_POLLING_IDLE_MS).toBe(120_000);
    expect(QUIET_HOURS_RECHECK_MS).toBe(60_000);
    expect(source).toContain('"pointerdown", "pointermove", "keydown", "touchstart", "wheel"');
    expect(source).toContain('window.addEventListener("focus", recordActivity)');
    expect(source).toContain('window.addEventListener("online", recordActivity)');
    expect(source).toContain('document.addEventListener("visibilitychange", onVisibilityChange)');
    expect(source).toContain("if (document.visibilityState === \"visible\")");
    expect(source).toContain("idleTimer = setTimeout(syncState, QUIET_HOURS_RECHECK_MS)");
  });

  it("pauses overnight quiet hours even when the tab is visible and active", () => {
    const quiet = new Date("2026-10-15T08:30:00Z");
    const day = new Date("2026-10-15T16:30:00Z");
    expect(isOvernightQuietHours(quiet)).toBe(true);
    expect(isOvernightQuietHours(day)).toBe(false);
    expect(isBackgroundPollingPaused(false, quiet)).toBe(true);
    expect(isBackgroundPollingPaused(true, day)).toBe(true);
    expect(isBackgroundPollingPaused(false, day)).toBe(false);

    const now = quiet.getTime();
    expect(getOperationalPollingState({
      enabled: true,
      visible: true,
      online: true,
      lastActivityAt: now,
      now,
      quietHours: true,
    })).toBe("quiet");
    expect(getOperationalPollingState({
      enabled: true,
      visible: false,
      online: true,
      lastActivityAt: now,
      now,
      quietHours: true,
    })).toBe("hidden");
  });
});
