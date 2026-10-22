import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";
import { apiClientSource } from "./_helpers/ios-api-client-source";

describe("iOS Damage and loss queue", () => {
  const view = source("ios/Wisconsin/Views/DamageCasesView.swift");
  const models = source("ios/Wisconsin/Models/DamageCaseModels.swift");
  const apiClient = apiClientSource();
  const browse = source("ios/Wisconsin/Views/BrowseView.swift");
  const route = source("src/app/api/damage-cases/route.ts");
  const service = source("src/lib/services/damage-cases.ts");

  it("reads the staff queue the web page already uses", () => {
    expect(route).toContain('requirePermission(user.role, "checkin_report", "dismiss")');
    expect(route).toContain('searchParams.get("view") === "closed"');
    expect(apiClient).toContain('request(path: "/api/damage-cases", queryItems: [.init(name: "view", value: view.rawValue)])');
    for (const field of ["stillBookable", "responsible", "resolutionNote", "allowedResolutions"]) {
      expect(service).toContain(field);
    }
    for (const field of ["stillBookable", "responsible", "resolutionNote", "resolvedBy"]) {
      expect(models).toContain(field);
    }
    expect(models).toContain("try? DamageCase(from: decoder)");
  });

  it("is staff-only, in Browse, with an open-count badge", () => {
    expect(browse).toContain("if isStaffOrAdmin {");
    expect(browse).toContain("rows.insert(.damage, at: 6)");
    expect(browse).toContain("DamageCasesView(wrapsInNavigationStack: false)");
    expect(browse).toContain("openDamageCases = (try? await APIClient.shared.damageCases(view: .open))?.counts.open ?? 0");
  });

  it("has Open/Closed, a type filter, empty states, pills and a detail with Record outcome", () => {
    expect(view).toContain("Picker(\"Cases\", selection: $model.view)");
    expect(view).toContain("Picker(\"Type\", selection: $filter)");
    expect(view).toContain('"No open cases"');
    expect(view).toContain("Nothing is waiting on staff.");
    expect(view).toContain("struct DamageCaseStatusPill");
    expect(view).toContain("struct DamageCaseDetailView");
    expect(view).toContain("RecordOutcomeSheet(reportId: item.id, isMissing: item.isMissing)");
    expect(view).toContain("dynamicTypeSize.isAccessibilitySize");
    expect(view).toContain('"Still bookable');
  });

  it("keeps the queue fixtures debug-only", () => {
    const instrumentation = source("ios/Wisconsin/Core/PerformanceInstrumentation.swift");
    for (const name of ["damage-queue-open", "damage-queue-closed", "damage-queue-empty", "damage-queue-detail", "damage-queue-record"]) {
      expect(instrumentation).toContain(`"${name}"`);
    }
    expect(source("ios/Wisconsin/App/PerformanceTestHarness.swift")).toContain('case "/api/damage-cases": return DamageQueueFixtureAPI.list(for: request)');
  });
});
