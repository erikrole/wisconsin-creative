import { describe, expect, it } from "vitest";
import { guideSearchTypeLabel, mapGuideSearchResult } from "@/lib/guide-search-result";

describe("mapGuideSearchResult", () => {
  it("maps a published guide to a Resources reader destination", () => {
    expect(mapGuideSearchResult({
      id: "guide-1",
      title: "Photo Mechanic",
      slug: "photo-mechanic",
      type: "HOW_TO",
      summary: "Ingest, tag, and export game photos.",
      published: true,
      searchText: "ingest tag export",
    })).toEqual({
      type: "guide",
      id: "guide-1",
      title: "Photo Mechanic",
      subtitle: "How-to · Ingest, tag, and export game photos.",
      href: "/resources/photo-mechanic",
      status: undefined,
      searchText: "ingest tag export",
    });
  });

  it("marks unpublished guides as drafts without dropping the purpose line", () => {
    expect(mapGuideSearchResult({
      id: "guide-2",
      title: "Studio SOP",
      slug: "studio-sop",
      type: "SOP",
      summary: "Open and close the studio.",
      published: false,
    })).toMatchObject({
      href: "/resources/studio-sop",
      status: "DRAFT",
      subtitle: "SOP · Open and close the studio.",
      searchText: "",
    });
  });

  it("skips hits that cannot open a reader", () => {
    expect(mapGuideSearchResult({
      id: "guide-3",
      title: "Missing slug",
      type: "GENERAL",
    })).toBeNull();
  });
});

describe("guideSearchTypeLabel", () => {
  it("uses product language for known guide types", () => {
    expect(guideSearchTypeLabel("HOW_TO")).toBe("How-to");
    expect(guideSearchTypeLabel("MEDIA_DRIVE")).toBe("Media Drive");
  });
});
