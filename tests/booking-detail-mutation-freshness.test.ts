import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(`${process.cwd()}/${relativePath}`, "utf8");
}

describe("booking detail mutation freshness contracts", () => {
  it("keeps the authoritative booking timestamp after an inline save", () => {
    const actions = source("src/hooks/useBookingActions.ts");
    const page = source("src/app/(app)/bookings/BookingDetailPage.tsx");
    const infoCard = source("src/components/booking-details/BookingInfoCard.tsx");
    const sheet = source("src/components/BookingDetailsSheet.tsx");
    const transferDialog = source("src/components/booking-details/TransferOwnerDialog.tsx");

    expect(actions).toContain("const json = await parseJsonSafely<BookingMutationResponse>(res);");
    expect(actions).toContain("return json.data;");
    expect(page).toContain('const updated = await actions.saveField("title", v);');
    expect(page).toContain("patchLocal(updated);");
    expect(page).not.toContain("patchLocal({ title: v });");
    expect(infoCard).toContain('const updated = await onSave("startsAt", iso);');
    expect(infoCard).toContain('const updated = await onSave("endsAt", iso);');
    expect(infoCard).toContain('const updated = await onSave("notes", v || null);');
    expect(sheet).toContain("if (updated) setBooking(updated);");
    expect(transferDialog).toContain("let updated: BookingDetail;");
    expect(transferDialog).toContain("onTransferred(updated);");
    expect(page).toMatch(/onTransferred=\{\(updated\) => \{\s*patchLocal\(updated\);\s*\}\}/);
  });

  it("does not classify committed booking follow-up work as a request failure", () => {
    const actions = source("src/hooks/useBookingActions.ts");
    const sheet = source("src/components/BookingDetailsSheet.tsx");
    const eventsDialog = source("src/components/booking-details/EditBookingEventsDialog.tsx");
    const transferDialog = source("src/components/booking-details/TransferOwnerDialog.tsx");

    expect(actions).toContain("timeoutMs: BOOKING_MUTATION_TIMEOUT_MS");
    expect(sheet.match(/timeoutMs: BOOKING_MUTATION_TIMEOUT_MS/g)).toHaveLength(3);
    expect(eventsDialog).toContain("timeoutMs: BOOKING_MUTATION_TIMEOUT_MS");
    expect(transferDialog).toContain("timeoutMs: BOOKING_MUTATION_TIMEOUT_MS");

    expect(eventsDialog).toMatch(
      /let updated: BookingDetail;[\s\S]*finally \{[\s\S]*setSaving\(false\);[\s\S]*\}\s*toast\.success/,
    );
    expect(sheet).toMatch(
      /let updated: BookingDetail \| null = null;[\s\S]*catch \(error\) \{[\s\S]*throw error;[\s\S]*\}\s*if \(updated\) setBooking\(updated\);/,
    );
  });
});
