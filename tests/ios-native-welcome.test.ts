import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";
import { apiClientSource } from "./_helpers/ios-api-client-source";

describe("native iOS Welcome flow", () => {
  it("routes forced-password users before Welcome and Welcome before the tab shell", () => {
    const app = source("ios/Wisconsin/App/WisconsinApp.swift");

    // Precedence inside the routing switch, not raw file offsets. The
    // read-only role preview short-circuits to a second, *earlier*
    // `AppTabView()` branch, so a bare indexOf comparison read the Welcome
    // route as coming last and failed against correct source.
    const route = app.slice(
      app.indexOf("switch profileCompletion.route("),
      app.indexOf("LoginView()"),
    );
    expect(route.indexOf("case .welcome:")).toBeLessThan(route.indexOf("case .app:"));
    expect(route).toContain("ProfileCompletionWelcomeView()");
    expect(route).toContain("AppTabView()");

    // Forced password change outranks the completion route entirely.
    expect(app.indexOf("user.forcePasswordChange")).toBeLessThan(app.indexOf("switch profileCompletion.route("));
    expect(app.indexOf("PasswordSetupView(email: user.email)")).toBeLessThan(app.indexOf("switch profileCompletion.route("));
    // The preview shell is a deliberate bypass, not an accident.
    expect(app).toContain("user.isReadOnlyRolePreview");
    expect(app).toContain("session.usedOptimisticSessionSnapshot");
    // Push permission is an explicit Profile > Notifications action, never an
    // automatic side effect of completing the profile or entering the shell.
    expect(app).not.toContain("pushPromptEligibleUserId");
    expect(source("ios/Wisconsin/Views/ProfileView.swift")).toContain("PushPrePromptView()");
  });

  it("keeps the routing hint free of private profile fields", () => {
    const store = source("ios/Wisconsin/Core/ProfileCompletionStore.swift");
    const hint = store.slice(
      store.indexOf("private struct ProfileCompletionHint"),
      store.indexOf("@MainActor"),
    );

    expect(hint).toContain("profileComplete");
    expect(hint).toContain("snoozedUntil");
    expect(hint).toContain("firstIncompleteStep");
    expect(hint).not.toMatch(/athleticsEmail|personalPhone|workPhone|wiscardCardNumber|topSize|shoeSize|avatarUrl/);
  });

  it("mirrors the role-aware server steps and keeps collaborator setup skippable", () => {
    const models = source("ios/Wisconsin/Models/ProfileCompletionModels.swift");
    const welcome = source("ios/Wisconsin/Views/Welcome/ProfileCompletionWelcomeView.swift");
    const components = source("ios/Wisconsin/Views/Welcome/ProfileCompletionWelcomeComponents.swift");

    expect(models).toContain('case "COLLABORATOR": [.photo]');
    expect(models).toContain('case "STUDENT": [.phones, .wiscard, .student, .apparel, .photo]');
    expect(models).toContain("default: [.email, .phones, .wiscard, .apparel, .photo]");
    expect(components).toContain("if !hasSimplePhoneStep");
    expect(components).toContain("I don’t have a work phone");
    expect(welcome).toContain("currentStep == .photo");
    expect(welcome).toContain("snooze()");
  });

  it("requires the printed ten-digit Wiscard number and one-digit issue code", () => {
    const draft = source("ios/Wisconsin/Views/Welcome/ProfileCompletionDraft.swift");
    const components = source("ios/Wisconsin/Views/Welcome/ProfileCompletionWelcomeComponents.swift");

    expect(draft).toContain("digits(wiscardCardNumber).count == 10");
    expect(draft).toContain("digits(wiscardIssueCode).count == 1");
    expect(components).toContain("prefix(10)");
    expect(components).toContain("prefix(1)");
  });

  it("uses the existing completion and multipart avatar contracts", () => {
    const api = apiClientSource();

    expect(api).toContain('request(path: "/api/me/profile-completion")');
    expect(api).toContain('request(path: "/api/me/profile-completion", method: "PATCH")');
    expect(api).toContain('name=\\"file\\"; filename=\\"profile.jpg\\"');
    expect(api).toContain('request(path: "/api/users/\\(userId)/avatar", method: "POST")');
    expect(api).toContain("multipart/form-data; boundary=");
  });

  it("provides native photo selection, drag, pinch, crop, and reduced-motion handling", () => {
    const welcome = source("ios/Wisconsin/Views/Welcome/ProfileCompletionWelcomeView.swift");
    const components = source("ios/Wisconsin/Views/Welcome/ProfileCompletionWelcomeComponents.swift");
    const crop = source("ios/Wisconsin/Views/Welcome/ProfilePhotoCropView.swift");
    const imageProcessor = source("ios/Wisconsin/Core/ThumbnailLoader.swift");

    expect(components).toContain("PhotosPicker(selection: $photoSelection, matching: .images)");
    expect(welcome).toContain("NativeImageProcessor.downsample");
    expect(welcome).toContain("reduceMotion ? .easeOut(duration: 0.12)");
    expect(welcome).toContain("photoLoadError = \"That photo couldn’t be opened.");
    expect(crop).toContain("UIScrollViewDelegate");
    expect(crop).toContain("viewForZooming(in scrollView: UIScrollView)");
    expect(imageProcessor).toContain("width: 512, height: 512");
    expect(imageProcessor).toContain("jpegData(compressionQuality: 0.9)");
    expect(crop).toContain("@Environment(\\.dismiss)");
  });

  it("adapts footer actions and presents choices in field-owned sheets", () => {
    const welcome = source("ios/Wisconsin/Views/Welcome/ProfileCompletionWelcomeView.swift");
    const components = source("ios/Wisconsin/Views/Welcome/ProfileCompletionWelcomeComponents.swift");
    const crop = source("ios/Wisconsin/Views/Welcome/ProfilePhotoCropView.swift");

    expect(components).toContain('Button("Remind tomorrow", action: onReminder)');
    expect(components).toContain("ViewThatFits(in: .horizontal)");
    expect(welcome).toContain("showsReminder: currentStep != .photo");
    expect(welcome).toContain('return isLastStep ? "Finish" : "Skip"');
    expect(components).toContain("or add one later from Profile");
    expect(components).toContain("struct WelcomeSelectionField<Value: Hashable>");
    expect(components).toContain(".presentationDetents([.medium, .large])");
    expect(components).not.toContain(".pickerStyle(.menu)");
    expect(crop).toContain('.navigationTitle("Crop photo")');
    expect(crop).toContain('Text("Save").fontWeight(.semibold)');
  });

  it("records a final photo skip on the account before showing the finish screen", () => {
    const welcome = source("ios/Wisconsin/Views/Welcome/ProfileCompletionWelcomeView.swift");
    const store = source("ios/Wisconsin/Core/ProfileCompletionStore.swift");
    const skip = welcome.slice(welcome.indexOf("private func skipOptionalStep"), welcome.indexOf("private func snooze"));

    expect(skip).toContain("completionStore.finishSetup(for: user)");
    expect(skip).not.toContain("snooze()");
    // The finish screen holds the Welcome route and only Continue hands off to the app.
    expect(store).toContain("if finish?.userId == user.id { return .welcome }");
    expect(store).toMatch(/func dismissFinish[\s\S]*continueForSession/);
  });

  it("does not require graduation and sends it only when a term is chosen", () => {
    const draft = source("ios/Wisconsin/Views/Welcome/ProfileCompletionDraft.swift");
    const models = source("ios/Wisconsin/Models/ProfileCompletionModels.swift");
    const components = source("ios/Wisconsin/Views/Welcome/ProfileCompletionWelcomeComponents.swift");

    expect(draft).toContain("return !studentYear.isEmpty\n");
    expect(draft).not.toContain("!graduationTerm.isEmpty\n        case .apparel");
    expect(draft).toContain("graduationTerm: hasTerm ? graduationTerm : nil");
    expect(models).toContain("case student(year: String, graduationTerm: String?, gradYear: Int?)");
    expect(models).toContain("encodeIfPresent(graduationTerm");
    expect(components).toContain('WelcomeFieldLabel(title: "Anticipated graduation")');
    expect(components).not.toMatch(/Anticipated graduation[^"]*optional/i);
  });

  it("closes Welcome with the native finish screen that matches the web copy", () => {
    const finish = source("ios/Wisconsin/Views/Welcome/WelcomeFinishView.swift");

    expect(finish).toContain("You’re all set, \\(firstName)");
    expect(finish).toContain("Welcome, \\(firstName)");
    expect(finish).toContain("We’ll remind you tomorrow to finish your profile");
    for (const title of ["Check the schedule", "Find your gear", "Read the guides"]) {
      expect(finish).toContain(title);
    }
    expect(finish).toContain("static func steps(for role: String)");
    // Role-aware like the web: students add unavailable times first; collaborators get Continue only.
    expect(finish).toContain('case "COLLABORATOR": []');
    expect(finish).toContain("Add when you can’t work");
    expect(finish).toContain("Build crews and see which events still need people.");
    expect(finish).toContain("Text(\"Continue\")");
  });

  it("manages field focus, the number-pad keyboard, and deterministic preview states", () => {
    const welcome = source("ios/Wisconsin/Views/Welcome/ProfileCompletionWelcomeView.swift");
    const components = source("ios/Wisconsin/Views/Welcome/ProfileCompletionWelcomeComponents.swift");

    expect(welcome).toContain("@FocusState private var focusedField");
    expect(welcome).toContain("ToolbarItemGroup(placement: .keyboard)");
    expect(welcome).toContain(".scrollDismissesKeyboard(.interactively)");
    expect(components).toContain('#Preview("Student Welcome")');
    expect(components).toContain('#Preview("Staff Welcome")');
    expect(components).toContain('#Preview("Welcome loading")');
    expect(components).toContain('#Preview("Welcome failure")');
    expect(components).toContain('#Preview("Accessibility layout")');
  });

  it("formats the email step as two concise field groups", () => {
    const components = source("ios/Wisconsin/Views/Welcome/ProfileCompletionWelcomeComponents.swift");

    expect(components).toContain('WelcomeFieldLabel(title: "Campus email", detail: "Site login")');
    expect(components).toContain(".minimumScaleFactor(0.82)");
    expect(components).toContain('Text("Required address ending in @athletics.wisc.edu")');
    expect(components).not.toContain('WelcomeFieldLabel(title: "Campus email and site login")');
    expect(components).not.toContain('Text("Everyone should enter their @athletics.wisc.edu address.")');
  });

  it("keeps incomplete profile re-entry available from Profile", () => {
    const profile = source("ios/Wisconsin/Views/ProfileView.swift");

    expect(profile).toContain('title: "Complete profile"');
    expect(profile).toContain("profileCompletion.presentManually(for: user.id)");
  });

  it("offers an optional first-weeks checklist on Home for new students", () => {
    const card = source("ios/Wisconsin/Views/GettingStartedCard.swift");
    const home = source("ios/Wisconsin/Views/HomeView.swift");
    const models = source("ios/Wisconsin/Models/Models.swift");
    const welcome = source("ios/Wisconsin/Views/Welcome/WelcomeFinishView.swift");

    // Students only, inside the same 14-day window as the web card.
    expect(card).toContain('role == "STUDENT"');
    expect(card).toContain("static let windowDays = 14");
    expect(models).toContain("accountCreatedAt = try container.decodeIfPresent(String.self");
    // Optional offer: dismissible, and notifications only navigate, never prompt.
    expect(card).toContain("Hide getting started");
    expect(card).toContain("pendingSettingsDestination = .notifications");
    expect(card).not.toMatch(/requestAuthorization|registerForRemoteNotifications|PushPrePromptView/);
    // Any "cannot work" block counts as done from the API, matching the web isUnavailableBlock rule.
    expect(card).toContain("availabilityBlocks(userId:");
    expect(card).toContain('($0.intent ?? "CANNOT_WORK") == "CANNOT_WORK"');
    // Stores row ids and a dismissed flag only, per user.
    expect(card).toContain('"WisconsinGettingStarted.\\(userId)"');
    expect(card).not.toMatch(/phone|wiscard|topSize|shoeSize|avatarUrl/i);
    expect(home).toContain("GettingStartedCard(model: gettingStarted)");
    // The finish screen and the card open the same screens.
    expect(welcome).toContain("step.destination.open(in: appState)");
    expect(welcome).toContain("case .schedule: .schedule");
  });

  it("keeps days a student can't work one tap away on Home and Schedule", () => {
    const card = source("ios/Wisconsin/Views/CantWorkCard.swift");
    const home = source("ios/Wisconsin/Views/HomeView.swift");
    const schedule = source("ios/Wisconsin/Views/ScheduleView.swift");

    // Student workers only, matching the web gate and Schedule's availability gate.
    expect(card).toContain('user.role == "STUDENT" && user.staffingType == "ST" && !user.isReadOnlyRolePreview');
    // One dated "cannot work" block through the existing availability API.
    expect(card).toContain('kind: "AD_HOC"');
    expect(card).toContain('intent: "CANNOT_WORK"');
    expect(card).toContain("createAvailabilityBlock(");
    // Upcoming-only summary with the same copy as the web card.
    expect(card).toContain("through >= startOfToday");
    expect(card).toContain("Every week: ");
    expect(card).toContain("Add days you can’t work");
    expect(home).toContain("CantWorkCard()");
    // Schedule gets a labelled toolbar action for the same sheet, starting on the focused day.
    expect(schedule).toContain('Label("Can’t work", systemImage: "calendar.badge.minus")');
    expect(schedule).toContain("CantWorkQuickSheet(userId:");
    expect(schedule).toContain("scrollTracker.topDay ?? today");
  });
});
