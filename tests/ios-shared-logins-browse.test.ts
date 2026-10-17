import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

const browse = () => source("ios/Wisconsin/Views/BrowseView.swift");
const view = () => source("ios/Wisconsin/Views/SharedLoginsView.swift");
const models = () => source("ios/Wisconsin/Models/SoftwareLoginModels.swift");
const client = () => source("ios/Wisconsin/Core/APIClient.swift");

describe("iOS shared logins", () => {
  it("adds a Shared logins row for internal roles and only the vault capability for collaborators", () => {
    const menu = browse();
    const internalRows = menu.slice(
      menu.indexOf('guard session.currentUser?.role == "COLLABORATOR" else {'),
      menu.indexOf("let capabilities"),
    );

    expect(internalRows).toContain(".licenses, .sharedLogins, .users]");
    expect(menu).toContain('case .sharedLogins: "Shared logins"');
    expect(menu).toContain("Copy a department login when you need it.");
    expect(menu).toContain("SharedLoginsView(wrapsInNavigationStack: false)");

    const collaboratorRows = menu.slice(
      menu.indexOf("let capabilities"),
      menu.indexOf("var body: some View"),
    );
    expect(collaboratorRows).toContain('capabilities.contains("SOFTWARE_VAULT_VIEW") ? .sharedLogins : nil');
    expect(collaboratorRows).not.toContain(".licenses");
  });

  it("reads the existing list and reveal routes and does not manage records", () => {
    const api = client();
    const screen = view();

    expect(api).toContain('request(path: "/api/software")');
    expect(api).toContain('request(path: "/api/software/\\(id)/secret", method: "POST")');
    expect(api).not.toContain('request(path: "/api/software", method: "POST")');
    expect(api).not.toContain('"/api/software/\\(id)", method:');

    expect(screen).toContain("APIClient.shared.softwareLogins()");
    expect(screen).toContain("APIClient.shared.softwareLoginPassword(id:");
    expect(screen).toContain("localOnly: true");
    expect(screen).toContain("addingTimeInterval(120)");
    expect(screen).toContain("Task.sleep(for: .seconds(30))");
    expect(screen).toContain("clearSecrets()");
    expect(screen).toContain("Couldn't refresh. This is the last list that loaded.");
    expect(screen).toContain("Adding, editing, and archiving stay on the website.");
    expect(screen).not.toMatch(/method:\s*"(PATCH|DELETE|PUT)"/);
    expect(screen).not.toMatch(/\.foregroundStyle\(\.(red|green|blue|orange|purple)\)/);
    expect(screen).not.toContain("print(");
  });

  it("keeps passwords out of the list model and limits which links open", () => {
    const login = models();

    expect(login).not.toContain("passwordCiphertext");
    expect(login).toContain("The list never includes the");
    expect(login).toContain('case "STAFF": "Staff"');
    expect(login).toContain('case "STUDENT": "Students"');
    expect(login).toContain('scheme == "https" || scheme == "http"');
    expect(login).not.toContain("javascript:");
  });
});
