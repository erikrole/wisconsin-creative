import { sign, verify } from "node:crypto";
import { canonical, readInfrastructureConfig } from "./migration-baseline.mjs";
import { verifyPreviewState } from "./preview-environment.mjs";
import { localChecksums } from "./local-migrations.mjs";
import { VercelPreviewApi } from "./vercel-preview-api.mjs";

const stores = [
  { kind: "public", access: "public", key: "WC_PREVIEW_BLOB_READ_WRITE_TOKEN" },
  { kind: "signatures", access: "private", key: "WC_PREVIEW_SIGNATURE_BLOB_READ_WRITE_TOKEN" },
  { kind: "resources", access: "private", key: "WC_PREVIEW_RESOURCE_ASSET_BLOB_READ_WRITE_TOKEN" },
];
export function validateResourceManifest(manifest, state, config = readInfrastructureConfig()) {
  const { signature, ...payload } = manifest;
  if (payload.key !== state.key || payload.branchId !== state.branchId || payload.projectId !== config.preview.projectId
    || !signature || !verify(null, Buffer.from(canonical(payload)), config.preview.attestationPublicKey, Buffer.from(signature, "base64"))) {
    throw new Error("Preview resource attestation is invalid");
  }
  if (payload.stores.length !== stores.length || stores.some(({ kind, access }) => !payload.stores.some((s) => s.kind === kind && s.access === access && s.name === `${config.preview.branchPrefix}${state.key}-${kind}` && /^store_[A-Za-z0-9]+$/.test(s.id)))) {
    throw new Error("Preview resource identities do not match the branch");
  }
  return payload;
}

export async function provisionPreviewStorage(state, { api = new VercelPreviewApi(), config = readInfrastructureConfig(), signingKey = process.env.PREVIEW_SIGNING_KEY } = {}) {
  const { sql } = await verifyPreviewState(state, localChecksums(), config);
  const [table] = await sql.query("SELECT to_regclass('wc_preview_meta.resources') AS name");
  if (table.name) {
    const [row] = await sql.query("SELECT manifest FROM wc_preview_meta.resources WHERE id=true");
    validateResourceManifest(row.manifest, state, config);
    const [runtime] = await sql.query("SELECT environment FROM wc_preview_meta.runtime WHERE id=true");
    state.environment = { ...runtime.environment, ...state.environment };
    state.resources = row.manifest;
    return state;
  }
  if (!signingKey) throw new Error("Provisioning isolated storage requires the trusted signing key.");
  const inventory = (await api.request("/v1/storage/stores")).stores;
  const identities = [], environment = {};
  for (const definition of stores) {
    const name = `${config.preview.branchPrefix}${state.key}-${definition.kind}`;
    const prefix = `WC_${state.key}_${definition.kind}`.toUpperCase();
    const matches = inventory.filter((s) => s.name === name);
    if (matches.length > 1) throw new Error("Duplicate preview storage names require operator reconciliation");
    let store = matches[0];
    if (!store) {
      const result = await api.request("/v1/storage/stores/blob", { method: "POST", body: { name, region: "iad1", access: definition.access } });
      store = result.store ?? result;
    }
    store = (await api.request(`/v1/storage/stores/${store.id}`)).store;
    if (store.name !== name || store.type !== "blob" || store.access !== definition.access || store.ownerId !== config.vercel.teamId) throw new Error("Preview store does not match its expected identity");
    const connections = store.projectsMetadata ?? [];
    if (connections.some((p) => p.projectId !== config.vercel.resourceProjectId || p.environments.some((e) => e !== "development") || p.envVarPrefix !== prefix)) throw new Error("Preview store has an unexpected project connection");
    if (!connections.length) await api.request(`/v1/storage/stores/${store.id}/connections`, { method: "POST", body: { envVarEnvironments: ["development"], projectId: config.vercel.resourceProjectId, type: "integration", envVarPrefix: prefix } });
    const variables = await api.request(`/v9/projects/${config.vercel.resourceProjectId}/env`);
    const variable = variables.envs.find((e) => e.key === `${prefix}_READ_WRITE_TOKEN`);
    if (!variable?.id) throw new Error("Preview store credential metadata was not returned");
    const { value: token } = await api.request(`/v1/projects/${config.vercel.resourceProjectId}/env/${variable.id}`);
    if (typeof token !== "string" || !token.startsWith("vercel_blob_rw_")) throw new Error("Preview store credential was not returned; inspect before retrying");
    environment[definition.key] = token;
    identities.push({ kind: definition.kind, access: definition.access, name, id: store.id });
  }
  const payload = { version: 1, key: state.key, branchId: state.branchId, projectId: state.projectId, stores: identities };
  const manifest = { ...payload, signature: sign(null, Buffer.from(canonical(payload)), signingKey).toString("base64") };
  await sql.transaction([
    sql.query("CREATE TABLE wc_preview_meta.resources (id boolean PRIMARY KEY DEFAULT true CHECK(id), manifest jsonb NOT NULL)"),
    sql.query("INSERT INTO wc_preview_meta.resources(manifest) VALUES ($1::jsonb)", [JSON.stringify(manifest)]),
    sql.query("UPDATE wc_preview_meta.runtime SET environment=environment || $1::jsonb,last_seen_at=now() WHERE id=true", [JSON.stringify(environment)]),
  ]);
  state.environment = { ...state.environment, ...environment }; state.resources = manifest;
  return state;
}
