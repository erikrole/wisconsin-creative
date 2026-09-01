import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getAllowedRoles } from "@/lib/permissions";
import { appendDistinctSignaturePoints, isIpadDevice, shouldRetainSignatureSaveRequestId, signatureCanvasViewport, signaturePointFromClient } from "@/lib/signatures/capture";
import { buildSignatureDraft, isFreshSignatureDraft, signatureDraftKey, signatureDraftMatchesMember } from "@/lib/signatures/drafts";
import { renderSignatureArtifacts, SIGNATURE_PNG_MIN_WIDTH } from "@/lib/signatures/artifacts";
import { buildSignatureCurve, buildSignatureSvg, resolveSignatureExportSize, resolveSignatureStrokeWidth, signaturePathData, SIGNATURE_STROKE_SCALE_MIN } from "@/lib/signatures/geometry";
import { acceptsSignaturePointer, appendCoalescedPointerEvents } from "@/lib/signatures/pointer";
import { captureSaveRequestSchema, DEFAULT_SIGNATURE_PEN_SETTINGS, isRequiredSignatureGroup, SIGNATURE_IMPORTED_SPORT_CODES, SIGNATURE_MAX_POINTS_PER_STROKE, SIGNATURE_MAX_STROKES, SIGNATURE_SPORT_REGISTRY, signatureAdHocMemberSchema, signatureCollectionTitle, signatureCollectionVersionSchema, signatureRosterEntrySchema } from "@/lib/signatures/types";
import { compareSignatureRosterMembers } from "@/lib/signatures/roster";
import { buildUWBadgersRosterUrl, fetchUWBadgersRoster, isAllowedUWBadgersUrl, normalizedRosterHash, parseUWBadgersRosterHtml } from "@/lib/signatures/uwbadgers";

describe("signature input and draft contracts", () => {
  it("recognizes iPadOS while rejecting desktop and iPhone clients", () => {
    expect(isIpadDevice("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)", "iPad", 5)).toBe(true);
    expect(isIpadDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 5)).toBe(true);
    expect(isIpadDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 0)).toBe(false);
    expect(isIpadDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", "iPhone", 5)).toBe(false);
  });

  it("only accepts pen-class drawing input while leaving controls independent", () => {
    expect(acceptsSignaturePointer("pen")).toBe(true);
    expect(acceptsSignaturePointer("touch")).toBe(false);
    expect(acceptsSignaturePointer("mouse")).toBe(false);
    expect(acceptsSignaturePointer("")).toBe(false);
  });

  it("keeps the dispatched Pencil point after coalesced history", () => {
    const historical = { pointerId: 7, clientX: 10, clientY: 10 } as PointerEvent;
    const event = {
      pointerId: 7,
      clientX: 20,
      clientY: 20,
      getCoalescedEvents: () => [historical],
    } as unknown as Pick<PointerEvent, "getCoalescedEvents">;

    expect(appendCoalescedPointerEvents(event)).toEqual([historical, event]);
  });

  it("keys drafts by actor, target, settings, and capture version", () => {
    const key = signatureDraftKey("user", "collection", "member", 3, 7);
    const draft = buildSignatureDraft({
      key,
      userId: "user",
      collectionId: "collection",
      memberId: "member",
      settingsVersion: 3,
      captureVersion: 7,
      canvasSize: { width: 1024, height: 640 },
      strokes: [{ points: [{ x: 1, y: 2 }] }],
    }, 1000);
    expect(key).toBe("user:collection:member:3:7");
    expect(draft.expiresAt).toBeGreaterThan(draft.savedAt);
    expect(isFreshSignatureDraft(draft, draft.savedAt + 1)).toBe(true);
    expect(isFreshSignatureDraft(draft, draft.expiresAt)).toBe(false);
  });

  it("keeps one save request ID with a device-local draft across an ambiguous reload", () => {
    const draft = buildSignatureDraft({
      key: signatureDraftKey("operator", "collection", "member", 1, 0),
      userId: "operator",
      collectionId: "collection",
      memberId: "member",
      settingsVersion: 1,
      captureVersion: 0,
      saveRequestId: "request-ambiguous-1234",
      canvasSize: { width: 1024, height: 640 },
      strokes: [{ points: [{ x: 4, y: 8 }] }],
    });

    expect(draft.saveRequestId).toBe("request-ambiguous-1234");
    expect(draft.key).toBe("operator:collection:member:1:0");
  });

  it("finds a prior device-local draft without treating its request as current", () => {
    const identity = { userId: "operator", collectionId: "collection", memberId: "member", settingsVersion: 1 };
    expect(signatureDraftMatchesMember(identity, identity)).toBe(true);
    expect(signatureDraftMatchesMember(identity, { ...identity, memberId: "other-member" })).toBe(false);
  });

  it("retains the same operation for retryable responses while making a 409 retry fresh", () => {
    expect(shouldRetainSignatureSaveRequestId(425)).toBe(true);
    expect(shouldRetainSignatureSaveRequestId(429)).toBe(true);
    expect(shouldRetainSignatureSaveRequestId(500)).toBe(true);
    expect(shouldRetainSignatureSaveRequestId(503)).toBe(true);
    expect(shouldRetainSignatureSaveRequestId(409)).toBe(false);
    expect(shouldRetainSignatureSaveRequestId(400)).toBe(false);
  });

  it("preserves logical signature proportions when the display rotates", () => {
    const viewport = signatureCanvasViewport(
      { width: 500, height: 1_000 },
      { width: 1_000, height: 500 },
    );
    expect(viewport).toEqual({ scale: 0.5, offsetX: 0, offsetY: 375 });
    expect(signaturePointFromClient(
      250,
      500,
      { left: 0, top: 0, width: 500, height: 1_000 },
      { width: 1_000, height: 500 },
    )).toEqual({ x: 500, y: 250 });
    expect(signaturePointFromClient(
      250,
      100,
      { left: 0, top: 0, width: 500, height: 1_000 },
      { width: 1_000, height: 500 },
    )).toBeNull();
  });

  it("keeps real samples while removing only consecutive duplicates", () => {
    const existing = [{ x: 10, y: 20 }];
    expect(appendDistinctSignaturePoints(existing, [{ x: 10, y: 20 }])).toBe(existing);
    expect(appendDistinctSignaturePoints(existing, [
      { x: 10, y: 20 },
      { x: 11, y: 21 },
      { x: 11, y: 21 },
      { x: 12, y: 22 },
    ])).toEqual([
      { x: 10, y: 20 },
      { x: 11, y: 21 },
      { x: 12, y: 22 },
    ]);
  });

  it("keeps the browser capture lifecycle and retry protections wired", () => {
    const source = readFileSync(
      "src/app/(app)/signatures/[id]/capture/[memberId]/SignatureCapturePage.tsx",
      "utf8",
    );
    expect(source).toContain("window.requestAnimationFrame");
    expect(source).toContain("onLostPointerCapture");
    expect(source).toContain('document.addEventListener("visibilitychange"');
    expect(source).toContain('window.addEventListener("pagehide"');
    expect(source).toContain("appendPointerSamples(event.nativeEvent");
    expect(source).toContain("saveRequestIdRef.current ?? crypto.randomUUID()");
    expect(source).toContain("persistDraftSnapshot(snapshot, draftRevisionRef.current, requestId)");
    expect(source).toContain("shouldRetainSignatureSaveRequestId(response.status)");
    expect(source).toContain("persistDraftSnapshot(snapshot, draftRevisionRef.current, null)");
    expect(source).toContain("deleteSignatureDraftsForMember");
    expect(source).toContain("draft && draft.captureVersion === member?.captureVersion");
    expect(source).toContain("loadSignatureDraft(draftKey, Date.now()");
    expect(source).toContain("draft.captureVersion === member?.captureVersion");
    expect(source).toContain("if (!draftLoaded)");
    expect(source).toContain("draftLoaded && !saving");
    expect(source).toContain("strokesRef.current.length === 0 && (clearedStrokes || redoStack.length > 0)");
    expect(source).toContain("isCurrentDeviceIpad");
    expect(source).toContain("Capture can only be done on an iPad with an Apple Pencil.");
    expect(source).toContain("/api/signatures/collections/${collectionId}/members/${memberId}");
    expect(source).toContain("enabled: isIpad === true");
    expect(source).toContain("Couldn’t load this signer");
    expect(source).toContain(">Retry</Button>");
    expect(source).toContain("invalidateSignatureCollectionCaches");
    expect(source).toContain("setSaveSucceeded(true)");
    expect(source).toContain('window.matchMedia("(prefers-reduced-motion: reduce)")');
    expect(source).toContain("motion-safe:animate-in");
    expect(source).toContain("router.replace(`/signatures/${collection.id}`)");
    expect(source).toContain("if (committed)");
    expect(source).toContain("Signature saved. Return to the roster to continue.");
    expect(source).toContain("disabled={saveSucceeded || saving || drawing || strokes.length === 0}");
    expect(source).not.toContain("SignatureAthleteProfileForm");
    expect(source).not.toContain("/profile");
  });

  it("BUG: reads the nested capture bootstrap before checking collection state", () => {
    const source = readFileSync(
      "src/app/(app)/signatures/[id]/capture/[memberId]/SignatureCapturePage.tsx",
      "utf8",
    );

    expect(source).toContain("type CaptureBootstrap = { collection: Collection; member: Member };");
    expect(source).toContain("useFetch<CaptureBootstrap>");
    expect(source).toContain("const collection = bootstrap?.collection ?? null;");
    expect(source).toContain("const member = bootstrap?.member ?? null;");
    expect(source).not.toContain("const member = collection?.member ?? null;");
  });
});

describe("UWBadgers signature roster adapter", () => {
  const html = [
    "<h1>2025-26 Men's Basketball Roster</h1>",
    "<section><h2>Players</h2>",
    "<a href=\"/sports/mens-basketball/roster/alpha-player/100\">Jersey Number 4</a>",
    "<a href=\"/sports/mens-basketball/roster/alpha-player/100\">Alpha Player</a>",
    "<div>Position G Academic Year Jr. Height 6' 4'' Hometown Madison, Wis. Last School Madison East</div>",
    "<a href=\"/sports/mens-basketball/roster/alpha-player/100\">Alpha Player</a>",
    "<a href=\"/sports/mens-basketball/roster/beta-player/101\">Jersey Number 22</a>",
    "<a href=\"/sports/mens-basketball/roster/beta-player/101\">Beta Player</a>",
    "</section>",
    "<h2>Coaching Staff</h2>",
    "<a href=\"/sports/mens-basketball/roster/coaches/head-coach/200\">Greg Coach</a><span>Head Coach</span>",
    "<h2>Support Staff</h2>",
    "<a href=\"https://www.uwbadgers.com/sports/mens-basketball/roster/staff/support/300\">Sam Support</a><span>General Manager</span>",
    "<a href=\"/sports/mens-basketball/roster/alpha-player/100\">Alpha Player</a>",
  ].join("");

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function rosterResponse(): Response {
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  it("builds the supported 2026-27 UWBadgers source URLs and validates the host", () => {
    expect(buildUWBadgersRosterUrl("MBB", "2025-26")).toBe("https://uwbadgers.com/sports/mens-basketball/roster/2025-26");
    expect(buildUWBadgersRosterUrl("FB", "2026-27")).toBe("https://uwbadgers.com/sports/football/roster/2026");
    expect(buildUWBadgersRosterUrl("VB", "2026-27")).toBe("https://uwbadgers.com/sports/womens-volleyball/roster/2026");
    expect(buildUWBadgersRosterUrl("MHKY", "2026-27")).toBe("https://uwbadgers.com/sports/mens-ice-hockey/roster/2026-27");
    expect(buildUWBadgersRosterUrl("WHKY", "2026-27")).toBe("https://uwbadgers.com/sports/womens-ice-hockey/roster/2026-27");
    expect(buildUWBadgersRosterUrl("WBB", "2026-27")).toBe("https://uwbadgers.com/sports/womens-basketball/roster/2026-27");
    expect(buildUWBadgersRosterUrl("WRES", "2026-27")).toBe("https://uwbadgers.com/sports/wrestling/roster/2026-27");
    expect(buildUWBadgersRosterUrl("ADMIN", "2026-27")).toBe("https://uwbadgers.com/staff-directory/administration-department/1");
    expect(SIGNATURE_IMPORTED_SPORT_CODES).toEqual(["MBB", "FB", "VB", "MHKY", "WHKY", "WBB", "WRES", "ADMIN"]);
    expect(() => buildUWBadgersRosterUrl("CREATIVE", "2026-27")).toThrow();
    expect(isAllowedUWBadgersUrl("https://www.uwbadgers.com/sports/mens-basketball/roster/2025-26")).toBe(true);
    expect(isAllowedUWBadgersUrl("https://example.com/roster")).toBe(false);
  });

  it("uses the official 2026-27 Men's Hockey fact-book seed without a network request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const snapshot = await fetchUWBadgersRoster("MHKY", "2026-27");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(snapshot).toMatchObject({
      sourceKey: "UW_BADGERS_MHKY_FACT_BOOK",
      sourceUrl: "https://uwbadgers.com/sports/mens-ice-hockey/roster/2026-27",
      parserVersion: "uwbadgers-mhky-factbook-2026-27-v1",
    });
    expect(snapshot.entries).toHaveLength(26);
    expect(snapshot.entries.map(({ jerseyNumber, name, title }) => ({ jerseyNumber, name, title }))).toEqual([
      { jerseyNumber: 2, name: "Luke Osburn", title: "Defenseman • Sophomore" },
      { jerseyNumber: 3, name: "Brent Solomon", title: "Forward • Freshman" },
      { jerseyNumber: 4, name: "Dylan Compton", title: "Defenseman • Sophomore" },
      { jerseyNumber: 5, name: "Zach Schulz", title: "Defenseman • Senior" },
      { jerseyNumber: 6, name: "Logan Hensler", title: "Defenseman • Junior" },
      { jerseyNumber: 7, name: "Gavin Morrissey", title: "Forward • Junior" },
      { jerseyNumber: 8, name: "Jack Phelan", title: "Defenseman • Junior" },
      { jerseyNumber: 9, name: "Chase Jette", title: "Forward • Freshman" },
      { jerseyNumber: 12, name: "Gavin Uhlenkamp", title: "Forward • Freshman" },
      { jerseyNumber: 14, name: "Joe Palodichuk", title: "Defenseman • Senior" },
      { jerseyNumber: 17, name: "Grady Deering", title: "Forward • Sophomore" },
      { jerseyNumber: 18, name: "Adam Pietila", title: "Forward • Junior" },
      { jerseyNumber: 19, name: "Zach Wooten", title: "Forward • Freshman" },
      { jerseyNumber: 21, name: "Ryan Botterill", title: "Forward • Junior" },
      { jerseyNumber: 23, name: "John Stout", title: "Defenseman • Freshman" },
      { jerseyNumber: 24, name: "Talan Blanck", title: "Forward • Freshman" },
      { jerseyNumber: 26, name: "Weston Knox", title: "Defenseman • Junior" },
      { jerseyNumber: 27, name: "Finn Brink", title: "Forward • Sophomore" },
      { jerseyNumber: 30, name: "Alexis Cournoyer", title: "Goaltender • Sophomore" },
      { jerseyNumber: 31, name: "Daniel Hauser", title: "Goaltender • Sophomore" },
      { jerseyNumber: 35, name: "Xander Miceli", title: "Goaltender • Freshman" },
      { jerseyNumber: 55, name: "Oliver Tulk", title: "Forward • Sophomore" },
      { jerseyNumber: 57, name: "Eetu Orpana", title: "Forward • Freshman" },
      { jerseyNumber: 86, name: "JJ Wiebusch", title: "Forward • Junior" },
      { jerseyNumber: 91, name: "Bruno Idžan", title: "Forward • Sophomore" },
      { jerseyNumber: 94, name: "Vasily Zelenov", title: "Forward • Sophomore" },
    ]);
    expect(snapshot.entries.find((entry) => entry.name === "Bruno Idžan")?.normalizedName).toBe("bruno idžan");
    expect(snapshot.entries.find((entry) => entry.name === "Eetu Orpana")?.hometown).toBe("Lempäälä, Finland");
    expect(snapshot.sourceHash).toBe(normalizedRosterHash(snapshot.entries, snapshot.parserVersion));
  });

  it("fetches a roster directly with manual redirect handling", async () => {
    const fetchMock = vi.fn().mockResolvedValue(rosterResponse());
    vi.stubGlobal("fetch", fetchMock);

    const snapshot = await fetchUWBadgersRoster("MBB", "2025-26");

    expect(snapshot.entries).toHaveLength(4);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://uwbadgers.com/sports/mens-basketball/roster/2025-26",
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("follows an approved host and same-roster-path redirect", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { Location: "https://www.uwbadgers.com/sports/mens-basketball/roster/2025-26/" },
      }))
      .mockResolvedValueOnce(rosterResponse());
    vi.stubGlobal("fetch", fetchMock);

    const snapshot = await fetchUWBadgersRoster("MBB", "2025-26");

    expect(snapshot.entries).toHaveLength(4);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://www.uwbadgers.com/sports/mens-basketball/roster/2025-26/");
  });

  it.each([
    ["missing Location", null],
    ["invalid Location", "http://[::1"],
    ["cross-host Location", "https://example.com/sports/mens-basketball/roster/2025-26"],
    ["internal Location", "https://127.0.0.1/sports/mens-basketball/roster/2025-26"],
    ["out-of-boundary path", "https://uwbadgers.com/internal/roster"],
  ])("rejects a %s without issuing a second request", async (_label, location) => {
    const headers = location === null ? undefined : { Location: location };
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchUWBadgersRoster("MBB", "2025-26")).rejects.toThrow(/redirect/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("detects a redirect loop before repeating a request", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { Location: "/sports/mens-basketball/roster/2025-26/" },
      }))
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { Location: "/sports/mens-basketball/roster/2025-26" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchUWBadgersRoster("MBB", "2025-26")).rejects.toThrow("redirect loop");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops after five approved redirects without issuing a seventh request", async () => {
    const fetchMock = vi.fn(async (request: string | URL | Request) => {
      const current = new URL(String(request));
      const step = Number(current.searchParams.get("redirect") ?? 0) + 1;
      return new Response(null, {
        status: 302,
        headers: { Location: `${current.pathname}?redirect=${step}` },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchUWBadgersRoster("MBB", "2025-26")).rejects.toThrow("redirect limit");
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("deduplicates repeated card/table links by profile identity and preserves source order and role groups", () => {
    const entries = parseUWBadgersRosterHtml(html);
    expect(entries).toHaveLength(4);
    expect(entries.map((entry) => entry.name)).toEqual(["Alpha Player", "Beta Player", "Greg Coach", "Sam Support"]);
    expect(entries.find((entry) => entry.sourceExternalId === "100")?.jerseyNumber).toBe(4);
    expect(entries.find((entry) => entry.sourceExternalId === "100")?.title).toBe("Guard • Junior");
    expect(entries.find((entry) => entry.sourceExternalId === "100")?.hometown).toBe("Madison, Wis.");
    expect(entries.find((entry) => entry.sourceExternalId === "200")?.roleGroup).toBe("COACHING_STAFF");
    expect(entries.find((entry) => entry.sourceExternalId === "300")?.roleGroup).toBe("SUPPORT_STAFF");
    expect(normalizedRosterHash(entries)).toBe(normalizedRosterHash([...entries]));
  });

  it("parses the fixed Administration staff-directory source as required support staff", () => {
    const entries = parseUWBadgersRosterHtml([
      "<a href=\"/staff-directory/administration-department/1\">Administration</a>",
      "<a href=\"/staff-directory/shawn-eichorst/1325\">Shawn Eichorst</a><div class=\"s-person-details__position\">Director of Athletics</div>",
      "<a href=\"/staff-directory/shawn-eichorst/1325\">Shawn Eichorst</a>",
      "<a href=\"/staff-directory/marcus-sedberry/831\">Marcus Sedberry</a><div class=\"s-person-details__position\">Deputy Athletic Director/Chief Operating Officer</div>",
    ].join(""), "ADMIN");

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.name)).toEqual(["Shawn Eichorst", "Marcus Sedberry"]);
    expect(entries.every((entry) => entry.roleGroup === "SUPPORT_STAFF")).toBe(true);
    expect(entries.find((entry) => entry.sourceExternalId === "1325")).toMatchObject({
      title: "Director of Athletics",
      sourceProfileUrl: "https://uwbadgers.com/staff-directory/shawn-eichorst/1325",
    });
  });

  it("requires student-athletes while treating team staff as optional by default", () => {
    expect(isRequiredSignatureGroup("PLAYER")).toBe(true);
    expect(isRequiredSignatureGroup("COACHING_STAFF")).toBe(false);
    expect(isRequiredSignatureGroup("SUPPORT_STAFF")).toBe(false);
  });

  it("parses football and volleyball player metadata from the shared roster structure", () => {
    const footballEntries = parseUWBadgersRosterHtml([
      "<h1>2026 Football Roster</h1>",
      "<a href=\"/sports/football/roster/alpha-player/500\">Jersey Number 7</a>",
      "<a href=\"/sports/football/roster/alpha-player/500\">Alpha Player</a>",
      "<div>Position WR Academic Year R-Sr.Height 6' 2'' Hometown Austin, Texas Last School Vandergrift</div>",
    ].join(""), "FB");
    const volleyballEntries = parseUWBadgersRosterHtml([
      "<h1>2026 Volleyball Roster</h1>",
      "<a href=\"/sports/womens-volleyball/roster/beta-player/600\">Jersey Number 4</a>",
      "<a href=\"/sports/womens-volleyball/roster/beta-player/600\">Beta Player</a>",
      "<div>Position MB Academic Year Jr.Height 6' 2''</div>",
    ].join(""), "VB");

    expect(footballEntries).toHaveLength(1);
    expect(footballEntries[0]).toMatchObject({
      sourceExternalId: "500",
      name: "Alpha Player",
      jerseyNumber: 7,
      title: "Wide Receiver • Redshirt Senior",
      hometown: "Austin, Texas",
    });
    expect(volleyballEntries).toHaveLength(1);
    expect(volleyballEntries[0]).toMatchObject({
      sourceExternalId: "600",
      name: "Beta Player",
      jerseyNumber: 4,
      title: "Middle Blocker • Junior",
    });
  });

  it("parses hockey, women’s basketball, and wrestling-specific player metadata", () => {
    const mensHockeyEntries = parseUWBadgersRosterHtml([
      "<h1>2026-27 Men's Hockey Roster</h1>",
      "<a href=\"/sports/mens-ice-hockey/roster/goalie/700\">Luke Goalie</a>",
      "<div>Position G Academic Year So.Height 6' 1''</div>",
    ].join(""), "MHKY");
    const womensHockeyEntries = parseUWBadgersRosterHtml([
      "<h1>2026-27 Women's Hockey Roster</h1>",
      "<a href=\"/sports/womens-ice-hockey/roster/defender/701\">Ava Defender</a>",
      "<div>Position D Academic Year Jr.Height 5' 9''</div>",
    ].join(""), "WHKY");
    const womensBasketballEntries = parseUWBadgersRosterHtml([
      "<h1>2026-27 Women's Basketball Roster</h1>",
      "<a href=\"/sports/womens-basketball/roster/point-guard/702\">Giselle Guard</a>",
      "<div>Position PG Academic Year Fr.Height 5' 9''</div>",
    ].join(""), "WBB");
    const wrestlingEntries = parseUWBadgersRosterHtml([
      "<h1>2026 Wrestling Roster</h1>",
      "<a href=\"/sports/wrestling/roster/wrestler/703\">Elliott Wrestler</a>",
      "<div>Position 149 Academic Year R-So.Height 5' 9''</div>",
    ].join(""), "WRES");

    expect(mensHockeyEntries[0]).toMatchObject({ title: "Goaltender • Sophomore" });
    expect(womensHockeyEntries[0]).toMatchObject({ title: "Defenseman • Junior" });
    expect(womensBasketballEntries[0]).toMatchObject({ title: "Point Guard • Freshman" });
    expect(wrestlingEntries[0]).toMatchObject({ jerseyNumber: null, title: "149 • Redshirt Sophomore" });
  });

  it("decodes HTML entities before reading jersey numbers and labels football safeties", () => {
    const entries = parseUWBadgersRosterHtml([
      "<h1>2026 Football Roster</h1>",
      "<a href=\"/sports/football/roster/danny-oneil/501\" aria-label=\"Danny O&#39;Neil jersey number 18 full bio\">Jersey Number 18</a>",
      "<a href=\"/sports/football/roster/danny-oneil/501\">Danny O&#39;Neil</a>",
      "<div>Position S Academic Year Fr.</div>",
    ].join(""), "FB");

    expect(entries[0]).toMatchObject({
      name: "Danny O'Neil",
      jerseyNumber: 18,
      title: "Safety • Freshman",
    });
  });
});

describe("signature roster presentation", () => {
  it("sorts players by jersey number and staff by source roster order", () => {
    const members = [
      { name: "Greg Stiemsma", jerseyNumber: null, roleGroup: "COACHING_STAFF" as const, sourceOrder: 2 },
      { name: "Austin Rapp", jerseyNumber: 22, roleGroup: "PLAYER" as const },
      { name: "Brad Davison", jerseyNumber: null, roleGroup: "COACHING_STAFF" as const, sourceOrder: 1 },
      { name: "Jack Janicki", jerseyNumber: 4, roleGroup: "PLAYER" as const },
      { name: "Isaac Riddle", jerseyNumber: 11, roleGroup: "PLAYER" as const },
      { name: "Lance Randall", jerseyNumber: null, roleGroup: "COACHING_STAFF" as const, sourceOrder: 3 },
      { name: "Erik Role", jerseyNumber: null, roleGroup: "CREATIVE_STAFF" as const },
      { name: "Alex Creative", jerseyNumber: null, roleGroup: "CREATIVE_STAFF" as const },
    ];
    const sorted = [...members].sort(compareSignatureRosterMembers);

    expect(sorted.filter((member) => member.roleGroup === "PLAYER").map((member) => member.jerseyNumber)).toEqual([4, 11, 22]);
    expect(sorted.filter((member) => member.roleGroup === "COACHING_STAFF").map((member) => member.name)).toEqual(["Brad Davison", "Greg Stiemsma", "Lance Randall"]);
    expect(sorted.filter((member) => member.roleGroup === "CREATIVE_STAFF").map((member) => member.name)).toEqual(["Alex Creative", "Erik Role"]);
  });

  it("requires a collection version for archive, restore, and delete mutations", () => {
    expect(() => signatureCollectionVersionSchema.parse({})).toThrow();
    expect(() => signatureCollectionVersionSchema.parse({ expectedCollectionVersion: 0 })).toThrow();
    expect(signatureCollectionVersionSchema.parse({ expectedCollectionVersion: 3 })).toEqual({ expectedCollectionVersion: 3 });
  });

  it("validates ad-hoc signer identity and category at the API boundary", () => {
    expect(signatureAdHocMemberSchema.parse({ season: "2026-27", name: "  Bucky Badger ", category: " Alumni " })).toEqual({
      season: "2026-27",
      name: "Bucky Badger",
      category: "Alumni",
    });
    expect(() => signatureAdHocMemberSchema.parse({ season: "2026", name: "", category: "" })).toThrow();
  });

  it("keeps optional roster hometown metadata backward compatible", () => {
    expect(signatureRosterEntrySchema.parse({
      sourceExternalId: "100",
      sourceProfileUrl: "https://uwbadgers.com/sports/mens-basketball/roster/alpha-player/100",
      name: "Alpha Player",
      normalizedName: "alpha player",
      jerseyNumber: 4,
      roleGroup: "PLAYER",
      title: "Guard • Junior",
    }).hometown).toBeUndefined();
  });

  it("keeps roster rows uniform and aligns the signature rail without hiding team positions", () => {
    const source = readFileSync(
      "src/app/(app)/signatures/[id]/SignatureCollectionPage.tsx",
      "utf8",
    );
    expect(source).toContain("grid h-16 grid-cols-");
    expect(source).toContain('<span className="text-center">Signature</span>');
    expect(source).toContain('className="flex items-center justify-center"');
    expect(source).toContain('fontFamily: "var(--font-jersey)", fontWeight: 400');
    expect(source).toContain("bg-[var(--green-bg)]");
    expect(source).toContain("<CheckCircle2");
    expect(source).toContain("Signature complete");
    expect(source).toContain('className="h-auto max-h-8 w-auto max-w-28 object-contain brightness-0 dark:invert"');
    expect(source).toContain('className="h-11 w-40"');
    expect(source).toContain('text-2xl leading-none tracking-[0.06em] tabular-nums');
    expect(source).toContain("!isCreativeStaffRoster && <span");
    expect(source).toContain("member.title || roleLabel(member.roleGroup)");
    expect(source).toContain('title={member.title || roleLabel(member.roleGroup)}');
    expect(source).toContain('primaryCapture={member.roleGroup === "PLAYER" || member.roleGroup === "CREATIVE_STAFF" || isAdministrationRoster}');
    expect(source).toContain('variant={primaryCapture ? "brand" : "outline"}');
    expect(source).not.toContain('<span>Requirement</span>');
    expect(source).not.toContain('<span>Status</span>');
    expect(source).not.toContain("Collection readiness");
    expect(source).not.toContain(">Optional</Badge>");
    expect(source).toContain('data-icon="inline-start" />Capture</Link>');
    expect(source).not.toContain('>Needs signature<');
    expect(source).toContain('aria-label={`Quick Look ${member.name}\'s signature`}');
    expect(source).toContain('style={{ fontFamily: "var(--font-heading)", fontWeight: 800 }}');
    expect(source).toContain("useBreadcrumbLabel");
    expect(source).toContain('member.roleGroup !== "PLAYER"');
    expect(source).toContain("<CollapsibleContent>");
    expect(source).toContain('aria-label={`${sectionOpen ? "Collapse" : "Expand"} ${meta.label}`}');
    expect(source).toContain('triggerClassName="size-11"');
    expect(source).toContain("Danger zone");
    expect(source).toContain("Creative Staff is syncing automatically");
    expect(source).toContain('const canRemoveFromRoster = collection.status === "OPEN" && member.roleGroup === "PLAYER";');
    expect(source).toContain('"DELETE", { expectedCollectionVersion: collection.collectionVersion }');
    expect(source).toContain("Remove from roster");
    expect(source).toContain("Their saved signature history will be kept.");
    expect(source).toContain("A future roster import may add this player again.");
    expect(source).toContain("Capture on iPad");
    expect(source).toContain("Capture can only be done on an iPad with an Apple Pencil.");
    expect(source).toContain("disabled");
    expect(source).not.toContain("SignatureAthleteProfileForm");
    expect(source).not.toContain("Profile needed");
    expect(source).not.toContain("Edit athlete profile");
    expect(source).not.toContain("/profile");
    expect(source).not.toContain("syncCreativeStaff");
    expect(source).toContain("<AlertDialogTitle>Reset every captured signature?</AlertDialogTitle>");
    expect(source).toContain("/png?download=1");
    expect(source).toContain("/svg?download=1");
  });

  it("uses automatic Creative Staff reconciliation and the final annotated roster copy", () => {
    const landingSource = readFileSync("src/app/(app)/signatures/SignatureCollectionsPage.tsx", "utf8");
    const detailSource = readFileSync("src/app/(app)/signatures/[id]/SignatureCollectionPage.tsx", "utf8");
    const collectionRouteSource = readFileSync("src/app/api/signatures/collections/route.ts", "utf8");

    expect(Object.values(SIGNATURE_SPORT_REGISTRY).map((definition) => definition.label)).toEqual([
      "Men’s Basketball",
      "Football",
      "Volleyball",
      "Men’s Hockey",
      "Women’s Hockey",
      "Women’s Basketball",
      "Wrestling",
      "Creative Staff",
      "Administration",
      "Ad-hoc signatures",
    ]);
    expect(signatureCollectionTitle("MBB")).toBe("Men’s Basketball");
    expect(signatureCollectionTitle("CREATIVE")).toBe("Creative Staff");
    expect(signatureCollectionTitle("UNKNOWN")).toBe("UNKNOWN");
    expect(SIGNATURE_SPORT_REGISTRY.FB.source).toMatchObject({
      sourceKey: "UW_BADGERS_FB",
      rosterPath: "/sports/football/roster",
      usesStartYearPath: true,
    });
    expect(landingSource).toContain("signatureCollectionTitle(collection.sportCode)");
    expect(landingSource).toContain("signatureCollectionTitle(importSportCode)");
    expect(landingSource).not.toContain("function collectionLabel");
    expect(landingSource).toContain('id="signature-import-sport"');
    expect(landingSource).toContain('sportCode: importSportCode');
    expect(landingSource).toContain('"Automatically synced"');
    expect(landingSource).not.toContain("Sync staff");
    expect(detailSource).toContain("signatureCollectionTitle(collection.sportCode)");
    expect(detailSource).not.toContain("function collectionTitle");
    expect(detailSource).toContain('PLAYER: { label: "Student-Athletes"');
    expect(detailSource).toContain('COACHING_STAFF: { label: "Coaching Staff"');
    expect(detailSource).toContain('SUPPORT_STAFF: { label: "Support Staff"');
    expect(detailSource).not.toContain("Edit athlete profile");
    expect(detailSource).not.toContain("Profile needed");
    expect(detailSource).not.toContain("SignatureAthleteProfileForm");
    expect(detailSource).not.toContain("/profile");
    expect(detailSource).toContain('className="h-11 sm:min-w-40"');
    expect(landingSource).toContain("automaticSyncAttempt");
    expect(landingSource).toContain("/creative-staff");
    expect(landingSource).toContain("Download All");
    expect(landingSource).toContain("PNG files");
    expect(landingSource).toContain("SVG files");
    expect(landingSource).toContain("downloadableCount");
    expect(landingSource).toContain("/download");
    expect(landingSource).toContain('method: "DELETE"');
    expect(landingSource).toContain("Delete this signature roster?");
    expect(collectionRouteSource).not.toContain("syncSignatureCreativeStaff");
  });

  it("uses the licensed Wisconsin face only for jersey numbers", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    const font = readFileSync("public/Wisconsin-Regular.ttf");

    expect(css).toContain('font-family: "Wisconsin"');
    expect(css).toContain('url("/Wisconsin-Regular.ttf") format("truetype")');
    expect(css).toContain('--font-jersey: "Wisconsin"');
    expect(font.byteLength).toBe(25_004);
    expect(createHash("sha256").update(font).digest("hex")).toBe("37aa1f33c6e005870944890186950fa4b93eaf522eba3e563267fd47b9d8e27a");
  });

  it("uses the official RGB red for web brand actions in both themes", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css.match(/--wi-red: #c80000;/g)).toHaveLength(2);
  });
});

describe("signature artifact contract", () => {
  const strokes = [
    { points: [{ x: 40, y: 50 }, { x: 80, y: 70 }, { x: 120, y: 45 }] },
    { points: [{ x: 130, y: 90 }, { x: 160, y: 100 }] },
  ];

  it("renders identical transparent PNG/SVG artifacts for identical input", async () => {
    const first = await renderSignatureArtifacts(strokes, DEFAULT_SIGNATURE_PEN_SETTINGS);
    const second = await renderSignatureArtifacts(strokes, DEFAULT_SIGNATURE_PEN_SETTINGS);
    expect(first.svg).toBe(second.svg);
    expect(first.svgHash).toBe(second.svgHash);
    expect(first.pngHash).toBe(second.pngHash);
    expect(first.width).toBeGreaterThan(0);
    expect(first.height).toBeGreaterThan(0);
    expect(first.svg).not.toMatch(/script|foreignObject|html|href=/i);
    expect(first.svg).toMatch(/<path d=/);
    expect(first.svg).not.toMatch(/<image|data:|<canvas/i);
    const metadata = await sharp(first.png).metadata();
    const stats = await sharp(first.png).stats();
    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(first.width);
    expect(metadata.height).toBe(first.height);
    expect(metadata.width).toBeGreaterThanOrEqual(SIGNATURE_PNG_MIN_WIDTH);
    expect(metadata.hasAlpha).toBe(true);
    expect(metadata.channels).toBe(4);
    expect(stats.isOpaque).toBe(false);
    expect(stats.channels[3]?.min).toBe(0);
  });

  it("renders a visible dot for a one-point Pencil stroke", async () => {
    const artifact = await renderSignatureArtifacts([{ points: [{ x: 40, y: 50 }] }], DEFAULT_SIGNATURE_PEN_SETTINGS);
    expect(artifact.svg).toMatch(/M [^ ]+ [^ ]+ L [^ ]+ [^ ]+/);
    const metadata = await sharp(artifact.png).metadata();
    expect(metadata.hasAlpha).toBe(true);
  });

  it("removes a tiny isolated stroke while retaining the substantive signature", async () => {
    const artifact = await renderSignatureArtifacts([
      { points: [{ x: 100, y: 100 }, { x: 300, y: 120 }] },
      { points: [{ x: 1_200, y: 800 }] },
    ], DEFAULT_SIGNATURE_PEN_SETTINGS);

    expect(artifact.svg.match(/<path d=/g)).toHaveLength(1);
    expect(artifact.cropBounds.x).toBeLessThan(100);
  });

  it("retains a short mark that sits next to the substantive signature", async () => {
    const artifact = await renderSignatureArtifacts([
      { points: [{ x: 100, y: 100 }, { x: 300, y: 120 }] },
      { points: [{ x: 320, y: 112 }] },
    ], DEFAULT_SIGNATURE_PEN_SETTINGS);

    expect(artifact.svg.match(/<path d=/g)).toHaveLength(2);
  });

  it("exports one line weight whether the signer signs small or large", () => {
    const shape = [{ x: 0, y: 0 }, { x: 0.5, y: 0.34 }, { x: 1, y: 0.1 }];
    const scaled = (size: number) => [{
      points: shape.map((point) => ({ x: 100 + point.x * size, y: 100 + point.y * size })),
    }];
    const exportedWeight = (source: ReturnType<typeof buildSignatureSvg>) =>
      source.strokeWidth * Math.min(1_600 / source.width, 900 / source.height);

    const small = buildSignatureSvg(scaled(300), DEFAULT_SIGNATURE_PEN_SETTINGS);
    const large = buildSignatureSvg(scaled(900), DEFAULT_SIGNATURE_PEN_SETTINGS);

    // The rendered width tracks the crop so the delivered artifacts match.
    expect(large.strokeWidth).toBeGreaterThan(small.strokeWidth);
    expect(exportedWeight(large)).toBeCloseTo(exportedWeight(small), 1);
    // A fixed canvas width would have exported the small signature far heavier.
    const fixedWidth = DEFAULT_SIGNATURE_PEN_SETTINGS.strokeWidth;
    expect(fixedWidth * Math.min(1_600 / small.width, 900 / small.height))
      .toBeGreaterThan(fixedWidth * Math.min(1_600 / large.width, 900 / large.height) * 2);
  });

  it("clamps normalization so a degenerate crop stays visible", () => {
    const dot = buildSignatureSvg([{ points: [{ x: 40, y: 50 }] }], DEFAULT_SIGNATURE_PEN_SETTINGS);
    expect(dot.strokeWidth).toBe(
      Number((DEFAULT_SIGNATURE_PEN_SETTINGS.strokeWidth * SIGNATURE_STROKE_SCALE_MIN).toFixed(3)),
    );
    expect(resolveSignatureStrokeWidth({ width: 640, height: 256 }, DEFAULT_SIGNATURE_PEN_SETTINGS))
      .toBe(DEFAULT_SIGNATURE_PEN_SETTINGS.strokeWidth);
  });

  it("predicts the delivered export size that sharp actually renders", async () => {
    const artifact = await renderSignatureArtifacts(strokes, DEFAULT_SIGNATURE_PEN_SETTINGS);
    const predicted = resolveSignatureExportSize(artifact.cropBounds, DEFAULT_SIGNATURE_PEN_SETTINGS);

    expect(predicted.width).toBe(artifact.width);
    expect(predicted.height).toBe(artifact.height);
  });

  it("uses midpoint quadratic curves for multi-point strokes", () => {
    const points = [{ x: 40, y: 50 }, { x: 80, y: 70 }, { x: 120, y: 45 }];
    const curve = buildSignatureCurve(points);

    expect(curve.segments).toEqual([
      { type: "Q", control: points[1], to: { x: 100, y: 57.5 } },
      { type: "Q", control: points[2], to: points[2] },
    ]);
    expect(signaturePathData({ points }, { x: 0, y: 0, width: 200, height: 200 })).toContain("Q 80 70 100 57.5");
  });

  it("rejects unbounded client stroke payloads", () => {
    expect(() => captureSaveRequestSchema.parse({ requestId: "short", expectedCaptureVersion: 0, settingsVersion: 1, strokes })).toThrow();
    expect(() => captureSaveRequestSchema.parse({ requestId: "request-123456789012", expectedCaptureVersion: 0, settingsVersion: 1, strokes: [{ points: [{ x: -1, y: 4 }] }] })).toThrow();
  });

  it("accepts deliberate printed and slow Pencil signatures within the total byte ceiling", () => {
    const request = (boundedStrokes: Array<{ points: Array<{ x: number; y: number }> }>) => ({
      requestId: "request-123456789012",
      expectedCaptureVersion: 0,
      settingsVersion: 1,
      strokes: boundedStrokes,
    });
    const point = { x: 10, y: 20 };

    expect(captureSaveRequestSchema.safeParse(request(
      Array.from({ length: 33 }, () => ({ points: [point] })),
    )).success).toBe(true);
    expect(captureSaveRequestSchema.safeParse(request([
      { points: Array.from({ length: 2_001 }, () => point) },
    ])).success).toBe(true);
    expect(captureSaveRequestSchema.safeParse(request(
      Array.from({ length: SIGNATURE_MAX_STROKES + 1 }, () => ({ points: [point] })),
    )).error?.issues[0]?.message).toBe("This signature has too many separate pen strokes");
    expect(captureSaveRequestSchema.safeParse(request([
      { points: Array.from({ length: SIGNATURE_MAX_POINTS_PER_STROKE + 1 }, () => point) },
    ])).error?.issues[0]?.message).toBe("One continuous pen stroke is too long; lift the Pencil and continue");
  });
});

describe("signature artifact importer contract", () => {
  it("supports exact one-off team staff imports without switching to player coverage", () => {
    const source = readFileSync("scripts/backfill-signature-artifacts.ts", "utf8");
    expect(source).toContain("const isTeamStaffImport = !isStandaloneStaffImport && Boolean(memberName);");
    expect(source).toContain("assertTeamStaffSourceCoverage");
    expect(source).toContain("assertTeamStaffCoverage");
    expect(source).not.toContain("--member-name is only supported with --sport CREATIVE or --sport ADMIN.");
  });
});

describe("signature permissions", () => {
  it("keeps student and collaborator access closed while staff can capture", () => {
    expect(getAllowedRoles("signature", "capture")).toEqual(["ADMIN", "STAFF"]);
    expect(getAllowedRoles("signature", "settings")).toEqual(["ADMIN"]);
    expect(getAllowedRoles("signature", "delete")).toEqual(["ADMIN"]);
    expect(getAllowedRoles("signature", "download")).not.toContain("STUDENT");
    expect(getAllowedRoles("signature", "download")).not.toContain("COLLABORATOR");
    expect(() => getAllowedRoles("signature", "profile")).toThrow("No permission defined for signature.profile");
  });
});
