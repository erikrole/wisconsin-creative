import { describe, expect, it } from "vitest";
import {
  cycleLabel,
  findPossibleMatches,
  isHttpsUrl,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  parseTermLabel,
} from "@/lib/hiring/contract";
import { matchesFileSignature } from "@/lib/hiring/files";

describe("hiring normalizers", () => {
  it("strips Unicode directional marks and formatting from phone numbers", () => {
    expect(normalizePhone("‭(555) 010-0101‬")).toBe("5550100101");
    expect(normalizePhone("+1 555 010 0102")).toBe("+15550100102");
    expect(normalizePhone("n/a")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });

  it("parses term labels case-insensitively and rejects junk", () => {
    expect(parseTermLabel("Spring 2027")).toEqual({ term: "SPRING", year: 2027 });
    expect(parseTermLabel(" fall 2029 ")).toEqual({ term: "FALL", year: 2029 });
    expect(parseTermLabel("Autumn 2027")).toBeNull();
    expect(parseTermLabel("")).toBeNull();
    expect(cycleLabel("FALL", 2026)).toBe("Fall 2026");
  });

  it("normalizes emails and names", () => {
    expect(normalizeEmail("  Test.User@Example.EDU ")).toBe("test.user@example.edu");
    expect(normalizeName("  Renée  O'Brien ")).toBe("renee o brien");
  });

  it("accepts only https links", () => {
    expect(isHttpsUrl("https://example.com/portfolio")).toBe(true);
    expect(isHttpsUrl("http://example.com")).toBe(false);
    expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpsUrl("not a url")).toBe(false);
  });
});

describe("findPossibleMatches", () => {
  const existing = [
    { id: "a1", name: "Alex Sample", gradTerm: "SPRING" as const, gradYear: 2027, emails: ["alex@example.edu"] },
    { id: "a2", name: "Jordan Fictional", gradTerm: "FALL" as const, gradYear: 2029, emails: ["jordan@example.com"] },
  ];

  it("hard-matches on any known email, case-insensitively", () => {
    const result = findPossibleMatches({ name: "Someone Else", email: "ALEX@example.edu" }, existing);
    expect(result).toEqual([{ applicantId: "a1", name: "Alex Sample", reason: "email" }]);
  });

  it("soft-matches on the same name plus graduation term and year", () => {
    const result = findPossibleMatches(
      { name: "jordan  fictional", email: "jordan.new@example.edu", gradTerm: "FALL", gradYear: 2029 },
      existing,
    );
    expect(result).toEqual([{ applicantId: "a2", name: "Jordan Fictional", reason: "name_and_grad" }]);
  });

  it("does not match the same name with a different graduation", () => {
    const result = findPossibleMatches(
      { name: "Jordan Fictional", email: "other@example.edu", gradTerm: "SPRING", gradYear: 2030 },
      existing,
    );
    expect(result).toEqual([]);
  });

  it("recognizes a returning applicant by name when the old record was purged", () => {
    const tombstone = [{ id: "t1", name: "Taylor Tombstone", gradTerm: null, gradYear: null, emails: [], purged: true }];
    expect(findPossibleMatches({ name: "taylor  tombstone", email: "t@example.edu" }, tombstone)).toEqual([
      { applicantId: "t1", name: "Taylor Tombstone", reason: "previous_applicant" },
    ]);
    // A live record with the same name but no graduation info is not a match.
    expect(findPossibleMatches({ name: "Taylor Tombstone", email: "t@example.edu" }, [{ ...tombstone[0]!, purged: false }])).toEqual([]);
  });

  it("does not soft-match when graduation is unknown", () => {
    expect(findPossibleMatches({ name: "Jordan Fictional", email: "x@example.edu" }, existing)).toEqual([]);
  });
});

describe("applicant file signatures", () => {
  const bytes = (...values: number[]) => new Uint8Array(values);

  it("accepts real PDF, PNG, and JPEG headers", () => {
    expect(matchesFileSignature(bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31), "application/pdf")).toBe(true);
    expect(matchesFileSignature(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), "image/png")).toBe(true);
    expect(matchesFileSignature(bytes(0xff, 0xd8, 0xff, 0xe0), "image/jpeg")).toBe(true);
  });

  it("rejects HTML or script declared as a PDF", () => {
    const html = new TextEncoder().encode("<html><script>alert(1)</script>");
    expect(matchesFileSignature(html, "application/pdf")).toBe(false);
    expect(matchesFileSignature(html, "image/png")).toBe(false);
  });
});
