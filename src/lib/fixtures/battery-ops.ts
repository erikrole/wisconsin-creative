type FixtureUnitOptions = {
  prefix: string;
  productId?: string;
  checkedOut?: number[];
};

function makeUnits(count: number, options: FixtureUnitOptions) {
  return Array.from({ length: count }, (_, index) => {
    const unitNumber = index + 1;
    const checkedOut = options.checkedOut?.includes(unitNumber) ?? false;

    return {
      id: `${options.prefix}-${unitNumber}`,
      productId: options.productId ?? null,
      unitNumber,
      status: checkedOut ? "CHECKED_OUT" as const : "AVAILABLE" as const,
      notes: null,
      labelPrintedAt: null,
      labelPrintedById: null,
      labelPrintBatchId: null,
      checkedOutAt: checkedOut ? "2026-08-27T12:00:00.000Z" : null,
      checkedOutDays: checkedOut ? 3 : null,
      booking: checkedOut
        ? {
            id: `fixture-booking-${unitNumber}`,
            title: "Football practice",
            refNumber: `CO-${String(unitNumber).padStart(4, "0")}`,
            endsAt: "2026-09-03T18:00:00.000Z",
            requesterName: unitNumber === 44 ? "Usman Syed" : "Maddy Pehler",
          }
        : null,
    };
  });
}

export function getBatteryOpsFixture() {
  const skus = [
    {
      id: "fixture-fx6",
      name: "FX6 Battery",
      category: "Batteries",
      trackByNumber: true,
      location: { id: "fixture-location", name: "Camp Randall" },
      minThreshold: 10,
      threshold: 10,
      binQrCodeValue: "fx6-battery",
      products: [
        { id: "fixture-fx6-product", name: "Sony BP-U70", brand: "Sony", model: "BP-U70", assignedUnitCount: 12 },
      ],
      counts: { total: 12, available: 12, checkedOut: 0, lost: 0, retired: 0 },
      labelPrintedCount: 0,
      labelNeededCount: 12,
      isLow: false,
      units: makeUnits(12, { prefix: "fixture-fx6-unit", productId: "fixture-fx6-product" }),
    },
    {
      id: "fixture-gold",
      name: "Gold Mount Battery",
      category: "Batteries",
      trackByNumber: true,
      location: { id: "fixture-location", name: "Camp Randall" },
      minThreshold: 10,
      threshold: 10,
      binQrCodeValue: "gold-mount",
      products: [
        { id: "fixture-gold-product", name: "Dionic XT 150Wh", brand: "Anton/Bauer", model: "Dionic XT 150Wh", assignedUnitCount: 8 },
      ],
      counts: { total: 8, available: 8, checkedOut: 0, lost: 0, retired: 0 },
      labelPrintedCount: 0,
      labelNeededCount: 8,
      isLow: true,
      units: makeUnits(8, { prefix: "fixture-gold-unit", productId: "fixture-gold-product" }),
    },
    {
      id: "fixture-monitor",
      name: "Monitor Battery",
      category: "Batteries",
      trackByNumber: true,
      location: { id: "fixture-location", name: "Camp Randall" },
      minThreshold: 10,
      threshold: 10,
      binQrCodeValue: "monitor-battery",
      products: [
        { id: "fixture-monitor-product", name: "Watson NP-F550", brand: "Watson", model: "NP-F550", assignedUnitCount: 4 },
      ],
      counts: { total: 18, available: 18, checkedOut: 0, lost: 0, retired: 0 },
      labelPrintedCount: 0,
      labelNeededCount: 18,
      isLow: false,
      units: makeUnits(18, { prefix: "fixture-monitor-unit" }).map((unit) => ({
        ...unit,
        productId: unit.unitNumber >= 15 ? "fixture-monitor-product" : null,
      })),
    },
    {
      id: "fixture-sony",
      name: "Sony Battery",
      category: "Batteries",
      trackByNumber: true,
      location: { id: "fixture-location", name: "Camp Randall" },
      minThreshold: 10,
      threshold: 10,
      binQrCodeValue: "sony-battery",
      products: [
        { id: "fixture-sony-product", name: "Sony NP-FZ100", brand: "Sony", model: "NP-FZ100", assignedUnitCount: 52 },
      ],
      counts: { total: 52, available: 48, checkedOut: 4, lost: 0, retired: 0 },
      labelPrintedCount: 0,
      labelNeededCount: 52,
      isLow: false,
      units: makeUnits(52, {
        prefix: "fixture-sony-unit",
        productId: "fixture-sony-product",
        checkedOut: [9, 14, 23, 44],
      }),
    },
  ];

  return {
    totals: {
      total: 90,
      available: 86,
      checkedOut: 4,
      lost: 0,
      retired: 0,
      lowSkus: 1,
      agingCheckedOut: 0,
    },
    skus,
    compatibility: [
      {
        ruleId: "fixture-gold-mount",
        label: "V-mount batteries",
        cameraModels: ["ILME-FX6V"],
        cameraCount: 4,
        batterySkuIds: ["fixture-gold"],
        batterySkuNames: ["Gold Mount Battery"],
        availableQuantity: 8,
        threshold: 10,
        isLow: true,
      },
    ],
    integrity: { staleCheckedOutCount: 0, staleCheckedOutUnits: [] },
  };
}
