import { expect, test } from "@playwright/test";
import { activateKiosk, apiAs, bookingStatus, clickOpens, json, kioskRequestId, madisonChip, madisonDateTime, pageAs, seed } from "./helpers";

/**
 * A student reserves a camera for tomorrow's game on the web, picks it up at
 * the kiosk by scanning their Wiscard and the camera, and returns it at the
 * kiosk. The web shows each custody step; web routes never create custody.
 */
test("student reserves on the web, picks up and returns at the kiosk", async ({ browser, playwright }) => {
  const student = seed.users.student;
  const camera = seed.assets.roam1;
  const page = await pageAs(browser, "student");

  await test.step("reserve the camera for the game through the wizard", async () => {
    await page.goto("/reservations/new");
    await expect(page.getByRole("heading", { name: "Reservation details" })).toBeVisible();
    // Linking the event names the booking and sets the pickup window.
    const kickoff = madisonDateTime(seed.event.startsAt);
    await page.getByRole("button", { name: `Link ${kickoff} Football vs Minnesota` }).click();
    await clickOpens(page.getByRole("button", { name: "Next", exact: true }), page.getByRole("heading", { name: "Equipment" }));

    // The event names the booking.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Football vs Minnesota");
    await expect(page.getByRole("checkbox", { name: `Add ${seed.assets.broken.tag}` }), "a camera in maintenance cannot be reserved").toBeDisabled();
    await page.getByRole("checkbox", { name: `Add ${camera.tag}` }).check();
    await clickOpens(page.getByRole("button", { name: "Review (1 item)" }), page.getByRole("heading", { name: "Review your reservation" }));
    // The confirm step shows the game in Madison time like every other screen.
    await expect(page.getByText(madisonChip(seed.event.startsAt))).toBeVisible();
    await page.getByRole("button", { name: "Reserve for later" }).click();
    await page.waitForURL(/\/bookings/);
    await expect(page.getByText("Football vs Minnesota").first()).toBeVisible();
  });

  const studentApi = await apiAs(playwright, "student");
  const { data: reservations } = await json(studentApi.get("/api/reservations"));
  const reservation = reservations.find((booking: { title: string }) => booking.title === "Football vs Minnesota");
  expect(reservation, "the reservation is listed for the student").toBeTruthy();
  expect(reservation.status).toBe("BOOKED");

  const admin = await apiAs(playwright, "admin");
  const kiosk = await activateKiosk(playwright, admin, "Reservation flow iPad");

  await test.step("pick up at the kiosk: Wiscard, then the reserved camera", async () => {
    const identified = await json(kiosk.post("/api/kiosk/identify", { data: { scanValue: student.wiscard } }));
    expect(identified).toMatchObject({ success: true, data: { id: student.id, name: student.name } });

    const scanned = await json(kiosk.post(`/api/kiosk/pickup/${reservation.id}/scan`, { data: { scanValue: camera.tag, actorId: student.id } }));
    expect(scanned.success, JSON.stringify(scanned)).toBeTruthy();

    const confirmed = await json(kiosk.post(`/api/kiosk/pickup/${reservation.id}/confirm`, { data: { actorId: student.id, requestId: kioskRequestId() } }));
    expect(confirmed.itemCount).toBe(1);
    test.info().annotations.push({ type: "checkout", description: confirmed.bookingId });

    await page.goto(`/checkouts/${confirmed.bookingId}`);
    await expect(page.getByText("Checked out", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: camera.tag })).toBeVisible();

    // While it is out, a walk-up scan of the same camera is turned away with the holder's name.
    const busy = await json(kiosk.post("/api/kiosk/checkout/scan", { data: { scanValue: camera.tag } }));
    expect(busy.success).toBe(false);
    expect(busy.error).toContain(student.name);
  });

  const checkoutId = test.info().annotations.find((note) => note.type === "checkout")!.description!;

  await test.step("return at the kiosk completes the checkout", async () => {
    const returned = await json(kiosk.post(`/api/kiosk/checkin/${checkoutId}/scan`, { data: { scanValue: camera.tag, actorId: student.id } }));
    expect(returned.success, JSON.stringify(returned)).toBeTruthy();
    // The last item back closes the checkout without a separate tap.
    expect(await bookingStatus(playwright, checkoutId)).toBe("COMPLETED");

    await page.goto(`/checkouts/${checkoutId}`);
    await expect(page.getByText("Returned", { exact: true }).first()).toBeVisible();

    // Custody is the kiosk's alone: the web return routes refuse even the owner.
    const webReturn = await studentApi.post(`/api/checkouts/${checkoutId}/complete-checkin`, { data: {} });
    expect(webReturn.status()).toBe(403);

    // And the camera is available for the next person.
    const free = await json(kiosk.post("/api/kiosk/checkout/scan", { data: { scanValue: camera.tag } }));
    expect(free).toMatchObject({ success: true, item: { tagName: camera.tag } });
  });
});
