import { describe, expect, it } from "vitest";
import { applicantSourceLinks, parseAgentApplicants } from "@/lib/hiring/agent-import";
import { planImport } from "@/lib/hiring/import";

const batch = (applicants: unknown[]) => ({ version: 1, source: "pageup", requisitionId: "512089", applicants });
const person = {
  applicationId: "900001", name: "Alex Sample", email: "alex@example.edu",
  standing: "JUNIOR", graduation: "Spring 2028", primaryArea: "Photography",
  verifiedAreas: ["Photography"], relevantExperience: "Submitted portfolio contains event photography.",
  resumeUrl: "https://example.com/resume", applicationFormUrl: "https://example.com/application",
  portfolioUrl: "https://example.com/portfolio", missingMaterials: ["Cover letter"],
};

describe("agent applicant intake", () => {
  it("logs factual extraction with distinct source links and leaves decisions to people", () => {
    const result = parseAgentApplicants(batch([person]));
    expect(result.invalid).toEqual([]);
    expect(result.records[0]).toMatchObject({ externalApplicationId: "900001", primaryArea: "PHOTO", stage: "APPLIED", reviewed: false, interviewed: false, fieldsExperience: ["Photography"], gradYear: 2028 });
    expect(result.records[0]!.source).toMatchObject({ "Application Form": person.applicationFormUrl, "Resume File": person.resumeUrl, "Portfolio Link": person.portfolioUrl });
    expect(result.records[0]!.warnings).toContain("Materials unavailable: Cover letter");
  });

  it("rejects injected decision fields, missing IDs, and unsafe links per applicant without dropping valid people", () => {
    const result = parseAgentApplicants(batch([person, { ...person, stage: "HIRE" }, { ...person, applicationId: "" }, { ...person, resumeUrl: "javascript:alert(1)" }]));
    expect(result.records).toHaveLength(1);
    expect(result.invalid.map((r) => r.line)).toEqual([2, 3, 4]);
    expect(result.invalid[0]!.reason).toContain("stage");
    expect(result.invalid[1]!.reason).toContain("applicationId");
    expect(result.invalid[2]!.reason).toContain("resumeUrl");
  });

  it("keeps missing materials distinct from evidence of no experience", () => {
    const { records } = parseAgentApplicants(batch([{ applicationId: "900002", name: "Sam Sample", email: "sam@example.edu", missingMaterials: ["Resume", "Application form"] }]));
    expect(records[0]).toMatchObject({ stage: "APPLIED", reviewed: false, fieldsExperience: [], note: null });
  });

  it("makes repeated agent batches idempotent by PageUp Application ID", () => {
    const { records } = parseAgentApplicants(batch([person]));
    const plan = planImport(records, [], { applicantIds: new Set(), externalIds: new Set(["900001"]) });
    expect(plan[0]!.action).toBe("skip_existing");
  });

  it("exposes only recognized https material links", () => {
    expect(applicantSourceLinks({ "Resume File": "https://example.com/resume", "Application Form": "javascript:alert(1)", Unknown: "https://example.com/secret" })).toEqual([{ label: "PageUp resume", url: "https://example.com/resume" }]);
    expect(applicantSourceLinks(null)).toEqual([]);
  });
});
