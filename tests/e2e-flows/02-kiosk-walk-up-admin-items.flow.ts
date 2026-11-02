import { expect, test } from "@playwright/test";
import { activateKiosk, apiAs, bookingStatus, clickOpens, json, kioskRequestId, pageAs, seed } from "./helpers";

/**
 * A walk-up kiosk checkout, then an admin fixes the gear list on the web
 * (adds a lens, removes it again) while it is out, and the kiosk takes the
 * return. Students never see the admin-only item actions.
 */
test("kiosk walk-up checkout, admin add/remove items on the web, kiosk return", async ({ browser, playwright }) => {
  const teammate = seed.users.teammate;
  const camera = seed.assets.roam2;
  const lens = seed.assets.lens1;
  const admin = await apiAs(playwright, "admin");
  const kiosk = await activateKiosk(playwright, admin, "Walk-up flow iPad");

  await test.step("the kiosk rejects gear that is not available", async () => {
    const shop = await json(kiosk.post("/api/kiosk/checkout/scan", { data: { scanValue: seed.assets.broken.tag } }));
    expect(shop).toMatchObject({ success: false, error: `${seed.assets.broken.tag} is in maintenance` });
    const unknown = await json(kiosk.post("/api/kiosk/checkout/scan", { data: { scanValue: "NOPE-404" } }));
    expect(unknown).toMatchObject({ success: false, error: "Item not found" });
  });

  let checkoutId = "";
  await test.step("walk-up checkout of a camera", async () => {
    const identified = await json(kiosk.post("/api/kiosk/identify", { data: { scanValue: teammate.wiscard } }));
    expect(identified.data.id).toBe(teammate.id);
    const scanned = await json(kiosk.post("/api/kiosk/checkout/scan", { data: { scanValue: camera.tag, actorId: teammate.id } }));
    expect(scanned).toMatchObject({ success: true, item: { id: camera.id, tagName: camera.tag } });
    const requestId = kioskRequestId();
    const body = { actorId: teammate.id, requestId, items: [{ assetId: camera.id }], customPurpose: "Practice b-roll" };
    const completed = await json(kiosk.post("/api/kiosk/checkout/complete", { data: body }));
    expect(completed.itemCount).toBe(1);
    checkoutId = completed.bookingId;
    // A retried tap with the same receipt is answered once, not checked out twice.
    const replay = await json(kiosk.post("/api/kiosk/checkout/complete", { data: body }));
    expect(replay.bookingId).toBe(checkoutId);
  });

  const adminPage = await pageAs(browser, "admin");
  await test.step("admin adds a lens to the active checkout from the web", async () => {
    await adminPage.goto(`/checkouts/${checkoutId}`);
    await expect(adminPage.getByText("Checked out", { exact: true })).toBeVisible();
    await expect(adminPage.getByRole("link", { name: camera.tag })).toBeVisible();
    const dialog = adminPage.getByRole("dialog", { name: "Add to this checkout" });
    await clickOpens(adminPage.getByRole("button", { name: "Add items" }), dialog);
    await dialog.getByPlaceholder("Search by name or tag").fill(lens.tag);
    await dialog.getByRole("listitem").filter({ hasText: lens.tag }).getByRole("button", { name: "Add" }).click();
    await expect(adminPage.getByRole("link", { name: lens.tag })).toBeVisible();
    await expect(adminPage.getByText("2 items").first()).toBeVisible();
  });

  await test.step("the lens is now out: the kiosk will not hand it to someone else", async () => {
    const busy = await json(kiosk.post("/api/kiosk/checkout/scan", { data: { scanValue: lens.tag } }));
    expect(busy.success).toBe(false);
    expect(busy.error).toContain(teammate.name);
  });

  await test.step("admin removes the lens again", async () => {
    // The innermost element that holds the lens link and its own actions menu, and not the camera.
    const lensRow = adminPage.locator("div, li, tr")
      .filter({ has: adminPage.getByRole("link", { name: lens.tag, exact: true }) })
      .filter({ has: adminPage.getByRole("button", { name: "Item actions" }) })
      .filter({ hasNot: adminPage.getByRole("link", { name: camera.tag, exact: true }) })
      .last();
    await lensRow.getByRole("button", { name: "Item actions" }).click();
    await adminPage.getByRole("menuitem", { name: "Remove from checkout" }).click();
    await adminPage.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(adminPage.getByRole("link", { name: lens.tag })).toHaveCount(0);
    await expect(adminPage.getByRole("link", { name: camera.tag })).toBeVisible();
    const free = await json(kiosk.post("/api/kiosk/checkout/scan", { data: { scanValue: lens.tag } }));
    expect(free.success).toBe(true);
  });

  await test.step("students get no admin item actions on the web", async () => {
    const teammateApi = await apiAs(playwright, "teammate");
    const add = await teammateApi.post(`/api/bookings/${checkoutId}/items`, { data: { assetId: lens.id } });
    expect(add.status()).toBe(403);
    const studentPage = await pageAs(browser, "teammate");
    await studentPage.goto(`/checkouts/${checkoutId}`);
    await expect(studentPage.getByRole("link", { name: camera.tag })).toBeVisible();
    await expect(studentPage.getByRole("button", { name: "Add items" })).toHaveCount(0);
  });

  await test.step("the kiosk return completes the checkout and the activity trail has every step", async () => {
    const returned = await json(kiosk.post(`/api/kiosk/checkin/${checkoutId}/scan`, { data: { scanValue: camera.tag, actorId: teammate.id } }));
    expect(returned.success, JSON.stringify(returned)).toBeTruthy();
    expect(await bookingStatus(playwright, checkoutId)).toBe("COMPLETED");
    await adminPage.reload();
    await expect(adminPage.getByText("Returned", { exact: true }).first()).toBeVisible();
    await adminPage.getByRole("button", { name: /^Activity/ }).click();
    await expect(adminPage.getByText("Checked out gear at a kiosk")).toBeVisible();
    await expect(adminPage.getByText(`Added ${lens.tag} to the active checkout`)).toBeVisible();
    await expect(adminPage.getByText(`Removed ${lens.tag} from the active checkout`)).toBeVisible();
    await expect(adminPage.getByText("Booking completed by the kiosk return")).toBeVisible();
  });
});
