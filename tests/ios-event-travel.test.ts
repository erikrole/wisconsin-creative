import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";
import { apiClientSource } from "./_helpers/ios-api-client-source";

const detail = () => source("ios/Wisconsin/Views/EventDetailSheet.swift");
const section = () => source("ios/Wisconsin/Views/EventTravelSection.swift");
const models = () => source("ios/Wisconsin/Models/EventTravelModels.swift");
const client = () => apiClientSource();
const project = () => source("ios/Wisconsin.xcodeproj/project.pbxproj");

describe("iOS away-game travel roster", () => {
  it("shows a read-only roster on away games and leaves edits on the website", () => {
    const screen = section();
    const eventDetail = detail();
    const api = client();
    const method = api.slice(
      api.indexOf("func eventTravelMembers"),
      api.indexOf("func workingScheduleEditor"),
    );

    expect(eventDetail).toContain("EventTravelAccess.canRead(role: session.currentUser?.role, event: event)");
    expect(eventDetail).toContain("EventTravelSection(event: event, role: session.currentUser?.role, model: travel)");
    expect(eventDetail).toContain("await travel.load(event: event, role: session.currentUser?.role, force: false)");
    expect(eventDetail).toContain("await travel.load(event: event, role: session.currentUser?.role, force: true)");

    expect(screen).toContain("@ViewBuilder");
    expect(screen).toContain("if model.isLoading && model.members == nil {");
    expect(screen).toContain("} else {");
    expect(screen).toContain('BrandSectionHeader(\n                "Travel"');
    expect(screen).toContain("NavigationLink(value: EventTravelPersonRoute(id: member.user.id))");
    expect(screen).toContain("UserDetailView(userId: route.id)");
    expect(screen).toContain("No travelers yet");
    expect(screen).toContain("Travelers appear once the crew is assigned.");
    expect(screen).toContain("Couldn't refresh. The list is unchanged.");
    expect(screen).not.toMatch(/method:\s*"(POST|PATCH|DELETE|PUT)"/);
    expect(screen).not.toMatch(/\/travel\/defaults|travel\/\$\{|remove traveler|Add defaults/);
    expect(screen).not.toMatch(/\.foregroundStyle\(\.(red|green|blue|orange|purple)\)/);

    expect(method).toContain('path: "/api/calendar-events/\\(eventId)/travel"');
    expect(method).not.toMatch(/method:\s*"(POST|PATCH|DELETE|PUT)"/);
  });

  it("matches the website gate and keeps decoded fields writable", () => {
    const catalog = models();

    expect(catalog).toContain('if role != "ADMIN" && role != "STAFF" && role != "STUDENT"');
    expect(catalog).toContain("if event.isHome != false");
    expect(catalog).toContain("event.sportCode");
    expect(catalog).not.toContain('"COLLABORATOR"');
    expect(catalog).toContain("var notes: String?");
    expect(catalog).toContain("var primaryArea: String?");
    expect(catalog).toContain("var avatarUrl: String?");
    expect(catalog).not.toMatch(/let notes: String\? =/);
    expect(catalog).not.toMatch(/let primaryArea: String\? =/);
  });

  it("registers the new files in the XcodeGen project", () => {
    const pbx = project();

    expect(pbx).toContain("EventTravelSection.swift in Sources");
    expect(pbx).toContain("EventTravelModels.swift in Sources");
    expect(pbx).toContain("path = EventTravelSection.swift");
    expect(pbx).toContain("path = EventTravelModels.swift");
  });
});
