import { createElement, useState } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useAdjustState, useSyncedDraft } from "@/hooks/use-synced-draft";

function Probe({ open, value }: { open: boolean; value: string }) {
  const [draft, setDraft] = useState("initial");
  useAdjustState([open, value], () => {
    if (open) setDraft(value);
  });
  const [synced] = useSyncedDraft(value, (source) => source.toUpperCase());
  return createElement("p", null, `${draft}|${synced}`);
}

describe("render-time state adjustment hooks", () => {
  it("adjusts on the first render, like the effect it replaces, without looping", () => {
    expect(renderToString(createElement(Probe, { open: true, value: "abc" }))).toContain("abc|ABC");
  });

  it("leaves state alone when the adjustment does not apply", () => {
    expect(renderToString(createElement(Probe, { open: false, value: "abc" }))).toContain("initial|ABC");
  });
});
