import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");

describe("native Schedule staff authoring redesign", () => {
  it("makes Add Shift event-aware with explicit slot and schedule decisions", () => {
    const view = source("ios/Wisconsin/Views/Schedule/AddShiftSheet.swift");

    expect(view).toContain("let eventTitle: String");
    expect(view).toContain("Text(\"Open Slot\")");
    expect(view).toContain("LazyVGrid");
    expect(view).toContain("Text(\"Worker Class\")");
    expect(view).toContain("Toggle(\"Custom call window\"");
    expect(view).toContain("roundedToQuarterHour");
    expect(view).toContain("ShiftDateTimeRow");
    expect(view).toContain("Text(\"Add \\(area.label) Shift\")");
    expect(view).toContain("guard !isSubmitting, hasValidWindow else { return }");
    expect(view).toContain("Label(\"End time must be after call time.\"");
  });

  it("ranks assignment candidates while keeping warnings and server authority visible", () => {
    const view = source("ios/Wisconsin/Views/Schedule/AssignStudentSheet.swift");

    expect(view).toContain("APIClient.shared.shiftCandidateScores(shiftId: shiftId)");
    expect(view).toContain("Section(recommendations.isEmpty ? \"People\" : \"Best Fits\")");
    expect(view).toContain("Text(\"Review Before Assigning\")");
    expect(view).toContain("Button(\"Assign Anyway\")");
    expect(view).toContain("guard recommendation?.blockingConflict != true else { return }");
    expect(view).toContain("guard assigningUserId == nil else { return }");
    expect(view).toContain("Retry");
    expect(view).toContain("AssignPeopleLoadingState");
  });

  it("decodes the existing candidate-score envelope tolerantly", () => {
    const client = source("ios/Wisconsin/Core/APIClient.swift");
    const models = source("ios/Wisconsin/Models/ScheduleModels.swift");
    const route = source("src/app/api/shifts/[id]/candidate-scores/route.ts");

    expect(client).toContain("func shiftCandidateScores(shiftId: String)");
    expect(client).toContain("/api/shifts/\\(shiftId)/candidate-scores");
    expect(client).toContain("DataWrapper<[CandidateRecommendation]>");
    expect(models).toContain("struct CandidateRecommendation: Decodable");
    expect(models).toContain("decodeIfPresent([CandidateScoreSignal].self");
    expect(models).toContain("decodeIfPresent(Bool.self, forKey: .blockingConflict) ?? false");
    expect(route).toContain("requireRole(user.role, [\"ADMIN\", \"STAFF\"])");
    expect(route).toContain("return ok({ data: scores })");
  });

  it("passes event and shift context from full-screen Event detail", () => {
    const detail = source("ios/Wisconsin/Views/EventDetailSheet.swift");

    expect(detail).toContain("shiftWorkerType: shift.workerType");
    expect(detail).toContain("shiftStartsAt: shift.startsAt");
    expect(detail).toContain("shiftEndsAt: shift.endsAt");
    expect(detail.match(/eventTitle: scheduleEventDisplayTitle\(event\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
