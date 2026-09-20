import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { decryptSoftwareSecret, encryptSoftwareSecret } from "../src/lib/software-vault-crypto";
import { canViewSoftwareCredential } from "../src/lib/software-vault-access";
import {
  createSoftwareCredentialSchema,
  updateSoftwareCredentialSchema,
} from "../src/lib/software-vault-validation";
import { source } from "./_helpers/source";

const originalVaultKey = process.env.SOFTWARE_VAULT_KEY;

beforeEach(() => {
  process.env.SOFTWARE_VAULT_KEY = Buffer.alloc(32, 7).toString("base64");
});

afterAll(() => {
  if (originalVaultKey === undefined) delete process.env.SOFTWARE_VAULT_KEY;
  else process.env.SOFTWARE_VAULT_KEY = originalVaultKey;
});

describe("software vault crypto", () => {
  it("round-trips secrets without storing plaintext", () => {
    const plaintext = "correct horse battery staple / Motion Array";
    const ciphertext = encryptSoftwareSecret(plaintext);

    expect(ciphertext).not.toContain(plaintext);
    expect(ciphertext.split(".")).toHaveLength(4);
    expect(decryptSoftwareSecret(ciphertext)).toBe(plaintext);
  });

  it("uses a fresh IV for repeated values", () => {
    const first = encryptSoftwareSecret("same password");
    const second = encryptSoftwareSecret("same password");

    expect(first).not.toBe(second);
    expect(decryptSoftwareSecret(first)).toBe("same password");
    expect(decryptSoftwareSecret(second)).toBe("same password");
  });

  it("fails closed when ciphertext is tampered with", () => {
    const ciphertext = encryptSoftwareSecret("secret");
    const parts = ciphertext.split(".");
    const encodedCiphertext = parts[3];
    expect(encodedCiphertext).toBeDefined();
    if (!encodedCiphertext) throw new Error("Expected ciphertext segment");
    const last = encodedCiphertext.endsWith("A") ? "B" : "A";
    parts[3] = `${encodedCiphertext.slice(0, -1)}${last}`;

    expect(() => decryptSoftwareSecret(parts.join("."))).toThrow("Invalid software vault ciphertext");
  });

  it("fails closed when the dedicated key is missing or malformed", () => {
    delete process.env.SOFTWARE_VAULT_KEY;
    expect(() => encryptSoftwareSecret("secret")).toThrow("Missing required environment variable: SOFTWARE_VAULT_KEY");

    process.env.SOFTWARE_VAULT_KEY = Buffer.alloc(16, 3).toString("base64");
    expect(() => encryptSoftwareSecret("secret")).toThrow("SOFTWARE_VAULT_KEY must decode to exactly 32 bytes");

    process.env.SOFTWARE_VAULT_KEY = `${Buffer.alloc(32, 3).toString("base64").slice(0, -1)}!`;
    expect(() => encryptSoftwareSecret("secret")).toThrow("SOFTWARE_VAULT_KEY must decode to exactly 32 bytes");
  });
});

describe("software vault source contracts", () => {
  it("keeps passwords out of list responses and gates role or capability access", () => {
    const route = source("src/app/api/software/route.ts");
    const permissions = source("src/lib/permissions.ts");
    const service = source("src/lib/services/software.ts");

    expect(route).toContain('requirePermissionOrCollaboratorCapability(user, "software", "view", "SOFTWARE_VAULT_VIEW")');
    expect(route).toContain("listSoftwareCredentials({");
    expect(route).not.toContain("password: body.password");
    expect(permissions).toContain('software: {');
    expect(permissions).toContain('view: ["ADMIN", "STAFF", "STUDENT"]');
    expect(permissions).toContain('manage: ["ADMIN", "STAFF"]');
    expect(service).toContain("decryptSoftwareSecret(row.accountEmailCiphertext)");
    expect(service).toContain("canViewSoftwareCredential(role, row.visibleTo, collaboratorCanView)");
    expect(service).toContain("visibleTo: row.visibleTo");
    expect(service).toContain("passwordCiphertext");
  });

  it("uses an audited, rate-limited reveal boundary", () => {
    const route = source("src/app/api/software/[id]/secret/route.ts");
    const service = source("src/lib/services/software.ts");

    expect(route).toContain('requirePermissionOrCollaboratorCapability(user, "software", "reveal", "SOFTWARE_VAULT_VIEW")');
    expect(route).toContain('software:reveal:${user.id}');
    expect(route).toContain("export const POST");
    expect(route).not.toContain("export const GET");
    expect(service).toContain('action: "reveal_password"');
    expect(service).toContain("createAuditEntryTx(tx");
    expect(service).toContain("Prisma.TransactionIsolationLevel.Serializable");
    expect(route).toContain('return ok({ data: { password: credential.password } });');
    expect(service).not.toContain("after: { password:");
  });

  it("keeps the page masked until an explicit secret request", () => {
    const sidebar = source("src/components/Sidebar.tsx");
    const page = source("src/app/(app)/licenses/page.tsx");
    const vault = source("src/app/(app)/licenses/SoftwareVault.tsx");
    const schema = source("prisma/schema.prisma");

    expect(sidebar).toContain('{ label: "Software", href: "/licenses"');
    expect(page).toContain('<SoftwareVault isAdmin={isAdmin} />');
    expect(vault).toContain('fetch(`/api/software/${id}/secret`, { method: "POST" })');
    expect(vault).toContain("••••••••••••");
    expect(vault).toContain("Reveals are logged");
    expect(vault).toContain("<Checkbox");
    expect(vault).toContain("Who is this shared with?");
    expect(vault).toContain('key="copied"');
    expect(vault).toContain('showCopied(`${record.id}:password`)');
    expect(schema).toContain("accountEmailCiphertext");
    expect(schema).toContain("passwordCiphertext");
    expect(schema).toContain("visibleTo");
  });

  it("keeps collaborator access capability-gated and audience metadata editable", () => {
    const collaboratorAccess = source("src/lib/collaborator-access.ts");
    const collaboratorSettings = source("src/app/(app)/settings/collaborator-access/page.tsx");
    const validation = source("src/lib/software-vault-validation.ts");
    const migration = source("prisma/migrations/0126_software_credential_visibility/migration.sql");

    expect(collaboratorAccess).toContain('"SOFTWARE_VAULT_VIEW"');
    expect(collaboratorSettings).toContain('key: "SOFTWARE_VAULT_VIEW"');
    expect(validation).toContain("DEFAULT_SOFTWARE_CREDENTIAL_AUDIENCES");
    expect(migration).toContain('"visible_to"');
    expect(migration).toContain("'STAFF', 'STUDENT'");
  });
});

describe("software vault audiences", () => {
  it("keeps staff operators omniscient and filters students and collaborators", () => {
    expect(canViewSoftwareCredential("ADMIN", ["COLLABORATOR"])).toBe(true);
    expect(canViewSoftwareCredential("STAFF", ["STUDENT"])).toBe(true);
    expect(canViewSoftwareCredential("STUDENT", ["STUDENT"])).toBe(true);
    expect(canViewSoftwareCredential("STUDENT", ["STAFF"])).toBe(false);
    expect(canViewSoftwareCredential("COLLABORATOR", ["COLLABORATOR"], true)).toBe(true);
    expect(canViewSoftwareCredential("COLLABORATOR", ["COLLABORATOR"], false)).toBe(false);
    expect(canViewSoftwareCredential("COLLABORATOR", ["STUDENT"], true)).toBe(false);
  });

  it("defaults new records to staff and students and preserves partial lifecycle patches", () => {
    const created = createSoftwareCredentialSchema.parse({
      name: "Photo Mechanic",
      accountEmail: "shared@example.com",
      password: "not-a-real-secret",
    });

    expect(created.visibleTo).toEqual(["STAFF", "STUDENT"]);
    expect(updateSoftwareCredentialSchema.parse({ archived: true })).toEqual({ archived: true });
    expect(() => updateSoftwareCredentialSchema.parse({ visibleTo: [] })).toThrow("Choose at least one audience");
    expect(() => updateSoftwareCredentialSchema.parse({})).toThrow("Choose at least one field to update");
    expect(() => createSoftwareCredentialSchema.parse({
      name: "Motion Array",
      accountEmail: "shared@example.com",
      password: "not-a-real-secret",
      unexpected: true,
    })).toThrow("Unrecognized key");
  });
});
