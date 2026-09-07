import { expect, test, type Page } from "@playwright/test";

// Authenticated isolated app shell; deterministic API responses exercise real
// Schedule components without changing any business records or sending mail.
const event = {
  id: "stability-event", summary: "Volleyball vs Reliability Test", sportCode: "VB",
  opponent: "Reliability Test", startsAt: "2026-09-05T18:00:00Z", endsAt: "2026-09-05T21:00:00Z",
  allDay: false, status: "CONFIRMED", isHome: true, site: "HOME", location: null, source: null,
  rawLocationText: null, subtitle: null,
};
const slot = {
  id: "stability-shift", key: "stability-shift", sourceShiftId: "stability-shift", area: "VIDEO", workerType: "ST",
  startsAt: event.startsAt, endsAt: event.endsAt, callStartsAt: null, callEndsAt: null,
  notes: null, assignmentHistoryCount: 0, assignment: null, assignments: [],
};
const group = {
  id: "stability-group", eventId: event.id, event, notes: null, archivedAt: null,
  shifts: [slot], coverage: { total: 1, filled: 0, percentage: 0 }, hasWorkingCopy: false,
};
const editor = {
  shiftGroupId: group.id, publicationState: "published", publishedAt: event.startsAt,
  publishedVersion: 1, basePublishedVersion: 1, workingVersion: 0, hasWorkingCopy: false,
  allDay: false, eventStartsAt: event.startsAt, eventEndsAt: event.endsAt,
  defaultWindow: { startsAt: event.startsAt, endsAt: event.endsAt },
  changes: { addedSlots: 0, removedSlots: 0, convertedSlots: 0, assignmentChanges: 0, callWindowChanges: 0, total: 0 },
  affectedWorkerCount: 0, assignedUsers: [], autoReleaseAt: null, autoReleaseError: null,
  schedule: { eventStartsAt: event.startsAt, eventEndsAt: event.endsAt, slots: [slot] },
};

async function fixture(page: Page, failCrew = false) {
  await page.route("**/api/me/profile-completion", (route) => route.fulfill({ status: 503, json: { error: "Fixture excludes onboarding" } }));
  await page.route("**/api/calendar-events?*", (route) => route.fulfill({ json: { data: [event], total: 1 } }));
  await page.route("**/api/shift-groups?*", (route) => route.fulfill(failCrew
    ? { status: 503, json: { error: "Crew read failed" } }
    : { json: { data: [group], total: 1 } }));
  await page.route("**/api/schedule/health?*", (route) => route.fulfill({ status: 503, json: { error: "Health read failed" } }));
  await page.route("**/api/schedule/automation?*", (route) => route.fulfill({ status: 503, json: { error: "Unavailable" } }));
  await page.route(`**/api/shift-groups/${group.id}/working-copy`, (route) => route.fulfill({ json: { data: editor } }));
  await page.goto("/schedule?view=week&week=2026-08-31");
  await expect(page.getByRole("heading", { name: "Schedule", exact: true })).toBeVisible();
}

test("crew failure never offers setup or all-clear in Week and Calendar", async ({ page }) => {
  await fixture(page, true);
  await expect(page.getByText("Schedule could not be loaded", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Set up crew for/ })).toHaveCount(0);
  await expect(page.getByText("Nothing needs attention", { exact: true })).toHaveCount(0);
  await page.getByRole("radio", { name: "Calendar view", exact: true }).click();
  await expect(page.getByText("Schedule could not be loaded", { exact: true })).toBeVisible();
  await expect(page.getByText("No events this month", { exact: false })).toHaveCount(0);
});

test("a lost claim response reloads the committed request without resubmitting", async ({ page }) => {
  let committed = false;
  let submissions = 0;
  const shift = { ...slot, shiftGroup: { id: group.id, publishedAt: event.startsAt, event } };
  await fixture(page);
  await page.route("**/api/shift-trades?*", (route) => route.fulfill({ json: { data: [], total: 0 } }));
  await page.route("**/api/schedule/open-work*", (route) => route.fulfill({ json: { data: {
    openShifts: committed ? [] : [{ id: slot.id, kind: "open_shift", action: "claim", canAct: true,
      reason: "Admin approval required", score: null, bucket: null, advisoryConflict: false,
      advisoryConflictNote: null, availabilityContext: null, warnings: [], ownRequestId: null,
      requestCount: 0, shift }],
    pickupRequests: committed ? [{ id: "saved-request", kind: "pickup_request", status: "REQUESTED",
      hasConflict: false, conflictNote: null, createdAt: event.startsAt,
      user: { id: "test-student", name: "Test Student", primaryArea: "VIDEO" }, shift }] : [],
  } } }));
  await page.route("**/api/shift-assignments/pickup", async (route) => {
    submissions += 1;
    committed = true;
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "More schedule actions" }).click();
  await page.getByRole("menuitem", { name: "Trade Board", exact: true }).click();
  await page.getByRole("button", { name: "Claim shift", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Claim shift", exact: true }).click();
  await expect(page.getByText("The last action could not be confirmed", { exact: false })).toBeVisible();
  await expect(page.getByText("Test Student wants this slot", { exact: true })).toBeVisible();
  expect(submissions).toBe(1);
});

test("a failed refresh retains the complete crew and reports staleness", async ({ page }) => {
  await fixture(page);
  await expect(page.getByRole("button", { name: /Manage crew for/ }).first()).toBeVisible();
  await page.route("**/api/shift-groups?*", (route) => route.fulfill({ status: 503, json: { error: "Crew unavailable" } }));
  await page.getByRole("button", { name: "Retry schedule", exact: true }).click();
  await expect(page.getByText("Schedule may be out of date", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Manage crew for/ }).first()).toBeVisible();
});

test("a rejected call-time save keeps the form and the entered time", async ({ page }) => {
  await fixture(page);
  await page.getByRole("button", { name: /Manage crew for/ }).first().click();
  await page.getByRole("button", { name: "Set Student call time", exact: true }).click();
  await page.locator("#all-call-time-start").fill("2026-09-05T11:15");
  await page.route(`**/api/shift-groups/${group.id}/working-copy`, (route) => route.request().method() === "PATCH"
    ? route.fulfill({ status: 409, json: { error: "Crew changed in another session" } })
    : route.fulfill({ json: { data: editor } }));
  const rejected = page.waitForResponse((response) => response.request().method() === "PATCH" && response.status() === 409);
  await page.getByRole("button", { name: "Apply to Students", exact: true }).click();
  await rejected;
  await expect(page.getByText("Crew changed in another session", { exact: true }).first()).toBeVisible();
  // Wait out the close animation: an immediate visibility assertion can pass
  // while the old implementation is already dismissing this dialog.
  await page.waitForTimeout(400);
  await expect(page.getByRole("dialog", { name: "Set Student call time", exact: true })).toBeVisible();
  await expect(page.locator("#all-call-time-start")).toHaveValue("2026-09-05T11:15");
});

test("students see pending requests and temporary claim blockers", async ({ browser, viewport, baseURL }) => {
  test.skip(!process.env.SCHEDULE_STUDENT_STORAGE_STATE, "Requires an authenticated isolated student session");
  const context = await browser.newContext({ storageState: process.env.SCHEDULE_STUDENT_STORAGE_STATE, viewport, baseURL });
  const page = await context.newPage();
  try {
    await fixture(page);
    const me = await context.request.get("/api/me");
    const viewer = (await me.json()).user;
    expect(viewer.role).toBe("STUDENT");
    const shift = { ...slot, shiftGroup: { id: group.id, publishedAt: event.startsAt, event } };
    const reason = "Staff are updating this crew. Try again after the changes are released. If this continues, contact staff.";
    await page.route("**/api/shift-trades?*", (route) => route.fulfill({ json: { data: [], total: 0 } }));
    await page.route("**/api/schedule/open-work*", (route) => route.fulfill({ json: { data: {
      openShifts: [{ id: slot.id, kind: "open_shift", action: "none", canAct: false, reason,
        advisoryConflict: false, warnings: [], ownRequestId: null, requestCount: 0, shift }],
      pickupRequests: [{ id: "student-request", kind: "pickup_request", status: "REQUESTED",
        hasConflict: false, conflictNote: null, createdAt: event.startsAt,
        user: { id: viewer.id, name: viewer.name, primaryArea: "VIDEO" }, shift: { ...shift, id: "requested-slot" } }],
    } } }));
    await page.getByRole("button", { name: "Trade Board", exact: true }).click();
    await expect(page.getByText(reason, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Claim shift", exact: true })).toHaveCount(0);
    await expect(page.getByText("Waiting on Admin", { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: "test-results/schedule-student-blocked.png", fullPage: true });
  } finally {
    await context.close();
  }
});

test("an uncertain call-time save can be reviewed without closing the form", async ({ page }) => {
  await fixture(page);
  await page.getByRole("button", { name: /Manage crew for/ }).first().click();
  await page.getByRole("button", { name: "Set Student call time", exact: true }).click();
  await page.locator("#all-call-time-start").fill("2026-09-05T11:15");
  let submissions = 0;
  await page.route(`**/api/shift-groups/${group.id}/working-copy`, (route) => {
    if (route.request().method() === "PATCH") {
      submissions += 1;
      return route.abort("failed");
    }
    return route.fulfill({ json: { data: editor } });
  });
  await page.getByRole("button", { name: "Apply to Students", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Set Student call time", exact: true });
  await expect(dialog.getByText("Save was not confirmed.", { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "Review latest crew", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Apply to Students", exact: true })).toBeEnabled();
  await expect(page.locator("#all-call-time-start")).toHaveValue("2026-09-05T11:15");
  expect(submissions).toBe(1);
});
