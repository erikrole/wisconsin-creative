import { describe, expect, it } from "vitest";
import {
  canClaimShiftArea,
  claimableShiftAreas,
} from "@/lib/shift-claim-eligibility";

describe("shift claim area eligibility", () => {
  it("limits ordinary areas to the worker's primary area", () => {
    expect(claimableShiftAreas("VIDEO")).toEqual(["VIDEO"]);
    expect(canClaimShiftArea("VIDEO", "VIDEO")).toBe(true);
    expect(canClaimShiftArea("VIDEO", "SOCIAL")).toBe(false);
  });

  it("treats Photo and Graphics as the sole symmetric cross-area exception", () => {
    expect(claimableShiftAreas("PHOTO")).toEqual(["PHOTO", "GRAPHICS"]);
    expect(claimableShiftAreas("GRAPHICS")).toEqual(["PHOTO", "GRAPHICS"]);
    expect(canClaimShiftArea("PHOTO", "GRAPHICS")).toBe(true);
    expect(canClaimShiftArea("GRAPHICS", "PHOTO")).toBe(true);
    expect(canClaimShiftArea("PHOTO", "VIDEO")).toBe(false);
  });

  it("fails closed without a primary area", () => {
    expect(claimableShiftAreas(null)).toEqual([]);
    expect(canClaimShiftArea(null, "PHOTO")).toBe(false);
  });
});
