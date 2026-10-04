import { describe, expect, it } from "vitest";

import { blockingAdvisories, evaluate } from "../scripts/audit-gate.mjs";

const advisory = (name, severity, ghsa) => ({
  [name]: { via: [{ url: `https://github.com/advisories/${ghsa}`, severity, title: `${name} issue` }] },
});
const report = (...entries) => ({ vulnerabilities: Object.assign({}, ...entries) });
const exceptions = [{ id: "GHSA-aaaa", package: "braces", expires: "2026-11-15", reason: "dev only" }];

describe("audit gate", () => {
  it("passes when only moderate advisories or transitive echoes exist", () => {
    const r = report(advisory("vitest", "moderate", "GHSA-mmmm"), { micromatch: { via: ["braces"] } });
    expect(evaluate(r, exceptions, "2026-10-04").failures).toEqual([]);
  });

  it("fails on an unexcepted high or critical advisory", () => {
    const r = report(advisory("left-pad", "critical", "GHSA-cccc"));
    expect(evaluate(r, exceptions, "2026-10-04").failures).toHaveLength(1);
  });

  it("excuses a listed advisory until it expires, then fails", () => {
    const r = report(advisory("braces", "high", "GHSA-aaaa"));
    expect(evaluate(r, exceptions, "2026-11-15")).toEqual({ failures: [], excused: ["braces GHSA-aaaa (until 2026-11-15)"] });
    expect(evaluate(r, exceptions, "2026-11-16").failures[0]).toMatch(/expired/);
  });

  it("does not let an exception for one package excuse another", () => {
    const r = report(advisory("not-braces", "high", "GHSA-aaaa"));
    expect(evaluate(r, exceptions, "2026-10-04").failures).toHaveLength(1);
  });

  it("deduplicates an advisory reported through several entries", () => {
    const r = report(advisory("braces", "high", "GHSA-aaaa"), { other: { via: [{ url: "https://github.com/advisories/GHSA-aaaa", severity: "high", title: "x" }] } });
    expect(blockingAdvisories(r)).toHaveLength(1);
  });
});
