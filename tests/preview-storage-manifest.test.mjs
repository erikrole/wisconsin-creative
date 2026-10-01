import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonical } from "../scripts/lib/migration-baseline.mjs";
import { validateResourceManifest } from "../scripts/lib/provision-preview-storage.mjs";

// A signed manifest as the trusted provisioner would produce it. Fictional identifiers.
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const config = { preview: { projectId: "prj_preview", attestationPublicKey: publicKey, branchPrefix: "wc-" } };
const state = { key: "abc123", branchId: "br_1" };

const store = (kind, access, id) => ({ kind, access, name: `wc-${state.key}-${kind}`, id });
const base = [store("public", "public", "store_pub"), store("signatures", "private", "store_sig"), store("resources", "private", "store_res")];
const applicants = store("applicants", "private", "store_app");

function signed(stores) {
  const payload = { version: 1, key: state.key, branchId: state.branchId, projectId: config.preview.projectId, stores };
  return { ...payload, signature: sign(null, Buffer.from(canonical(payload)), privateKey).toString("base64") };
}

describe("preview resource manifest and the applicant store", () => {
  it("still accepts a manifest provisioned before the applicant store existed", () => {
    expect(() => validateResourceManifest(signed(base), state, config)).not.toThrow();
  });

  it("accepts a manifest that includes the private applicant store", () => {
    expect(() => validateResourceManifest(signed([...base, applicants]), state, config)).not.toThrow();
  });

  it("still requires every original store", () => {
    expect(() => validateResourceManifest(signed([base[0], base[1], applicants]), state, config)).toThrow("identities do not match");
  });

  it("rejects an unknown store kind or a wrong access level", () => {
    expect(() => validateResourceManifest(signed([...base, store("extra", "private", "store_x")]), state, config)).toThrow("identities do not match");
    expect(() => validateResourceManifest(signed([...base, { ...applicants, access: "public" }]), state, config)).toThrow("identities do not match");
  });

  it("rejects an applicant store whose name does not belong to the branch", () => {
    expect(() => validateResourceManifest(signed([...base, { ...applicants, name: "wc-other-applicants" }]), state, config)).toThrow("identities do not match");
  });

  it("rejects a manifest with a bad signature", () => {
    const manifest = signed(base);
    expect(() => validateResourceManifest({ ...manifest, signature: Buffer.from("nope").toString("base64") }, state, config)).toThrow("attestation is invalid");
  });
});
