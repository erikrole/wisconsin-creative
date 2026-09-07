import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const role = process.env.PLAYWRIGHT_ROLE?.trim().toUpperCase();
const hasCredentials = Boolean(
  process.env.PLAYWRIGHT_EMAIL?.trim()
  && process.env.PLAYWRIGHT_PASSWORD
  && (role === "STAFF" || role === "ADMIN"),
);

const bookingId = "cm000000000000000000000001";
const itemId = "cm000000000000000000000002";
const holderId = "cm000000000000000000000003";
const proofDir = resolve("tasks/archive/proofs/checkout-item-transfer-2026-09-07");
const baseline = process.env.ITEM_TRANSFER_BASELINE === "1";
const destinationId = "cm000000000000000000000011";

function bookingFixture(assigned = false) {
  return {
    id: bookingId,
    kind: "CHECKOUT",
    title: "Football vs Notre Dame",
    refNumber: "CO-0421",
    status: "OPEN",
    custodyScope: "SHARED",
    startsAt: "2026-09-01T14:00:00.000Z",
    endsAt: "2026-09-08T18:00:00.000Z",
    notes: "Travel camera package",
    createdAt: "2026-09-01T14:00:00.000Z",
    updatedAt: assigned ? "2026-09-07T16:01:00.000Z" : "2026-09-07T16:00:00.000Z",
    requesterUserId: "cm000000000000000000000004",
    createdBy: "cm000000000000000000000005",
    locationId: "cm000000000000000000000006",
    location: { id: "cm000000000000000000000006", name: "Kellner Hall" },
    requester: {
      id: "cm000000000000000000000004",
      name: "Checkout Operator",
      email: "operator@example.com",
      avatarUrl: null,
      role: "STAFF",
    },
    creator: {
      id: "cm000000000000000000000005",
      name: "Equipment Staff",
      email: "equipment@example.com",
      avatarUrl: null,
    },
    serializedItems: [{
      id: itemId,
      allocationStatus: "active",
      assignedUserId: assigned ? holderId : null,
      assignedAt: assigned ? "2026-09-07T16:01:00.000Z" : null,
      assignee: assigned ? {
        id: holderId,
        name: "Jordan Lee",
        email: "jordan@example.com",
        avatarUrl: null,
      } : null,
      asset: {
        id: "cm000000000000000000000007",
        assetTag: "CAM-104",
        name: "Sony FX3",
        brand: "Sony",
        model: "FX3",
        serialNumber: "ND-2026-104",
        type: "Camera",
        imageUrl: null,
        location: { id: "cm000000000000000000000006", name: "Kellner Hall" },
      },
    }],
    bulkItems: [{
      id: "cm000000000000000000000008",
      plannedQuantity: 8,
      checkedOutQuantity: 8,
      checkedInQuantity: 0,
      bulkSku: {
        id: "cm000000000000000000000009",
        name: "Sony Batteries",
        category: "Battery",
        unit: "battery",
        imageUrl: null,
        trackByNumber: true,
      },
      unitAllocations: [
        { bulkSkuUnit: { unitNumber: 1, status: "CHECKED_OUT" } },
        { bulkSkuUnit: { unitNumber: 2, status: "CHECKED_OUT" } },
      ],
    }],
    isOverdue: false,
    isActive: true,
    bookingType: "Checkout",
    auditLogs: [],
    hasMoreAuditLogs: false,
    auditLogNextCursor: null,
    itemLocations: [{ id: "cm000000000000000000000006", name: "Kellner Hall" }],
    locationMode: "SINGLE",
    allowedActions: ["edit", "extend", "manage-custody"],
    sourceReservation: null,
    event: {
      id: "cm000000000000000000000010",
      summary: "Football vs Notre Dame",
      sportCode: "FB",
      opponent: "Notre Dame",
      isHome: false,
    },
    events: [],
    sportCode: "FB",
    shiftAssignment: null,
    scheduleStatus: "not_applicable",
    scheduleStatusReason: null,
    kit: null,
    pickupKioskDevice: null,
    photos: [],
  };
}

test.skip(!hasCredentials, "Requires the isolated STAFF or ADMIN smoke identity.");

for (const custodyScope of ["SHARED", "PERSON"] as const) {
test(`staff transfers item ownership from ${custodyScope} custody without mutating live data`, async ({ page }, testInfo) => {
  mkdirSync(proofDir, { recursive: true });
  let booking = { ...bookingFixture(false), custodyScope };
  let postedTarget: string | null | undefined;

  await page.route(`**/api/bookings/${bookingId}`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data: booking }),
  }));
  await page.route("**/api/availability/check", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ conflicts: [], upcomingCommitments: [], turnaroundRisks: [], bulkTurnaroundRisks: [] }),
  }));
  await page.route("**/api/users?*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      data: [{
        id: holderId,
        name: "Jordan Lee",
        email: "jordan@example.com",
        role: "STUDENT",
        avatarUrl: null,
        active: true,
        hiddenFromRoster: false,
      }],
    }),
  }));
  await page.route("**/api/me/profile-completion", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      data: {
        profile: { id: "smoke-user", name: "Smoke Admin", role, email: "smoke@example.com" },
        completion: {
          operationalReady: true,
          profileComplete: true,
          isComplete: true,
          isSnoozed: false,
          shouldPrompt: false,
          snoozedUntil: null,
          completedCount: 1,
          totalCount: 1,
          missingFields: [],
          firstIncompleteStep: null,
          completeByField: {},
        },
      },
    }),
  }));
  await page.route(`**/api/bookings/${bookingId}/serialized-items/${itemId}/holder`, async (route) => {
    const body = route.request().postDataJSON() as { targetUserId?: string | null };
    postedTarget = body.targetUserId;
    booking = { ...bookingFixture(true), custodyScope };
    if (!baseline) booking.serializedItems = [];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: booking, transfer: { targetBookingId: destinationId, targetRefNumber: "CO-0422", targetUserName: "Jordan Lee" } }),
    });
  });
  await page.route(`**/api/bookings/${destinationId}`, (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ data: {
      ...bookingFixture(false), id: destinationId, custodyScope: "PERSON", refNumber: "CO-0422",
      requesterUserId: holderId, requester: { id: holderId, name: "Jordan Lee", email: "jordan@example.com", avatarUrl: null, role: "STUDENT" },
      bulkItems: [],
    } }),
  }));

  await page.goto(`/checkouts/${bookingId}`);
  await expect(page.getByRole("heading", { name: "Football vs Notre Dame" })).toBeVisible();
  const equipmentCard = page.locator('[data-slot="card"]').filter({ hasText: "Equipment" }).first();
  await expect(equipmentCard.getByText("CAM-104", { exact: true })).toBeVisible();
  await expect(equipmentCard.getByText("With Jordan Lee", { exact: true })).toHaveCount(0);
  const proofPrefix = `${testInfo.project.name}-${custodyScope.toLowerCase()}-${baseline ? "baseline" : "transfer"}`;

  await equipmentCard.screenshot({ animations: "disabled", path: resolve(proofDir, `${proofPrefix}-before.png`) });

  await equipmentCard.getByRole("button", { name: "Item actions" }).first().click();
  await page.getByRole("menuitem", { name: baseline ? "Assign holder" : "Transfer item ownership" }).click();
  const holderDialog = page.getByRole("dialog", { name: baseline ? "Assign item holder" : "Transfer item ownership" });
  await expect(holderDialog).toBeVisible();
  await holderDialog.screenshot({
    animations: "disabled",
    path: resolve(proofDir, `${proofPrefix}-assignment-dialog.png`),
  });

  await holderDialog.getByRole("combobox", { name: baseline ? "Holder" : "Receiving owner" }).click();
  await page.getByRole("option", { name: /Jordan Lee/ }).click();
  await expect(page.getByRole("option", { name: /Jordan Lee/ })).toHaveCount(0);
  await holderDialog.getByRole("textbox", { name: "Note" }).fill("Camera bodies were swapped after the sideline handoff.");
  await holderDialog.screenshot({ animations: "disabled", path: resolve(proofDir, `${proofPrefix}-selected-dialog.png`) });
  await holderDialog.getByRole("button", { name: baseline ? "Save holder" : "Transfer item" }).click();

  await expect(page.getByRole("dialog", { name: baseline ? "Assign item holder" : "Transfer item ownership" })).toHaveCount(0);
  if (baseline) {
    await expect(equipmentCard.getByText("With Jordan Lee", { exact: true })).toBeVisible();
  } else {
    await expect(equipmentCard.getByText("CAM-104", { exact: true })).toHaveCount(0);
    await expect(equipmentCard.getByText("Sony Batteries", { exact: true })).toBeVisible();
  }
  expect(postedTarget).toBe(holderId);
  await equipmentCard.screenshot({ animations: "disabled", path: resolve(proofDir, `${proofPrefix}-after.png`) });
  if (!baseline) {
    await page.getByRole("button", { name: "CO-0422", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/checkouts/${destinationId}$`));
    await expect(page.getByText("CAM-104", { exact: true })).toBeVisible();
    await expect(page.getByText("Jordan Lee", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Sony Batteries", { exact: true })).toHaveCount(0);
    await page.screenshot({ animations: "disabled", fullPage: true, path: resolve(proofDir, `${proofPrefix}-destination.png`) });
  }
});

}
