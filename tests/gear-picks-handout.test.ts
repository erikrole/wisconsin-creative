import { describe, expect, it } from "vitest";
import { GEAR_CATALOG } from "@/lib/gear-picks/catalog";
import { buildHandoutBoard, pieceKey } from "@/lib/gear-picks/handout";
import type { GearPickAdminParticipant, GearPickAdminStudent } from "@/lib/gear-picks/types";

const staff = (id: string, name: string, topSize: string | null): GearPickAdminParticipant => ({
  id,
  fit: "MEN",
  allowanceCents: 0,
  user: { id, name, email: `${id}@x.com`, active: true, topSize, shoeSize: "10" },
  status: "SUBMITTED",
  submission: null,
});
const student = (id: string, name: string, topSize: string | null): GearPickAdminStudent => ({
  id: `s-${id}`,
  user: { id, name, active: true },
  topSize,
  topSizeFit: "MENS",
  shoeSize: null,
  needsSize: !topSize,
});

describe("buildHandoutBoard", () => {
  it("lists staff before students and counts handed-out pieces", () => {
    const people = buildHandoutBoard([staff("a", "Zed Staff", "M")], [student("b", "Amy Student", "S")], [], GEAR_CATALOG.kits);
    expect(people.map((person) => [person.name, person.group])).toEqual([
      ["Zed Staff", "Staff"],
      ["Amy Student", "Student"],
    ]);
    expect(people[0]!.totalCount).toBe(9); // 4 standard issue + 5 core kit
    expect(people[1]!.totalCount).toBe(2); // zip and polo
    expect(people.every((person) => person.status === "NONE")).toBe(true);
  });

  it("marks a piece handed from its key and moves the person to partial, then done", () => {
    const [first] = buildHandoutBoard([], [student("b", "Amy Student", "S")], [], GEAR_CATALOG.kits);
    const [zip, polo] = first!.pieces;
    const partial = buildHandoutBoard([], [student("b", "Amy Student", "S")], [{ userId: "b", sku: zip!.sku, size: "S", source: "STUDENT_KIT" }], GEAR_CATALOG.kits)[0]!;
    expect(partial).toMatchObject({ handedCount: 1, totalCount: 2, status: "PARTIAL" });
    expect(partial.pieces[0]!.key).toBe(pieceKey(zip!.sku, "S", "STUDENT_KIT"));

    const done = buildHandoutBoard(
      [],
      [student("b", "Amy Student", "S")],
      [zip!, polo!].map((piece) => ({ userId: "b", sku: piece.sku, size: "S", source: "STUDENT_KIT" as const })),
      GEAR_CATALOG.kits,
    )[0]!;
    expect(done.status).toBe("DONE");
  });

  it("blocks pieces that have no size on file", () => {
    const person = buildHandoutBoard([], [student("c", "No Size", null)], [], GEAR_CATALOG.kits)[0]!;
    expect(person.pieces.every((piece) => piece.blocked)).toBe(true);
  });
});
