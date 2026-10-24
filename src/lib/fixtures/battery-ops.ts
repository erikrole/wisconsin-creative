type UnitStatus = "AVAILABLE" | "CHECKED_OUT" | "LOST" | "RETIRED";

type FamilySpec = {
  id: string;
  name: string;
  locationName?: string;
  binQr: string;
  total: number;
  /** Unit number to the days it has been out. */
  out?: Record<number, number>;
  lost?: number[];
  retired?: number[];
  labeled?: number;
  product?: { id: string; name: string; brand: string; model: string };
  minThreshold?: number;
};

const HOLDERS = ["Maddy Pehler", "Usman Syed", "Jordan Ruiz", "Maya Chen", "Alex Romero"];

// Same rule as src/lib/bulk-batteries.ts, restated so the fixture stays DB-free.
const lowLine = (owned: number, min: number) => Math.max(min, Math.ceil(owned * 0.2));

function buildFamily(spec: FamilySpec) {
  const out = spec.out ?? {};
  const units = Array.from({ length: spec.total }, (_, index) => {
    const unitNumber = index + 1;
    const days = out[unitNumber];
    const status: UnitStatus = days !== undefined
      ? "CHECKED_OUT"
      : spec.lost?.includes(unitNumber)
        ? "LOST"
        : spec.retired?.includes(unitNumber)
          ? "RETIRED"
          : "AVAILABLE";
    const holder = HOLDERS[unitNumber % HOLDERS.length];
    return {
      id: `${spec.id}-unit-${unitNumber}`,
      productId: spec.product?.id ?? null,
      unitNumber,
      status,
      notes: null,
      labelPrintedAt: unitNumber <= (spec.labeled ?? 0) ? "2026-10-01T00:00:00.000Z" : null,
      labelPrintedById: null,
      labelPrintBatchId: null,
      checkedOutAt: days !== undefined ? "2026-10-15T12:00:00.000Z" : null,
      checkedOutDays: days ?? null,
      booking: days !== undefined
        ? {
            id: `fixture-booking-${unitNumber}`,
            title: days >= 7 ? "Football road trip" : "Football practice",
            refNumber: `CO-${String(1000 + unitNumber).padStart(4, "0")}`,
            endsAt: "2026-10-26T18:00:00.000Z",
            requesterName: holder,
          }
        : null,
    };
  });
  const count = (status: UnitStatus) => units.filter((unit) => unit.status === status).length;
  const counts = {
    total: units.length,
    available: count("AVAILABLE"),
    checkedOut: count("CHECKED_OUT"),
    lost: count("LOST"),
    retired: count("RETIRED"),
  };
  const threshold = lowLine(counts.total - counts.retired, spec.minThreshold ?? 0);
  return {
    id: spec.id,
    name: spec.name,
    category: "Batteries",
    trackByNumber: true,
    location: { id: "fixture-location", name: spec.locationName ?? "Camp Randall" },
    minThreshold: spec.minThreshold ?? 0,
    threshold,
    binQrCodeValue: spec.binQr,
    products: spec.product
      ? [{ ...spec.product, assignedUnitCount: spec.total }]
      : [],
    counts,
    labelPrintedCount: spec.labeled ?? 0,
    labelNeededCount: units.filter((unit) => unit.labelPrintedAt === null && unit.status !== "RETIRED").length,
    isLow: counts.available < threshold,
    units,
  };
}

export function getBatteryOpsFixture() {
  const skus = [
    buildFamily({
      id: "fixture-sony",
      name: "Sony Battery",
      binQr: "sony-battery",
      total: 53,
      out: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [i + 3, i % 9 === 0 ? 9 : (i % 5) + 1])),
      lost: [1],
      retired: [2, 53],
      labeled: 40,
      product: { id: "fixture-sony-product", name: "Sony NP-FZ100", brand: "Sony", model: "NP-FZ100" },
    }),
    buildFamily({
      id: "fixture-fx6",
      name: "FX6 Battery",
      binQr: "fx6-battery",
      total: 12,
      out: { 4: 2 },
      labeled: 12,
      product: { id: "fixture-fx6-product", name: "Sony BP-U70", brand: "Sony", model: "BP-U70" },
    }),
    buildFamily({
      id: "fixture-gold",
      name: "Gold Mount Battery",
      binQr: "gold-mount",
      total: 8,
      lost: [6],
      labeled: 5,
      product: { id: "fixture-gold-product", name: "Dionic XT 150Wh", brand: "Anton/Bauer", model: "Dionic XT 150Wh" },
    }),
    buildFamily({
      id: "fixture-monitor",
      name: "Monitor Battery",
      binQr: "monitor-battery",
      total: 18,
      labeled: 18,
    }),
  ];

  const sum = (key: "total" | "available" | "checkedOut" | "lost" | "retired") =>
    skus.reduce((acc, sku) => acc + sku.counts[key], 0);
  const sony = skus[0]!;
  const agingCheckedOut = skus.reduce(
    (acc, sku) => acc + sku.units.filter((unit) => unit.status === "CHECKED_OUT" && (unit.checkedOutDays ?? 0) >= 7).length,
    0,
  );

  return {
    totals: {
      total: sum("total"),
      available: sum("available"),
      checkedOut: sum("checkedOut"),
      lost: sum("lost"),
      retired: sum("retired"),
      lowSkus: skus.filter((sku) => sku.isLow).length,
      agingCheckedOut,
    },
    skus: [
      ...skus,
      {
        id: "fixture-aa",
        name: "AA Batteries",
        category: "Batteries",
        trackByNumber: false,
        location: { id: "fixture-location", name: "Camp Randall" },
        minThreshold: 12,
        threshold: 12,
        binQrCodeValue: "aa-batteries",
        products: [],
        counts: { total: 9, available: 9, checkedOut: 0, lost: 0, retired: 0 },
        labelPrintedCount: 0,
        labelNeededCount: 0,
        isLow: true,
        units: [],
      },
    ],
    compatibility: [
      {
        ruleId: "sony-np-fz100",
        label: "Sony NP-FZ100 batteries",
        cameraModels: ["FX3", "A7 IV"],
        cameraCount: 6,
        batterySkuIds: [sony.id],
        batterySkuNames: [sony.name],
        availableQuantity: sony.counts.available,
        threshold: sony.threshold,
        isLow: true,
      },
    ],
    integrity: {
      staleCheckedOutCount: 1,
      staleCheckedOutUnits: [
        { id: "fixture-fx6-unit-9", skuId: "fixture-fx6", skuName: "FX6 Battery", locationName: "Camp Randall", unitNumber: 9 },
      ],
    },
  };
}
