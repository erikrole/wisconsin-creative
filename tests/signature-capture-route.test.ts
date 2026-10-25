import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  rateLimit: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  enforceRateLimit: mocks.rateLimit,
}));
vi.mock("@/lib/services/signatures", () => ({ saveSignatureCapture: mocks.save, removeSignatureCapture: mocks.remove }));
vi.mock("@/lib/services/companion-projection-publisher", () => ({ deferCompanionProjectionRefresh: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { DELETE, POST } from "@/app/api/signatures/collections/[id]/capture/[memberId]/route";
import { SIGNATURE_CAPTURE_LIMIT, SIGNATURE_MUTATION_LIMIT } from "@/lib/rate-limit";
import { SIGNATURE_MAX_PAYLOAD_BYTES } from "@/lib/signatures/types";

const staff = { id: "staff-1", email: "staff@example.com", name: "Staff", role: Role.STAFF };
const params = { params: Promise.resolve({ id: "collection-1", memberId: "player-1" }) };
const headers = { host: "app.example.com", origin: "https://app.example.com", "content-type": "application/json" };
const capture = {
  requestId: "req_0123456789abcdef",
  expectedCaptureVersion: 2,
  settingsVersion: 1,
  strokes: [{ points: [{ x: 10, y: 20 }, { x: 30, y: 40 }] }],
};

function post(body: BodyInit, extraHeaders: Record<string, string> = {}) {
  return POST(new Request("https://app.example.com/api/signatures/collections/collection-1/capture/player-1", {
    method: "POST",
    headers: { ...headers, ...extraHeaders },
    body,
    duplex: "half",
  } as RequestInit), params);
}

function streamed(chunks: Uint8Array[], cancel = vi.fn()) {
  let index = 0;
  return {
    cancel,
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index < chunks.length) controller.enqueue(chunks[index++]!);
        else controller.close();
      },
      cancel,
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(staff);
  mocks.rateLimit.mockResolvedValue(undefined);
  mocks.save.mockResolvedValue({ data: { captureVersion: 3 } });
  mocks.remove.mockResolvedValue({ data: { captureVersion: 4 } });
});

describe("POST signature capture", () => {
  it("saves the strokes for the member", async () => {
    const response = await post(JSON.stringify(capture));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { captureVersion: 3 } });
    expect(mocks.rateLimit).toHaveBeenCalledWith("signature-capture:staff-1", SIGNATURE_CAPTURE_LIMIT);
    expect(mocks.save).toHaveBeenCalledWith({ actor: staff, collectionId: "collection-1", memberId: "player-1", request: capture });
  });

  it("reassembles a body sent in pieces", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(capture));
    const { body } = streamed([bytes.slice(0, 20), bytes.slice(20, 50), bytes.slice(50)]);

    const response = await post(body, {});

    expect(response.status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ request: capture }));
  });

  it("refuses a body declared too large before reading it", async () => {
    const response = await post(JSON.stringify(capture), { "content-length": String(SIGNATURE_MAX_PAYLOAD_BYTES + 1) });

    expect(response.status).toBe(413);
    expect((await response.json()).error).toBe("Signature payload is too large");
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("stops reading a body that grows past the limit", async () => {
    const chunk = new Uint8Array(400_000);
    const { body, cancel } = streamed([chunk, chunk, chunk, chunk]);

    const response = await post(body);

    expect(response.status).toBe(413);
    expect(cancel).toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each([
    ["broken JSON", "{", "Invalid JSON payload"],
    ["no strokes", JSON.stringify({ ...capture, strokes: [] }), undefined],
    ["a short request id", JSON.stringify({ ...capture, requestId: "short" }), undefined],
  ])("rejects %s", async (_label, raw, message) => {
    const response = await post(raw);

    expect(response.status).toBe(400);
    if (message) expect((await response.json()).error).toBe(message);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("keeps students out before reading anything", async () => {
    mocks.requireAuth.mockResolvedValue({ ...staff, role: Role.STUDENT });

    expect((await post(JSON.stringify(capture))).status).toBe(403);
    expect(mocks.rateLimit).not.toHaveBeenCalled();
  });
});

describe("DELETE signature capture", () => {
  function remove(body: unknown) {
    return DELETE(new Request("https://app.example.com/api/signatures/collections/collection-1/capture/player-1", {
      method: "DELETE",
      headers,
      body: JSON.stringify(body),
    }), params);
  }

  it("removes the capture at the version the person saw", async () => {
    const response = await remove({ expectedCaptureVersion: 3 });

    expect(await response.json()).toEqual({ data: { captureVersion: 4 } });
    expect(mocks.rateLimit).toHaveBeenCalledWith("signature-remove:staff-1", SIGNATURE_MUTATION_LIMIT);
    expect(mocks.remove).toHaveBeenCalledWith({ actor: staff, collectionId: "collection-1", memberId: "player-1", expectedCaptureVersion: 3 });
  });

  it("needs a version and keeps students out", async () => {
    expect((await remove({})).status).toBe(400);

    mocks.requireAuth.mockResolvedValue({ ...staff, role: Role.STUDENT });
    expect((await remove({ expectedCaptureVersion: 3 })).status).toBe(403);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
