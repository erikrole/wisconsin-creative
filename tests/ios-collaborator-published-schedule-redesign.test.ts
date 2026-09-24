import { describe, expect, it } from "vitest";
import { scheduleSurfaceSource, source } from "./_helpers/source";

describe("iOS collaborator Published Schedule redesign", () => {
  const schedule = scheduleSurfaceSource();
  const apiClient = source("ios/Wisconsin/Core/APIClient.swift");
  const service = source("src/lib/services/collaborator-schedule.ts");

  it("keeps discovery on current published snapshots and paginates safely", () => {
    expect(service).toContain("publishedScheduleWhere(undefined, true)");
    expect(service).toContain("endsAt: upcomingOnly ? { gte: new Date() } : undefined");
    expect(service).toContain("lastPublishedSnapshot: { not: Prisma.JsonNull }");
    expect(schedule).toContain("private let pageSize = 50");
    expect(schedule).toContain("if events.count < total");
    expect(schedule).toContain("offset: events.count");
    expect(schedule).toContain("response.data.filter { !existingIds.contains($0.id) }");
  });

  it("uses grouped Schedule-style cards with resilient loading and refresh", () => {
    expect(schedule).toContain("private struct PublishedEventRow: View");
    expect(schedule).toContain("Dictionary(grouping: events)");
    expect(schedule).toContain("ScheduleDateHeader(date: group.date");
    expect(schedule).toContain("VenueDot(color: publishedEventRailColor(event.event))");
    expect(schedule).toContain("PublishedCrewAvatarStack(crew: event.crew)");
    expect(schedule).toContain("PublishedEventRowSkeleton()");
    expect(schedule).toContain("if !events.isEmpty, let refreshError");
    expect(schedule).toContain(".refreshable { await load(forceRefresh: true) }");
    expect(schedule).toContain("No upcoming events");
  });

  it("opens read-only detail and groups sanitized crew by area", () => {
    expect(schedule).toContain("private struct PublishedScheduleRoute: Hashable");
    expect(schedule).toContain("private struct PublishedEventDetailView: View");
    expect(schedule).toContain('.navigationTitle("Event")');
    expect(schedule).toContain('Text("Crew")');
    expect(schedule).toContain("Dictionary(grouping: event.crew, by: \\.area)");
    expect(schedule).toContain("PublishedCrewRow(member: member)");
    // Staff/Student wording is owned by the shared crew vocabulary so published
    // crew reads the same as the Event detail and Schedule crew rows.
    expect(schedule).toContain("crewWorkerTypeLabel(role)");
    const crewRow = source("ios/Wisconsin/Views/Components/CrewRow.swift");
    expect(crewRow).toContain('case "FT", "STAFF": return "Staff"');
    expect(crewRow).toContain('case "ST", "STUDENT": return "Student"');
    expect(schedule).not.toContain("PublishedEventDetailView(event: event, myShift:");
  });

  it("keeps Follow capability-driven, server-truthful, and recoverable", () => {
    expect(schedule).toContain('contains("SCHEDULE_FOLLOW")');
    expect(schedule).toContain("if canFollow");
    expect(apiClient).toContain("func setPublishedScheduleFollow(eventId: String, following: Bool) async throws -> Bool");
    expect(apiClient).toContain("return response.data.isFollowing");
    expect(schedule).toContain("let serverState = try await APIClient.shared.setPublishedScheduleFollow");
    expect(schedule).toContain("guard pendingFollowId == nil else { return }");
    expect(schedule).toContain("Couldn't update notifications for");
    expect(schedule).toContain(".disabled(isUpdatingFollow)");
  });

  it("routes collaborator event notifications through the sanitized detail endpoint", () => {
    expect(apiClient).toContain("func publishedScheduleEvent(eventId: String)");
    expect(apiClient).toContain('request(path: "/api/schedule/published/\\(eventId)")');
    expect(schedule).toContain("routePendingEventIfNeeded()");
    expect(schedule).toContain("APIClient.shared.publishedScheduleEvent(eventId: eventId)");
    expect(schedule).toContain("navigationPath.append(PublishedScheduleRoute(id: eventId))");
    expect(schedule).toContain("This event is no longer available.");
  });

  it("preserves published-snapshot privacy boundaries", () => {
    for (const forbidden of ["callNote", "publishedAt", "activeTrade", "availability", "candidateScores"]) {
      expect(service.slice(service.indexOf("async function hydratePublishedGroups"))).not.toContain(forbidden);
    }
  });
});
