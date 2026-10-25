import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import UserInfoTab from "@/app/(app)/staff/[id]/UserInfoTab";
import {
  birthdayDisplay,
  formatBirthdayInput,
  parseBirthdayInput,
  userListCachePatch,
  userPatchUrl,
} from "@/app/(app)/staff/[id]/user-info-helpers";
import type { Role, UserDetail } from "@/app/(app)/staff/types";

function user(overrides: Partial<UserDetail> = {}): UserDetail {
  return {
    id: "user-1",
    name: "Maddy Student",
    email: "maddy@wisc.edu",
    role: "STUDENT",
    staffingType: "ST",
    phone: null,
    slackHandle: null,
    slackProfileUrl: null,
    primaryArea: "VIDEO",
    locationId: "loc-1",
    location: "Camp Randall",
    avatarUrl: null,
    title: null,
    createdAt: "2026-08-20T15:00:00.000Z",
    personalPhone: "6085550101",
    workPhone: null,
    workPhoneNotApplicable: true,
    wiscardCardNumber: null,
    wiscardIssueCode: null,
    sportAssignments: [{ id: "sa-1", sportCode: "FB" }],
    areaAssignments: [{ id: "aa-1", area: "VIDEO", isPrimary: true }],
    athleticsEmail: null,
    startDate: null,
    directReportId: null,
    directReportName: null,
    directReport: null,
    gradYear: 2028,
    graduationTerm: "SPRING",
    studentYearOverride: null,
    topSize: null,
    topSizeFit: null,
    bottomSize: null,
    shoeSize: null,
    shoeSizeSystem: null,
    birthdayMonth: null,
    birthdayDay: null,
    ...overrides,
  } as UserDetail;
}

type RenderOptions = {
  viewer?: Role | null;
  isSelf?: boolean;
  locationsLoading?: boolean;
  locationsError?: boolean;
  onRetryLocations?: () => void;
};

function render(target: UserDetail, options: RenderOptions = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        TooltipProvider,
        null,
        createElement(UserInfoTab, {
          user: target,
          locations: [{ id: "loc-1", name: "Camp Randall" }],
          locationsLoading: options.locationsLoading,
          locationsError: options.locationsError,
          onRetryLocations: options.onRetryLocations,
          currentUserRole: options.viewer === undefined ? "ADMIN" : options.viewer,
          isSelf: options.isSelf,
          onUpdated: () => {},
        }),
      ),
    ),
  );
}

describe("UserInfoTab", () => {
  it("lays the profile out as Contact, Work and Assignments, with nothing hidden in the markup", () => {
    const html = render(user());

    for (const section of ['id="contact"', 'id="work"', 'id="assignments"']) {
      expect(html).toContain(section);
    }
    expect(html).not.toContain('class="hidden"');
    expect(html).toContain("At a glance");
  });

  it("keeps the fields the team uses and none of the retired ones", () => {
    const html = render(user());

    for (const label of ["Personal phone", "Work phone", "Schedule as", "Clothing", "Shoes", "Birthday"]) {
      expect(html, label).toContain(label);
    }
    expect(html).toContain('aria-label="Top fit"');
    expect(html).toContain('aria-label="Shoe sizing"');
    expect(html).toContain('placeholder="MM/DD"');
    expect(html).not.toContain('aria-label="Birth year"');
    expect(html).toContain("(608) 555-0101");
    expect(html).toContain('placeholder="No work phone"');
    for (const retired of ["Slack", "Scheduling class", "Password", ">Linked<"]) {
      expect(html, retired).not.toContain(retired);
    }
  });

  it("shows Wiscard entry only to someone who can edit the profile", () => {
    const editable = render(user(), { viewer: "STAFF" });
    expect(editable).toContain("Wiscard");
    expect(editable).toContain('aria-label="Wiscard number"');
    expect(editable).toContain('aria-label="Issue code"');
    expect(editable).toContain('aria-label="Where to find the Wiscard issue code"');

    // Staff do not edit other staff.
    const readOnly = render(user({ role: "STAFF", staffingType: "FT" }), { viewer: "STAFF" });
    expect(readOnly).not.toContain('aria-label="Wiscard number"');
  });

  it("lets a person fill in their own Wiscard", () => {
    expect(render(user(), { viewer: "STUDENT", isSelf: true })).toContain('aria-label="Wiscard number"');
  });

  it("asks Admin for a collaborator affiliation only where it applies", () => {
    const collaborator = user({
      role: "COLLABORATOR",
      collaboratorPolicy: {
        id: "policy-1",
        status: "ACTIVE",
        version: 1,
        affiliation: { key: "btn", displayName: "Big Ten Network", badgeLabel: "BTN" },
      },
    });

    expect(render(collaborator)).toContain("Collaborator affiliation");
    expect(render(collaborator, { viewer: "STAFF" })).not.toContain("Collaborator affiliation");
    expect(render(user())).not.toContain("Collaborator affiliation");
  });

  it("keeps the saved location visible when the location list will not load", () => {
    const html = render(user(), { locationsError: true, onRetryLocations: () => {} });

    expect(html).toContain("Locations could not load, so profile location editing is unavailable.");
    expect(html).toContain("The saved profile location is still shown.");
    expect(html).toContain("Retry locations");
    expect(html).toMatch(/aria-label="Location unavailable"[^>]*>(?:<[^>]+>)*Camp Randall/);
  });

  it("shows No location while locations load for someone without one", () => {
    const html = render(user({ locationId: null, location: null }), { locationsLoading: true });

    expect(html).not.toContain("Locations could not load");
    expect(html).toMatch(/aria-label="Location unavailable"[^>]*>[\s\S]*?No location/);
  });

  it("offers hours and the calendar feed only on your own profile", () => {
    const own = render(user(), { viewer: "STUDENT", isSelf: true });
    expect(own).toContain("Calendar subscription");

    const other = render(user());
    expect(other).not.toContain("Calendar subscription");
  });

  it("shows read-only assignment badges to someone who cannot change them", () => {
    const html = render(user({ role: "STAFF", staffingType: "FT" }), { viewer: "STUDENT" });

    expect(html).not.toContain('aria-label="Sports assignments"');
    expect(html).toContain("Football");
    expect(html).toContain("(Primary)");
  });
});

describe("profile edits", () => {
  it("routes a person's own self-service fields through /api/profile", () => {
    expect(userPatchUrl("user-1", { personalPhone: "(608) 555-0101" }, true)).toBe("/api/profile");
    expect(userPatchUrl("user-1", { birthdayMonth: 4, birthdayDay: 9 }, true)).toBe("/api/profile");
  });

  it("sends anything else, or anyone else's profile, through the staff route", () => {
    expect(userPatchUrl("user-1", { primaryArea: "PHOTO" }, true)).toBe("/api/users/user-1");
    expect(userPatchUrl("user-1", { name: "M", primaryArea: "PHOTO" }, true)).toBe("/api/users/user-1");
    expect(userPatchUrl("user-1", { personalPhone: null }, false)).toBe("/api/users/user-1");
  });

  it("carries the location's name into cached user lists", () => {
    const locations = [{ id: "loc-1", name: "Camp Randall" }];

    expect(userListCachePatch({ locationId: "loc-1" }, locations)).toEqual({ locationId: "loc-1", location: "Camp Randall" });
    expect(userListCachePatch({ locationId: null }, locations)).toEqual({ locationId: null, location: null });
    expect(userListCachePatch({ title: "Producer" }, locations)).toEqual({ title: "Producer" });
  });
});

describe("birthday field", () => {
  it("formats digits as MM/DD while typing", () => {
    expect(formatBirthdayInput("0")).toBe("0");
    expect(formatBirthdayInput("040")).toBe("04/0");
    expect(formatBirthdayInput("04/09/2001")).toBe("04/09");
    expect(birthdayDisplay({ birthdayMonth: 4, birthdayDay: 9 })).toBe("04/09");
    expect(birthdayDisplay({ birthdayMonth: 4, birthdayDay: null })).toBe("");
  });

  it("accepts real dates, including Feb 29, and clears on empty", () => {
    expect(parseBirthdayInput("04/09")).toEqual({ month: 4, day: 9 });
    expect(parseBirthdayInput("0229")).toEqual({ month: 2, day: 29 });
    expect(parseBirthdayInput("  ")).toBeNull();
  });

  it("rejects dates that do not exist", () => {
    expect(() => parseBirthdayInput("02/30")).toThrow("Enter a valid birthday");
    expect(() => parseBirthdayInput("13/01")).toThrow("Enter a valid birthday");
    expect(() => parseBirthdayInput("4")).toThrow("Enter birthday as MM/DD");
  });
});
