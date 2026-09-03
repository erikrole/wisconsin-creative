import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("shared checkout custody contracts", () => {
  it("keeps the mutation serializable, snapshot-guarded, and audited", () => {
    const service = source("src/lib/services/booking-custody.ts");
    expect(service).toContain("Prisma.TransactionIsolationLevel.Serializable");
    expect(service).toContain("assertBookingSnapshot");
    expect(service).toContain('action: "custody_scope_changed"');
    expect(service).toContain("BookingKind.CHECKOUT");
    expect(service).toContain("BookingStatus.OPEN");
  });

  it("removes shared custody from personal attribution surfaces", () => {
    expect(source("src/lib/services/accountability.ts")).toContain(
      "custodyScope: BookingCustodyScope.PERSON",
    );
    expect(source("src/lib/services/dashboard-counts.ts")).toContain(
      "custody_scope = 'PERSON'",
    );
    expect(source("src/lib/services/notifications.ts")).toContain(
      'args.checkout.custodyScope !== "SHARED" && args.rule.notifyRequester',
    );
    expect(source("src/components/booking-details/BookingHeader.tsx")).toContain(
      'booking.custodyScope === "SHARED"',
    );
  });

  it("attributes a shared kiosk return to its identified operator without badge credit", () => {
    const scanRoute = source("src/app/api/kiosk/checkin/[id]/scan/route.ts");
    const completeRoute = source("src/app/api/kiosk/checkin/[id]/complete/route.ts");
    const client = source("ios/Wisconsin/Kiosk/KioskAPIClient.swift");
    const returnView = source("ios/Wisconsin/Kiosk/KioskReturnView.swift");

    expect(scanRoute).toContain("actorUserId: operationalActorId");
    expect(scanRoute).toContain("BookingCustodyScope.SHARED");
    expect(completeRoute).toContain("booking.custodyScope === BookingCustodyScope.PERSON");
    expect(client).toContain("Body(actorId: actorId, scanValue: scanValue)");
    expect(returnView).toContain("actorId: userId");
  });
});
