import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(path, "utf8");
}

describe("operational loading states", () => {
  it("keeps shared loading states on shadcn Skeleton with announced busy status", () => {
    const component = source("src/components/OperationalLoadingState.tsx");

    expect(component).toContain('import { Skeleton } from "@/components/ui/skeleton"');
    expect(component).toContain('aria-busy="true"');
    expect(component).toContain('role="status"');
    expect(component).toContain('variant?: "page" | "sheet" | "inline" | "command"');
    expect(component).not.toContain('style={{');
  });

  it("wires high-visibility app loading surfaces through shared primitives", () => {
    const appShell = source("src/components/AppShell.tsx");
    const bookingSheet = source("src/components/BookingDetailsSheet.tsx");

    expect(appShell).toContain('import { OperationalLoadingState } from "@/components/OperationalLoadingState"');
    expect(appShell).toContain('title="Loading workspace"');
    expect(appShell).toContain('title="Searching Wisconsin Creative"');
    expect(appShell).not.toContain("Searching...");
    expect(appShell).not.toContain('import { Spinner } from "@/components/ui/spinner"');

    expect(bookingSheet).toContain('import { OperationalLoadingState } from "@/components/OperationalLoadingState"');
    expect(bookingSheet).toContain('title="Loading booking details"');
    expect(bookingSheet).toContain('title="Booking details could not load"');
    expect(bookingSheet).toContain('title="Booking not found"');
    expect(bookingSheet).toContain("loading={equipSaving}");
    expect(bookingSheet).toContain("cancelling ? <Spinner />");
    expect(bookingSheet).not.toContain('import { Skeleton } from "@/components/ui/skeleton"');
    expect(bookingSheet).not.toContain("Loading...");
    expect(bookingSheet).not.toContain("Saving...");
    expect(bookingSheet).not.toContain("Cancelling...");
  });
});
