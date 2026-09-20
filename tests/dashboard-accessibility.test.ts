import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("dashboard accessibility contracts", () => {
  it("keeps the refresh action explicitly named", () => {
    const source = readFileSync("src/app/(app)/page.tsx", "utf8");

    expect(source).toContain('aria-label="Refresh dashboard"');
    expect(source).toContain("Booking breakdown");
    expect(source).toContain("Refresh\n");
  });

  it("presents booking timing as row metadata without stacked gear thumbnails", () => {
    const source = readFileSync("src/app/(app)/dashboard/booking-row.tsx", "utf8");

    expect(source).toContain("Clock3Icon");
    expect(source).toContain("timingPrefix");
    expect(source).toContain("timingDateTime");
    expect(source).toContain('className="font-bold">{timingDateTime}</span>');
    expect(source).toContain('className="size-4 shrink-0"');
    expect(source).not.toContain("GearAvatarStack");
    expect(source).not.toContain("<Badge");
  });

  it("keeps dashboard header actions at one 40px height", () => {
    const page = readFileSync("src/app/(app)/page.tsx", "utf8");
    const filters = readFileSync("src/app/(app)/dashboard/filter-chips.tsx", "utf8");

    expect(page).toContain('className="h-10 px-3"');
    expect(page).toContain('className="h-10"');
    expect(filters).toMatch(/className="h-10[^\"]*gap-1\.5"/);
  });

  it("keeps dashboard secondary actions at the 40px target baseline", () => {
    const filters = readFileSync("src/app/(app)/dashboard/filter-chips.tsx", "utf8");
    const sectionHeader = readFileSync("src/app/(app)/dashboard/section-header.tsx", "utf8");
    const teamActivity = readFileSync("src/app/(app)/dashboard/team-activity-column.tsx", "utf8");

    expect(filters).not.toContain('className="h-7');
    expect(filters).not.toContain('className="size-7');
    expect(sectionHeader).toContain("flex min-h-10 items-center justify-center");
    expect(sectionHeader).toContain("flex min-h-10 min-w-0 items-center");
    expect(teamActivity).toContain('"h-10 px-3 text-xs data-[state=on]:shadow-sm"');
  });

  it("animates nudge state changes without replaying on first render", () => {
    const overdue = readFileSync("src/app/(app)/dashboard/overdue-banner.tsx", "utf8");

    expect(overdue).toContain('<AnimatePresence initial={false} mode="popLayout">');
    expect(overdue).toContain('initial={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}');
    expect(overdue).toContain('transition={{ type: "spring", duration: 0.3, bounce: 0 }}');
  });

  it("keeps live sync compact and attached to the dashboard title", () => {
    const page = readFileSync("src/app/(app)/page.tsx", "utf8");
    const header = readFileSync("src/components/PageHeader.tsx", "utf8");

    expect(page).toContain("titleAccessory={(");
    expect(page).toContain("shadow-[0_0_14px_rgba(34,197,94,0.2)]");
    expect(page).toContain('className={bookingSync.state === "active"');
    expect(page).toContain('"h-6 px-2 text-[11px] font-bold');
    expect(header).toContain("titleAccessory?: React.ReactNode");
    expect(header).toContain("{titleAccessory &&");
  });

  it("strengthens booking identity and upcoming event hierarchy", () => {
    const row = readFileSync("src/app/(app)/dashboard/booking-row.tsx", "utf8");
    const teamActivity = readFileSync("src/app/(app)/dashboard/team-activity-column.tsx", "utf8");

    expect(row).toContain('size="md"');
    expect(row).toContain("text-[0.9375rem]");
    expect(row).not.toContain("ArrowUpRightIcon");
    expect(teamActivity).toContain("CalendarDaysIcon");
    expect(teamActivity).toContain("xl:col-start-2 xl:row-start-1");
  });

  it("uses the shared booking-row language for the overdue queue", () => {
    const overdue = readFileSync("src/app/(app)/dashboard/overdue-banner.tsx", "utf8");
    const route = readFileSync("src/app/api/dashboard/route.ts", "utf8");

    expect(overdue).toContain("DashboardSectionHeader");
    expect(overdue).toContain('countVariant="red"');
    expect(overdue).toContain("DashboardBookingRow");
    expect(overdue).toContain('accent="overdue"');
    expect(overdue).not.toContain("GearAvatarStack");
    expect(overdue).not.toContain("ExternalLinkIcon");
    expect(route).toContain("itemCount:");
    expect(route).toContain("startsAt:");
  });

  it("keeps extension controls out of dashboard rows and edits due dates in context", () => {
    const page = readFileSync("src/app/(app)/page.tsx", "utf8");
    const myGear = readFileSync("src/app/(app)/dashboard/my-gear-column.tsx", "utf8");
    const teamActivity = readFileSync("src/app/(app)/dashboard/team-activity-column.tsx", "utf8");
    const overview = readFileSync("src/components/booking-details/BookingSheetOverview.tsx", "utf8");
    const inlineDate = readFileSync("src/components/booking-details/InlineDateField.tsx", "utf8");

    expect(page).not.toContain("handleExtend");
    expect(myGear).not.toContain("onExtend");
    expect(teamActivity).not.toContain("onExtend");
    expect(overview).toContain('onSaveField("endsAt", value)');
    expect(inlineDate).toContain("Confirm date");
    expect(teamActivity).toContain("flex min-h-16 items-center justify-center gap-2");
  });

  it("uses an inline-editable booking sheet with kiosk-safe secondary actions", () => {
    const sheet = readFileSync("src/components/BookingDetailsSheet.tsx", "utf8");
    const overview = readFileSync("src/components/booking-details/BookingSheetOverview.tsx", "utf8");
    const items = readFileSync("src/components/booking-details/BookingItems.tsx", "utf8");
    const inlineTitle = readFileSync("src/components/InlineTitle.tsx", "utf8");

    expect(sheet).toContain("<BookingSheetOverview");
    expect(sheet).toContain("onSaveField={handleSaveField}");
    expect(sheet).not.toContain("<BookingInfoCard");
    expect(sheet).toContain('aria-label="More booking actions"');
    expect(sheet).not.toContain("Edit booking");
    expect(sheet).not.toContain("BookingEditForm");
    expect(sheet).toContain("Open full booking");
    expect(sheet).toContain('saveMode="explicit"');
    expect(sheet).toContain('canEdit && booking?.kind === "RESERVATION"');
    expect(inlineTitle).toContain('saveMode?: "blur" | "explicit"');
    expect(inlineTitle).toContain('aria-label="Save title"');
    expect(overview).toContain("Due back");
    expect(overview).toContain("weekday: \"long\"");
    expect(overview).toContain("formatDueLabel");
    expect(overview).toContain("Save notes");
    expect(items).toContain("assignedUnits.map((unitNumber)");
    expect(items).toContain("#{unitNumber}");
    expect(items).toContain("item.asset.name?.trim()");
    expect(items).toContain('fontFamily: "var(--font-heading)"');
    expect(items).not.toContain("item.asset.serialNumber");
    expect(items).not.toContain("TooltipContent");
  });
});
