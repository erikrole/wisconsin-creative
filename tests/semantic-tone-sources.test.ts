import { describe, expect, it } from "vitest";

import { VENUE_TONES, venueToneFromIsHome } from "@/lib/venue-tone";
import { source } from "./_helpers/source";

/** Every iOS view that shows an event rail or a crew-coverage pill. */
const IOS_VENUE_CALL_SITES = [
  "ios/Wisconsin/Views/ScheduleView.swift",
  "ios/Wisconsin/Views/EventDetailSheet.swift",
  "ios/Wisconsin/Views/HomeView.swift",
  "ios/Wisconsin/Views/CreateBooking/CreateBookingFormRows.swift",
  "ios/Wisconsin/Views/Schedule/TradeBoardSheet.swift",
];

const IOS_COVERAGE_CALL_SITES = [
  "ios/Wisconsin/Views/ScheduleView.swift",
  "ios/Wisconsin/Views/EventDetailSheet.swift",
];

describe("semantic tone sources of truth", () => {
  it("keeps venue and coverage tones in one iOS module", () => {
    const tones = source("ios/Wisconsin/Core/SemanticTones.swift");

    expect(tones).toContain("func venueTone(isHome: Bool?) -> StatusTone");
    expect(tones).toContain("func venueRailColor(isHome: Bool?) -> Color");
    expect(tones).toContain("func coverageTone(percentage: Int) -> StatusTone");
    // Venue matches the web table: green home, orange away, gray otherwise.
    expect(tones).toContain("case true: return .green");
    expect(tones).toContain("case false: return .orange");
    expect(tones).toContain("case nil: return .gray");
  });

  it("never lets an iOS view re-derive a venue color inline", () => {
    for (const file of IOS_VENUE_CALL_SITES) {
      const swift = source(file);
      // The tell is a switch on isHome that produces a color or tone. Five
      // views each had their own, which is how neutral acquired four different
      // greys (systemGray4, systemGray3, statusText(.gray), .gray).
      expect(swift, `${file} re-derives venue color`).not.toMatch(
        /switch\s+(\w+\??\.)*isHome\s*\{[^}]*(green|orange|systemGray)/s,
      );
      expect(swift, `${file} hardcodes a venue grey`).not.toContain("Color(.systemGray4)");
      expect(swift, `${file} hardcodes a venue grey`).not.toContain("Color(.systemGray3)");
    }
  });

  it("never lets an iOS view re-derive crew coverage thresholds", () => {
    for (const file of IOS_COVERAGE_CALL_SITES) {
      const swift = source(file);
      expect(swift, `${file} re-derives coverage tone`).not.toContain("percentage >= 100");
    }
  });

  it("gives non-game the same color as neutral on web", () => {
    // Non-game is the absence of a venue direction, not a category of its own,
    // so it borrows neutral's styling rather than the gear domain's blue.
    const neutral = VENUE_TONES.neutral;
    const nonGame = VENUE_TONES["non-game"];

    expect(nonGame.badgeVariant).toBe(neutral.badgeVariant);
    expect(nonGame.railClass).toBe(neutral.railClass);
    expect(nonGame.solidClass).toBe(neutral.solidClass);
    expect(nonGame.surfaceClass).toBe(neutral.surfaceClass);
    expect(nonGame.activeTabClass).toBe(neutral.activeTabClass);
    // It keeps its own label and filter value -- only the color is shared.
    expect(nonGame.label).toBe("Non-game");

    for (const style of Object.values(VENUE_TONES)) {
      expect(style.railClass, "venue must not borrow the gear domain's blue").not.toContain("--blue");
      expect(style.solidClass).not.toContain("--blue");
      expect(style.surfaceClass).not.toContain("--blue");
      expect(style.activeTabClass).not.toContain("--blue");
    }
  });

  it("keeps awaiting-pickup orange on every surface", () => {
    // PENDING_PICKUP is the one state that destroys itself if ignored: it
    // auto-cancels 48 hours past startsAt and releases the gear. Green is the
    // system's "nothing needed here" colour, so it is the wrong end of the
    // scale no matter how ready the gear itself is.
    const home = source("ios/Wisconsin/Views/HomeView.swift");
    const pickupTile = home.slice(home.indexOf('StatItem(id: "pickups"'));
    expect(pickupTile.slice(0, pickupTile.indexOf("\n"))).toContain("tone: .orange");

    const bookingsView = source("ios/Wisconsin/Views/BookingsView.swift");
    expect(bookingsView).toContain("case .pendingPickup: return .orange");
  });

  it("routes personal markers through one color, never a status hue", () => {
    // Favourite and default-traveller stars say "you flagged this", not "this
    // is in state X". They were four spellings of amber/yellow across the two
    // platforms; now both sides name the same token.
    const brand = source("ios/Wisconsin/Core/Brand.swift");
    expect(brand).toContain("static let marker");
    expect(source("ios/Wisconsin/Views/ItemsView.swift")).not.toContain(".tint(.yellow)");

    const markerSurfaces = [
      "src/app/(app)/items/columns.tsx",
      "src/app/(app)/items/[id]/_components/ItemHeader.tsx",
      "src/app/(app)/events/[id]/_components/EventTravelCard.tsx",
    ];
    for (const file of markerSurfaces) {
      const markup = source(file);
      expect(markup, `${file} should use the marker token`).toContain("var(--yellow-text)");
      expect(markup, `${file} still has an ad-hoc amber`).not.toMatch(/\bamber-\d{3}\b/);
    }

    // Avatar fallbacks are the one sanctioned home for off-palette hues: they
    // identify a person and never share a row with that object's status color.
    const strayAmber = source("src/app/(app)/bulk-inventory/[id]/BulkSkuQrTab.tsx");
    expect(strayAmber).not.toMatch(/\bamber-\d{3}\b/);
  });

  it("agrees with iOS on which venue gets which color", () => {
    // Web keys off a tone name, iOS off the raw isHome tri-state. Both must
    // land on the same three colors.
    expect(VENUE_TONES[venueToneFromIsHome(true)].badgeVariant).toBe("green");
    expect(VENUE_TONES[venueToneFromIsHome(false)].badgeVariant).toBe("orange");
    expect(VENUE_TONES[venueToneFromIsHome(null)].badgeVariant).toBe("gray");

    const tones = source("ios/Wisconsin/Core/SemanticTones.swift");
    const venueBody = tones.slice(tones.indexOf("func venueTone"));
    expect(venueBody.slice(0, venueBody.indexOf("\n}"))).toMatch(
      /case true: return \.green[\s\S]*case false: return \.orange[\s\S]*case nil: return \.gray/,
    );
  });
});
