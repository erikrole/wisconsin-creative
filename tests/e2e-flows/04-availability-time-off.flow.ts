import { expect, test } from "@playwright/test";
import { apiAs, clickOpens, json, pageAs, seed } from "./helpers";

/**
 * A student files time off and a weekly class on their Availability tab;
 * the time off waits for staff, an admin approves it on the student's profile,
 * and the approved time off then blocks that student from a shift on those days.
 */
test("student files class time and time off; admin approves; approved time off blocks a claim", async ({ browser, playwright }) => {
  const teammate = seed.users.teammate;
  const teammatePage = await pageAs(browser, "teammate");
  // Days away well after the seeded game, so the two flows never collide.
  const from = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  const through = new Date(Date.now() + 16 * 86_400_000).toISOString().slice(0, 10);

  await test.step("the student files time off on their own Availability tab", async () => {
    await teammatePage.goto(`/staff/${teammate.id}`);
    await teammatePage.getByRole("tab", { name: "Availability" }).click();
    await clickOpens(teammatePage.getByRole("button", { name: "Add day away" }), teammatePage.getByRole("combobox", { name: "Intent" }));
    await teammatePage.getByRole("combobox", { name: "Intent" }).click();
    await teammatePage.getByRole("option", { name: "Time off" }).click();
    await expect(teammatePage.getByRole("combobox", { name: "Type" })).toHaveText("One-time day or range");
    await teammatePage.getByRole("textbox", { name: "From" }).fill(from);
    await teammatePage.getByRole("textbox", { name: "Through (optional)" }).fill(through);
    await teammatePage.getByRole("textbox", { name: "Label", exact: true }).fill("Trip home");
    await teammatePage.getByRole("button", { name: "Add availability" }).click();
    await expect(teammatePage.getByRole("button", { name: "Add availability" })).toHaveCount(0);
  });

  await test.step("the request waits for staff", async () => {
    await expect(teammatePage.getByText("Pending time off", { exact: true })).toBeVisible();
    await expect(teammatePage.getByText("Trip home", { exact: true })).toBeVisible();
    // Students do not review their own requests.
    await expect(teammatePage.getByRole("button", { name: "Approve time off" })).toHaveCount(0);
    const api = await apiAs(playwright, "teammate");
    const forbidden = await api.post(`/api/users/${seed.users.student.id}/availability`, {
      data: { kind: "AD_HOC", intent: "TIME_OFF", date: from, allDay: true, startsAt: "00:00", endsAt: "23:59" },
    });
    expect(forbidden.status(), "a student cannot file time off for someone else").toBe(403);
  });

  await test.step("the admin approves it on the student's profile", async () => {
    const adminPage = await pageAs(browser, "admin");
    await adminPage.goto(`/staff/${teammate.id}`);
    await adminPage.getByRole("tab", { name: "Availability" }).click();
    await expect(adminPage.getByText("Pending time off", { exact: true })).toBeVisible();
    await adminPage.getByRole("button", { name: "Approve time off" }).click();
    await expect(adminPage.getByText("Pending time off", { exact: true })).toHaveCount(0);
    await expect(adminPage.getByText(/Approved time off/).first()).toBeVisible();
    const { data: blocks } = await json((await apiAs(playwright, "admin")).get(`/api/users/${teammate.id}/availability`));
    expect(blocks.find((block: { label: string }) => block.label === "Trip home")?.status).toBe("APPROVED");
  });

  await test.step("a weekly class time is advisory and saved", async () => {
    await teammatePage.getByRole("button", { name: "Add class time" }).click();
    await expect(teammatePage.getByRole("combobox", { name: "Type" })).toHaveText("Weekly class");
    await teammatePage.getByRole("textbox", { name: "Label", exact: true }).fill("CHEM 103");
    await teammatePage.getByRole("button", { name: "Add availability" }).click();
    await expect(teammatePage.getByText("CHEM 103")).toBeVisible();
    await expect(teammatePage.getByRole("button", { name: "Add availability" })).toHaveCount(0);
  });

  await test.step("approved time off blocks a shift on those days", async () => {
    const admin = await apiAs(playwright, "admin");
    // The day away was filed for 9 to 11 AM Madison time (CST): 15:00Z to 17:00Z.
    const away = new Date(`${from}T15:00:00.000Z`);
    const event = await json(admin.post("/api/calendar-events", {
      data: { summary: "Media day", eventType: "non-game", startsAt: away.toISOString(), endsAt: new Date(away.getTime() + 2 * 3600_000).toISOString(), locationId: seed.location.id },
    }));
    const { data: group } = await json(admin.post("/api/shift-groups", { data: { eventId: event.data?.id ?? event.id, templateSide: "EMPTY" } }));
    const { data: shift } = await json(admin.post("/api/shifts", {
      data: { shiftGroupId: group.id, area: "VIDEO", workerType: "ST", startsAt: away.toISOString(), endsAt: new Date(away.getTime() + 2 * 3600_000).toISOString() },
    }));
    const claim = await (await apiAs(playwright, "teammate")).post("/api/shift-assignments/pickup", { data: { shiftId: shift.id } });
    expect(claim.status(), await claim.text()).toBeGreaterThanOrEqual(400);
    expect(await claim.text()).toMatch(/time off|away|unavailable|conflict/i);
  });
});
