import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import {
  buildEquipmentSheet,
  equipmentSheetTabName,
  planEquipmentSheet,
  toArrayBuffer,
} from "@/lib/gear-picks/equipment-sheet";
import { findGearSku } from "@/lib/gear-picks/catalog";
import type { GearPickAdminParticipant, GearPickLineDto } from "@/lib/gear-picks/types";

vi.mock("@/lib/db", () => ({ db: {} }));

function line(sku: string, size: string | null, quantity = 1): GearPickLineDto {
  const entry = findGearSku(sku);
  if (!entry) throw new Error(`Unknown test SKU ${sku}`);
  return {
    sku,
    style: entry.item.style,
    colorCode: entry.color.code,
    size,
    quantity,
    unitPriceCents: entry.unitPriceCents,
    lineTotalCents: entry.unitPriceCents * quantity,
    itemName: entry.item.name,
    colorLabel: entry.color.label,
    category: entry.item.category,
  };
}

function person(id: string, lines: GearPickLineDto[], submitted = true): GearPickAdminParticipant {
  return {
    id,
    fit: "MEN",
    allowanceCents: 19_200,
    user: { id, name: id, email: `${id}@example.com`, active: true, topSize: null, shoeSize: null },
    status: submitted ? "SUBMITTED" : "DRAFT",
    submission: {
      version: 1,
      totalCents: lines.reduce((sum, entry) => sum + entry.lineTotalCents, 0),
      submittedAt: submitted ? "2026-10-07T15:00:00.000Z" : null,
      updatedAt: "2026-10-07T15:00:00.000Z",
      lines,
    },
  };
}

async function readTab(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(toArrayBuffer(buffer));
  return workbook;
}

describe("planEquipmentSheet", () => {
  it("groups by item and color with size counts, and leaves drafts out", () => {
    const plan = planEquipmentSheet([
      person("a", [line("6021649-005", "L", 2), line("6021649-005", "XXL")]),
      person("b", [line("6021649-005", "L")]),
      person("draft", [line("6021649-834", "M")], false),
    ]);

    expect(plan.submittedCount).toBe(2);
    expect(plan.rows).toHaveLength(1);
    const [tee] = plan.rows;
    expect(tee).toMatchObject({ section: "SIDELINE", itemName: "M Athletics SS Tee", colorLabel: "Black", quantity: 4 });
    expect(tee!.sizeCounts[4]).toBe(3); // L
    expect(tee!.sizeCounts[8]).toBe(1); // XXL lands in 2XL
  });

  it("routes shoes, headwear, and other collections to the department's sections", () => {
    const plan = planEquipmentSheet([
      person("a", [
        line("6013320-001", "10.5"),
        line("6013321-001", "8"),
        line("6024284-104", "9"),
        line("6026523-834", "M/L"),
        line("6021743-001", "32", 2),
        line("6026522-026", "S"),
      ]),
    ]);

    const byName = Object.fromEntries(plan.rows.map((row) => [row.itemName, row]));
    // Men's slide sizes fill the 6..13 columns; 10½ is column index 9.
    expect(byName["M UA Ignite Pro 8 Slide"]).toMatchObject({ section: "SHOES" });
    expect(byName["M UA Ignite Pro 8 Slide"]!.sizeCounts[9]).toBe(1);
    // Women's and catalog shoe sizes are never converted to the men's columns.
    expect(byName["W UA Ignite Pro 8 Slide"]).toMatchObject({ section: "SHOES", otherSizes: [{ size: "W 8", quantity: 1 }] });
    expect(byName["UA Icon Lo"]).toMatchObject({ section: "SHOES", otherSizes: [{ size: "9", quantity: 1 }] });
    expect(byName["ArmourVent Stretch Fit Cap"]).toMatchObject({ section: "SIDELINE", otherSizes: [{ size: "M/L", quantity: 1 }] });
    expect(byName["M Unhemmed Drive Pant"]).toMatchObject({ quantity: 2, otherSizes: [{ size: "32", quantity: 2 }] });
    expect(byName["W LS Icon Tee"]).toMatchObject({ section: "TEAM_CATALOG" });
  });
});

describe("buildEquipmentSheet", () => {
  it("fills the cycle tab and keeps the template's formulas", async () => {
    const plan = planEquipmentSheet([
      person("a", [line("6021649-005", "L", 2), line("6021743-001", "34"), line("6013320-001", "11"), line("6013321-001", "8")]),
    ]);
    const { buffer, rowCount, movedCount } = await buildEquipmentSheet(plan, "2027-28");
    expect(rowCount).toBe(4);
    expect(movedCount).toBe(0);

    const workbook = await readTab(buffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["27-28"]);
    const sheet = workbook.getWorksheet(equipmentSheetTabName("2027-28"))!;
    expect(sheet.getCell("R1").value).toBe("2027-2028 Equipment Budget");

    // Shoe section, first row: men's 11 is column K.
    expect(sheet.getCell("R6").value).toBe("M UA Ignite Pro 8 Slide");
    expect(sheet.getCell("S6").value).toBe("6013320-001");
    expect(sheet.getCell("K6").value).toBe(1);
    expect(sheet.getCell("V6").value).toBe(1);
    expect(sheet.getCell("U6").value).toBe(30);
    // Row 7's typed 0 Total doesn't block it; the women's size goes to notes, not the men's columns.
    expect(sheet.getCell("R7").value).toBe("W UA Ignite Pro 8 Slide");
    expect(sheet.getCell("X7").value).toBe("W 8 ×1");
    expect(sheet.getCell("W7").value).toMatchObject({ formula: "SUM(U7*V7)" });

    // Sideline section starts at row 17; tees sort before pants by catalog category order.
    expect(sheet.getCell("R17").value).toBe("M Athletics SS Tee");
    expect(sheet.getCell("Q17").value).toBe("6021649");
    expect(sheet.getCell("S17").value).toBe("005");
    expect(sheet.getCell("E17").value).toBe(2);
    expect(sheet.getCell("P17").value).toMatchObject({ formula: "SUM(A17:O17)" });
    expect(sheet.getCell("W17").value).toMatchObject({ formula: "SUM(U17*V17)" });
    expect(sheet.getCell("R18").value).toBe("M Unhemmed Drive Pant");
    expect(sheet.getCell("X18").value).toBe("34 ×1");
    expect(sheet.getCell("V18").value).toBe(1);

    // Budget math stays live.
    expect(sheet.getCell("X99").value).toMatchObject({ formula: "SUM(W6:W99)" });
    expect(sheet.getCell("Y95").value).toBe(5500);
  });

  it("skips template note rows and moves a full section's overflow with a note", async () => {
    // 22 distinct sideline item/colors: 21 fit in Sideline, the 22nd goes to Team catalog.
    const skus = [
      "6021649-005", "6021649-834", "6021743-001", "6021743-100",
      ...["6026519", "6026515", "6026510", "6026523", "6026518", "6026509", "6026499", "6026493", "6026486", "6026476"]
        .flatMap((style) => (findGearSku(`${style}-834`) ? [`${style}-834`, `${style}-001`] : [])),
    ].filter((sku) => findGearSku(sku));
    expect(skus.length).toBeGreaterThanOrEqual(22);
    const lines = skus.slice(0, 22).map((sku) => line(sku, findGearSku(sku)!.item.sizes?.[0] ?? "OSFA"));
    const plan = planEquipmentSheet([person("a", lines)]);

    const { buffer, movedCount } = await buildEquipmentSheet(plan, "2027-28");
    expect(movedCount).toBe(1);
    const sheet = (await readTab(buffer)).getWorksheet("27-28")!;
    expect(sheet.getCell("R37").value).toBeTruthy();
    // Rows 39 and 40 hold the department's notes, so the first free team catalog row is 41.
    expect(sheet.getCell("C39").value).toBe("Talls may or may not be available");
    expect(sheet.getCell("R39").value ?? null).toBeNull();
    expect(sheet.getCell("R40").value ?? null).toBeNull();
    expect(String(sheet.getCell("X41").value)).toContain("Sideline apparel (section full)");
  });

  it("refuses a cycle with no tab in the template", async () => {
    await expect(buildEquipmentSheet({ rows: [], submittedCount: 0, totalCents: 0 }, "2031-32")).rejects.toThrow(/31-32/);
  });
});
