import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { authUser, CUID_A, CUID_B, jsonRequest, routeCtx } from "./_helpers/route-request";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  enforceRateLimit: vi.fn(),
  service: {
    listSignatureCollections: vi.fn(),
    createAdHocSignatureMember: vi.fn(),
    getSignatureCollection: vi.fn(),
    updateSignaturePenSettings: vi.fn(),
    deleteSignatureCollection: vi.fn(),
    archiveSignatureCollection: vi.fn(),
    restoreSignatureCollection: vi.fn(),
    resetSignatureCollection: vi.fn(),
    addSignatureTeamPlayer: vi.fn(),
    updateSignatureMemberRequired: vi.fn(),
    syncSignatureCreativeStaff: vi.fn(),
    moveSignatureCapture: vi.fn(),
    getSignatureCollectionZip: vi.fn(),
    cleanupPendingSignatureArtifacts: vi.fn(),
    applySignatureRosterSnapshot: vi.fn(),
    createSignatureRosterPreview: vi.fn(),
    getReadySignatureArtifact: vi.fn(),
  },
  fetchRoster: vi.fn(),
  getBlob: vi.fn(),
  renderPng: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth, requireKiosk: vi.fn() }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  enforceRateLimit: mocks.enforceRateLimit,
}));
vi.mock("@/lib/services/companion-projection-publisher", () => ({ deferCompanionProjectionRefresh: vi.fn() }));
vi.mock("@/lib/services/signatures", () => mocks.service);
vi.mock("@/lib/signatures/uwbadgers", () => ({ fetchUWBadgersRoster: mocks.fetchRoster }));
vi.mock("@/lib/signatures/storage", () => ({ getPrivateSignatureArtifact: mocks.getBlob }));
vi.mock("@/lib/signatures/artifacts", () => ({ renderSignaturePngFromSvg: mocks.renderPng }));

import { HttpError } from "@/lib/http";
import { SIGNATURE_IMPORTED_SPORT_CODES } from "@/lib/signatures/types";
import { GET as listCollections, POST as addAdHoc } from "@/app/api/signatures/collections/route";
import { DELETE as deleteCollection, GET as getCollection, PATCH as patchSettings } from "@/app/api/signatures/collections/[id]/route";
import { POST as archive } from "@/app/api/signatures/collections/[id]/archive/route";
import { POST as restore } from "@/app/api/signatures/collections/[id]/restore/route";
import { POST as reset } from "@/app/api/signatures/collections/[id]/reset/route";
import { POST as addPlayer } from "@/app/api/signatures/collections/[id]/members/route";
import { PATCH as setRequired } from "@/app/api/signatures/collections/[id]/members/[memberId]/required/route";
import { POST as syncStaff } from "@/app/api/signatures/collections/[id]/creative-staff/route";
import { POST as moveCapture } from "@/app/api/signatures/collections/[id]/capture/[memberId]/move/route";
import { GET as download } from "@/app/api/signatures/collections/[id]/download/route";
import { POST as cleanup } from "@/app/api/signatures/cleanup/route";
import { POST as applyImport } from "@/app/api/signatures/import/apply/route";
import { POST as previewImport } from "@/app/api/signatures/import/preview/route";
import { GET as artifact } from "@/app/api/signatures/artifacts/[revisionId]/[kind]/route";

const admin = authUser(Role.ADMIN);
const staff = authUser(Role.STAFF);
const student = authUser(Role.STUDENT);
const base = `/api/signatures/collections/${CUID_A}`;
const ctx = routeCtx({ id: CUID_A });
const memberCtx = routeCtx({ id: CUID_A, memberId: "m1" });
const sportCode = SIGNATURE_IMPORTED_SPORT_CODES[0];
const pen = { strokeColor: "#112233", strokeWidth: 3, cropPadding: 8, maxWidth: 800, maxHeight: 300 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(admin);
  mocks.enforceRateLimit.mockResolvedValue(undefined);
  for (const fn of Object.values(mocks.service)) fn.mockResolvedValue({ ok: true });
});

describe("collection actions pass the caller and versions through", () => {
  const cases = [
    { name: "ad hoc member", run: () => addAdHoc(jsonRequest("/api/signatures/collections", "POST", { season: "2026-27", name: "Bucky", category: "Spirit" }), routeCtx({})), fn: "createAdHocSignatureMember", key: "signature-ad-hoc", args: { season: "2026-27", name: "Bucky", category: "Spirit" } },
    { name: "pen settings", run: () => patchSettings(jsonRequest(base, "PATCH", { ...pen, expectedCollectionVersion: 2, expectedSettingsVersion: 4 }), ctx), fn: "updateSignaturePenSettings", key: "signature-settings", args: { collectionId: CUID_A, expectedCollectionVersion: 2, expectedSettingsVersion: 4, settings: pen } },
    { name: "delete", run: () => deleteCollection(jsonRequest(base, "DELETE", { expectedCollectionVersion: 2 }), ctx), fn: "deleteSignatureCollection", key: "signature-delete", args: { collectionId: CUID_A, expectedCollectionVersion: 2 } },
    { name: "archive", run: () => archive(jsonRequest(`${base}/archive`, "POST", { expectedCollectionVersion: 2 }), ctx), fn: "archiveSignatureCollection", key: "signature-archive", args: { collectionId: CUID_A, expectedCollectionVersion: 2 } },
    { name: "restore", run: () => restore(jsonRequest(`${base}/restore`, "POST", { expectedCollectionVersion: 2 }), ctx), fn: "restoreSignatureCollection", key: "signature-restore", args: { collectionId: CUID_A, expectedCollectionVersion: 2 } },
    { name: "reset", run: () => reset(jsonRequest(`${base}/reset`, "POST", { expectedCollectionVersion: 2 }), ctx), fn: "resetSignatureCollection", key: "signature-reset", args: { collectionId: CUID_A, expectedCollectionVersion: 2 } },
    { name: "add player", run: () => addPlayer(jsonRequest(`${base}/members`, "POST", { name: "Ada", jerseyNumber: 7, expectedCollectionVersion: 2 }), ctx), fn: "addSignatureTeamPlayer", key: "signature-roster-add", args: { collectionId: CUID_A, name: "Ada", jerseyNumber: 7, expectedCollectionVersion: 2 } },
    { name: "required flag", run: () => setRequired(jsonRequest(`${base}/members/m1/required`, "PATCH", { required: false, expectedCollectionVersion: 2 }), memberCtx), fn: "updateSignatureMemberRequired", key: "signature-required", args: { collectionId: CUID_A, memberId: "m1", required: false, expectedCollectionVersion: 2 } },
    { name: "creative staff sync", run: () => syncStaff(jsonRequest(`${base}/creative-staff`, "POST", { expectedCollectionVersion: 2 }), ctx), fn: "syncSignatureCreativeStaff", key: "signature-creative-staff", args: { collectionId: CUID_A, expectedCollectionVersion: 2 } },
    { name: "move capture", run: () => moveCapture(jsonRequest(`${base}/capture/m1/move`, "POST", { targetMemberId: "m2", expectedCollectionVersion: 2, expectedCaptureVersion: 1 }), memberCtx), fn: "moveSignatureCapture", key: "signature-capture-move", args: { collectionId: CUID_A, memberId: "m1", targetMemberId: "m2", expectedCollectionVersion: 2, expectedCaptureVersion: 1 } },
    { name: "apply import", run: () => applyImport(jsonRequest("/api/signatures/import/apply", "POST", { snapshotId: CUID_B, expectedCollectionVersion: 2 }), routeCtx({})), fn: "applySignatureRosterSnapshot", key: "signature-reconcile", args: { snapshotId: CUID_B, expectedCollectionVersion: 2 } },
  ] as const;

  it.each(cases)("$name", async ({ run, fn, key, args }) => {
    const res = await run();

    expect(res.status).toBe(200);
    expect(mocks.service[fn]).toHaveBeenCalledWith({ actor: admin, ...args });
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith(`${key}:${admin.id}`, expect.anything());
  });

  it.each(cases)("$name stops at the rate limit", async ({ run, fn }) => {
    mocks.enforceRateLimit.mockRejectedValue(new HttpError(429, "Too many requests."));

    expect((await run()).status).toBe(429);
    expect(mocks.service[fn]).not.toHaveBeenCalled();
  });

  it.each(cases)("$name keeps students out", async ({ run, fn }) => {
    mocks.requireAuth.mockResolvedValue(student);

    expect((await run()).status).toBe(403);
    expect(mocks.service[fn]).not.toHaveBeenCalled();
  });

  it("keeps admin-only actions from staff", async () => {
    mocks.requireAuth.mockResolvedValue(staff);

    expect((await patchSettings(jsonRequest(base, "PATCH", { ...pen, expectedCollectionVersion: 2, expectedSettingsVersion: 4 }), ctx)).status).toBe(403);
    expect((await archive(jsonRequest(`${base}/archive`, "POST", { expectedCollectionVersion: 2 }), ctx)).status).toBe(403);
    expect((await deleteCollection(jsonRequest(base, "DELETE", { expectedCollectionVersion: 2 }), ctx)).status).toBe(403);
    expect((await addPlayer(jsonRequest(`${base}/members`, "POST", { name: "Ada", jerseyNumber: null, expectedCollectionVersion: 2 }), ctx)).status).toBe(200);
  });

  it("rejects a missing version", async () => {
    expect((await reset(jsonRequest(`${base}/reset`, "POST", { expectedCollectionVersion: 0 }), ctx)).status).toBe(400);
    expect(mocks.service.resetSignatureCollection).not.toHaveBeenCalled();
  });
});

describe("reading collections", () => {
  it("shows archived collections only to admins who ask", async () => {
    await listCollections(new Request("https://app.example.com/api/signatures/collections?includeArchived=true"), routeCtx({}));
    expect(mocks.service.listSignatureCollections).toHaveBeenLastCalledWith({ includeArchived: true });

    await listCollections(new Request("https://app.example.com/api/signatures/collections"), routeCtx({}));
    expect(mocks.service.listSignatureCollections).toHaveBeenLastCalledWith({ includeArchived: false });

    mocks.requireAuth.mockResolvedValue(staff);
    await listCollections(new Request("https://app.example.com/api/signatures/collections?includeArchived=true"), routeCtx({}));
    expect(mocks.service.listSignatureCollections).toHaveBeenLastCalledWith({ includeArchived: false });
  });

  it("reads one collection", async () => {
    mocks.service.getSignatureCollection.mockResolvedValue({ id: CUID_A });

    const res = await getCollection(new Request(`https://app.example.com${base}`), ctx);

    expect(mocks.service.getSignatureCollection).toHaveBeenCalledWith(CUID_A);
    expect(await res.json()).toEqual({ id: CUID_A });
  });

  it("runs cleanup for admins only", async () => {
    expect((await cleanup(jsonRequest("/api/signatures/cleanup", "POST"), routeCtx({}))).status).toBe(200);
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith(`signature-cleanup:${admin.id}`, expect.anything());

    mocks.requireAuth.mockResolvedValue(staff);
    expect((await cleanup(jsonRequest("/api/signatures/cleanup", "POST"), routeCtx({}))).status).toBe(403);
    expect(mocks.service.cleanupPendingSignatureArtifacts).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/signatures/import/preview", () => {
  it("fetches the official roster and returns the preview with its source", async () => {
    const snapshot = { sourceUrl: "https://uwbadgers.com/roster", sourceHash: "h1", parserVersion: 3, entries: [{ name: "Ada" }] };
    mocks.fetchRoster.mockResolvedValue(snapshot);
    mocks.service.createSignatureRosterPreview.mockResolvedValue({ snapshotId: CUID_B, changes: 1 });

    const res = await previewImport(jsonRequest("/api/signatures/import/preview", "POST", { sportCode, season: "2026-27" }), routeCtx({}));

    expect(res.status).toBe(201);
    expect(mocks.fetchRoster).toHaveBeenCalledWith(sportCode, "2026-27");
    expect(mocks.service.createSignatureRosterPreview).toHaveBeenCalledWith({ actor: admin, sportCode, season: "2026-27", ...snapshot });
    expect(await res.json()).toEqual({ snapshotId: CUID_B, changes: 1, sportCode, season: "2026-27", ...snapshot });
    expect(mocks.enforceRateLimit).toHaveBeenCalledWith(`signature-import:${admin.id}`, expect.anything());
  });

  it("rejects a badly shaped season before fetching", async () => {
    expect((await previewImport(jsonRequest("/api/signatures/import/preview", "POST", { sportCode, season: "2026" }), routeCtx({}))).status).toBe(400);
    expect(mocks.fetchRoster).not.toHaveBeenCalled();
  });
});

describe("GET download all", () => {
  it("sends a private ZIP, SVG by default", async () => {
    mocks.service.getSignatureCollectionZip.mockResolvedValue({ body: Buffer.from("zip!"), filename: "football.zip" });

    const res = await download(new Request(`https://app.example.com${base}/download`), ctx);

    expect(mocks.service.getSignatureCollectionZip).toHaveBeenCalledWith(CUID_A, "svg");
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-length")).toBe("4");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="football.zip"');
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("refuses an unknown format", async () => {
    expect((await download(new Request(`https://app.example.com${base}/download?format=gif`), ctx)).status).toBe(400);
    expect(mocks.service.getSignatureCollectionZip).not.toHaveBeenCalled();
  });
});

describe("GET a signature artifact", () => {
  const revisionCtx = (kind: string) => routeCtx({ revisionId: "rev1", kind });
  const url = (kind: string, query = "") => new Request(`https://app.example.com/api/signatures/artifacts/rev1/${kind}${query}`);
  const blobOf = (text: string) => ({ stream: new Blob([text]).stream(), blob: { size: text.length } });

  beforeEach(() => {
    mocks.service.getReadySignatureArtifact.mockImplementation(async (_id: string, kind: string) => ({
      path: `private/rev1.${kind}`, contentType: kind === "png" ? "image/png" : "image/svg+xml", filename: `ada.${kind}`,
    }));
  });

  it("refuses other kinds", async () => {
    expect((await artifact(url("gif"), revisionCtx("gif"))).status).toBe(400);
  });

  it("shows a PNG inline and streams it", async () => {
    mocks.getBlob.mockResolvedValue(blobOf("png-bytes"));

    const res = await artifact(url("png"), revisionCtx("png"));

    expect(res.headers.get("content-disposition")).toBe('inline; filename="ada.png"');
    expect(res.headers.get("content-length")).toBe("9");
    expect(await res.text()).toBe("png-bytes");
  });

  it("always downloads an SVG", async () => {
    // The stored size can be stale; the header counts the bytes actually sent.
    mocks.getBlob.mockResolvedValue({ ...blobOf("<svg/>"), blob: { size: 999 } });

    const res = await artifact(url("svg"), revisionCtx("svg"));

    expect(res.headers.get("content-length")).toBe("6");

    expect(res.headers.get("content-disposition")).toBe('attachment; filename="ada.svg"');
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(await res.text()).toBe("<svg/>");
  });

  it("renders a downloaded PNG fresh from the SVG", async () => {
    mocks.getBlob.mockResolvedValue(blobOf("<svg/>"));
    mocks.renderPng.mockResolvedValue({ png: Buffer.from("fresh") });

    const res = await artifact(url("png", "?download=1"), revisionCtx("png"));

    expect(mocks.getBlob).toHaveBeenCalledWith("private/rev1.svg");
    expect(mocks.renderPng).toHaveBeenCalledWith("<svg/>");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="ada.png"');
    expect(res.headers.get("content-length")).toBe("5");
    expect(await res.text()).toBe("fresh");
  });

  it("returns 404 when the stored file is gone", async () => {
    mocks.getBlob.mockResolvedValue(null);

    expect((await artifact(url("svg"), revisionCtx("svg"))).status).toBe(404);
    expect((await artifact(url("png", "?download=1"), revisionCtx("png"))).status).toBe(404);
  });

  it("keeps students out", async () => {
    mocks.requireAuth.mockResolvedValue(student);

    expect((await artifact(url("png"), revisionCtx("png"))).status).toBe(403);
  });
});
