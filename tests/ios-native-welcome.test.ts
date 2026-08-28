import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

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
    expect(app).toContain("profileCompletion.pushPromptEligibleUserId");
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
    const api = source("ios/Wisconsin/Core/APIClient.swift");

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
    expect(crop).toContain("DragGesture()");
    expect(crop).toContain("MagnifyGesture()");
    expect(imageProcessor).toContain("width: 1024, height: 1024");
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

  it("keeps a final photo skip local to the current session", () => {
    const welcome = source("ios/Wisconsin/Views/Welcome/ProfileCompletionWelcomeView.swift");
    const skip = welcome.slice(welcome.indexOf("private func skipOptionalStep"), welcome.indexOf("private func snooze"));

    expect(skip).toContain("continueForSession(for: user.id)");
    expect(skip).not.toContain("snooze()");
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
});
