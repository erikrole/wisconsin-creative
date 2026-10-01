import { describe, expect, it } from "vitest";
import { matchResumeFile, type ResumeMatchTarget } from "@/lib/hiring/resume-match";

// Fictional applicants.
const targets: ResumeMatchTarget[] = [
  { id: "a1", name: "Alex Sample", externalApplicationId: "900001" },
  { id: "a2", name: "Jordan Fictional", externalApplicationId: "900002" },
  { id: "a3", name: "Sam Twin", externalApplicationId: null },
  { id: "a4", name: "Sam Twin", externalApplicationId: null },
  { id: "a5", name: "Renée O'Brien", externalApplicationId: null },
];

describe("matchResumeFile", () => {
  it("matches an exact name filename", () => {
    expect(matchResumeFile("Alex Sample.pdf", targets)).toEqual({ status: "matched", applicationId: "a1", via: "name" });
  });

  it("ignores filler words, case, and punctuation", () => {
    expect(matchResumeFile("jordan_fictional - Resume (final).PDF", targets)).toEqual({ status: "matched", applicationId: "a2", via: "name" });
    expect(matchResumeFile("Renee O Brien CV.pdf", targets)).toEqual({ status: "matched", applicationId: "a5", via: "name" });
  });

  it("prefers a PageUp application ID in the filename", () => {
    expect(matchResumeFile("900002_resume.pdf", targets)).toEqual({ status: "matched", applicationId: "a2", via: "application_id" });
  });

  it("matches a name embedded in a longer filename", () => {
    expect(matchResumeFile("Resume - Alex Sample - Fall 2026.pdf", targets)).toEqual({ status: "matched", applicationId: "a1", via: "name" });
  });

  it("reports two applicants with the same name as ambiguous, never guessing", () => {
    expect(matchResumeFile("Sam Twin.pdf", targets)).toEqual({ status: "ambiguous", candidates: ["a3", "a4"] });
  });

  it("does not match a single shared first name", () => {
    expect(matchResumeFile("Alex.pdf", targets)).toEqual({ status: "none" });
    expect(matchResumeFile("Alex Different.pdf", targets)).toEqual({ status: "none" });
  });

  it("returns none for generic filenames", () => {
    expect(matchResumeFile("resume.pdf", targets)).toEqual({ status: "none" });
    expect(matchResumeFile("12.pdf", targets)).toEqual({ status: "none" });
  });
});
