import { expect, test, type Locator, type Page } from "@playwright/test";

const role = process.env.PLAYWRIGHT_ROLE?.trim().toUpperCase();
const hasCredentials = Boolean(
  process.env.PLAYWRIGHT_EMAIL?.trim() &&
  process.env.PLAYWRIGHT_PASSWORD &&
  (role === "STUDENT" || role === "STAFF" || role === "ADMIN"),
);

type RuntimeErrors = {
  console: string[];
  page: string[];
};

function watchRuntimeErrors(page: Page): RuntimeErrors {
  const errors: RuntimeErrors = { console: [], page: [] };
  page.on("console", (message) => {
    if (message.type() === "error") errors.console.push(message.text());
  });
  page.on("pageerror", (error) => errors.page.push(error.message));
  return errors;
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(
      () => page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
      { message: "Document must not overflow the viewport horizontally" },
    )
    .toBeLessThanOrEqual(1);
}

async function expectKeyboardReachable(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  await page.locator("body").focus();

  for (let step = 0; step < 80; step += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }

  throw new Error("Primary route control was not reachable with the Tab key");
}

const LOCAL_PLATFORM_CONSOLE_NOISE = [
  /Failed to load resource: the server responded with a status of 404 \(Not Found\)/,
  /Refused to execute script from .*\/_vercel\/(?:insights|speed-insights)\/script\.js/,
];

function expectRuntimeClean(errors: RuntimeErrors, allowedConsoleMessages: RegExp[] = []) {
  expect(errors.page, "The page emitted an uncaught exception").toEqual([]);
  const ignoredConsoleMessages = [...LOCAL_PLATFORM_CONSOLE_NOISE, ...allowedConsoleMessages];
  const unexpectedConsoleErrors = errors.console.filter(
    (message) => !ignoredConsoleMessages.some((pattern) => pattern.test(message)),
  );
  expect(unexpectedConsoleErrors, "The page emitted an unexpected console error").toEqual([]);
}

function primaryControl(page: Page, path: string): Locator {
  switch (path) {
    case "/":
      return page.getByRole("button", { name: "Refresh dashboard" });
    case "/bookings":
      return page.getByRole("textbox", { name: "Search bookings by title or requester" });
    case "/items":
      return page.getByRole("textbox", { name: "Search items" });
    case "/search":
      return page.getByRole("textbox", { name: "Search items, checkouts, reservations, users, and guides" });
    case "/schedule":
      return role === "STUDENT"
        ? page.getByRole("button", { name: /Trade Board/ })
        : page.getByRole("button", { name: "More schedule actions" });
    case "/settings":
      return page.getByRole("button", { name: "Search settings" });
    case "/settings/profile":
      return page.getByRole("textbox", { name: "Name", exact: true });
    default:
      throw new Error(`No primary control is defined for ${path}`);
  }
}

const routes = [
  { path: "/", heading: "Dashboard" },
  { path: "/bookings", heading: "Bookings" },
  { path: "/items", heading: "Items" },
  { path: "/search", heading: "Search" },
  { path: "/schedule", heading: "Schedule" },
  { path: "/settings", heading: "Settings" },
  { path: "/settings/profile", heading: "Profile" },
] as const;

test.skip(
  !hasCredentials,
  "Set PLAYWRIGHT_EMAIL, PLAYWRIGHT_PASSWORD, and PLAYWRIGHT_ROLE to run authenticated smoke locally.",
);

for (const route of routes) {
  test(`${route.path} renders without runtime or responsive failures`, async ({ page }) => {
    const errors = watchRuntimeErrors(page);
    await page.goto(route.path);

    await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
    await expect(page.getByRole("heading", { name: route.heading, exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectKeyboardReachable(page, primaryControl(page, route.path));
    expectRuntimeClean(errors);
  });
}

test("Settings overview matches the authenticated role", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await page.goto("/settings");

  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Profile/ }).first()).toBeVisible();

  if (role === "STUDENT") {
    await expect(page.getByRole("link", { name: /Registration access/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Audit log/ })).toHaveCount(0);
  } else if (role === "STAFF") {
    await expect(page.getByRole("link", { name: /Registration access/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Audit log/ })).toHaveCount(0);
  } else {
    await expect(page.getByRole("link", { name: /Registration access/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Audit log/ }).first()).toBeVisible();
  }

  expectRuntimeClean(errors);
});

test("a direct role-restricted Settings URL fails closed", async ({ page }) => {
  test.skip(role === "ADMIN", "An admin identity has no role-restricted Settings section.");
  const errors = watchRuntimeErrors(page);
  const path = role === "STUDENT" ? "/settings/allowed-emails" : "/settings/audit";
  const restrictedLabel = role === "STUDENT" ? "Allowed Emails" : "Audit Log";

  await page.goto(path);

  await expect(page.getByText("Access denied", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: restrictedLabel, exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Back to Settings" })).toBeVisible();
  expectRuntimeClean(errors);
});

test("Search keeps available results visible when one read source fails", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await page.route("**/api/assets?*", (route) => route.fulfill({ status: 503, body: "unavailable" }));
  for (const endpoint of ["checkouts", "reservations", "users", "resources"]) {
    await page.route(`**/api/${endpoint}?*`, (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [] }),
    }));
  }
  await page.goto("/search?q=settings");

  await expect(page.getByText("Some result types did not load", { exact: true })).toBeVisible();
  await expect(page.getByText("Showing available matches.", { exact: false })).toBeVisible();
  expectRuntimeClean(errors, [/status of 503/]);
});

test("Items names partial bootstrap failures without hiding healthy controls", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await page.route("**/api/items-page-init", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      data: {
        user: { role },
        locations: [],
        departments: [],
        categories: [],
        brands: [],
        kits: [],
      },
      partialFailures: ["categories"],
    }),
  }));
  await page.goto("/items");

  await expect(page.getByText("Some item controls did not load", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Search items" })).toBeVisible();
  if (role === "STUDENT") {
    await expect(page.getByRole("button", { name: "Add item", exact: true })).toHaveCount(0);
  } else {
    await expect(page.getByRole("button", { name: "Add item", exact: true })).toBeDisabled();
  }
  expectRuntimeClean(errors);
});

test("Items fails staff controls closed, then restores the authenticated role after retry", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  let bootstrapRequests = 0;
  let recoverControls = false;
  await page.route("**/api/items-page-init", async (route) => {
    bootstrapRequests += 1;
    if (!recoverControls) {
      await route.fulfill({ status: 503, body: "unavailable" });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          user: { role },
          locations: [{ id: "location-smoke", name: "Smoke location" }],
          departments: [{ id: "department-smoke", name: "Smoke department" }],
          categories: [{ id: "category-smoke", name: "Smoke category", parentId: null }],
          brands: ["Smoke brand"],
          kits: [{ id: "kit-smoke", name: "Smoke kit" }],
        },
        partialFailures: [],
      }),
    });
  });
  await page.goto("/items");

  await expect(page.getByText("Item controls did not load", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add item", exact: true })).toHaveCount(0);
  recoverControls = true;
  await page.getByRole("button", { name: "Retry controls" }).click();

  await expect(page.getByText("Item controls did not load", { exact: true })).toHaveCount(0);
  await expect.poll(() => bootstrapRequests).toBeGreaterThanOrEqual(2);
  if (role === "STUDENT") {
    await expect(page.getByRole("button", { name: "Add item", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Import", exact: true })).toHaveCount(0);
  } else {
    await expect(page.getByRole("button", { name: "Add item", exact: true })).toBeEnabled();
    const fillGaps = page.getByRole("button", { name: "Fill gaps", exact: true });
    if ((page.viewportSize()?.width ?? 0) < 640) {
      await expect(fillGaps).toHaveCount(0);
    } else {
      await expect(fillGaps).toBeEnabled();
    }
    await expect(page.getByRole("link", { name: "Import", exact: true })).toBeVisible();
  }
  expectRuntimeClean(errors, [/status of 503/]);
});

test("Dashboard preserves trusted counts through failure and manual refresh", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  let statsMode: "trusted" | "failed" | "recovered" = "trusted";
  const statsPayload = (overdue: number) => ({
    role,
    stats: { checkedOut: overdue + 3, overdue, reserved: 4, dueToday: 2 },
    overdueCount: overdue,
    myCheckoutsTotal: 3,
    myOverdueCount: overdue,
    myDueTodayCount: 1,
    teamCheckoutsTotal: 5,
    teamCheckoutsOverdue: overdue,
    teamReservationsTotal: 4,
    pendingPickupTotal: 2,
    staleReservationTotal: 1,
    myShiftsCount: 6,
    myShiftsTodayCount: 2,
  });
  await page.route("**/api/dashboard", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      data: {
        role,
        stats: statsPayload(7).stats,
        overdueCount: 7,
      },
    }),
  }));
  await page.route("**/api/dashboard/stats", (route) => {
    const failed = statsMode === "failed";
    const overdue = statsMode === "recovered" ? 2 : failed ? 0 : 7;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: statsPayload(overdue),
        partialFailures: failed ? ["counts"] : [],
      }),
    });
  });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  const overdueCard = page.locator('a[href="/checkouts?filter=overdue"]').first();
  await expect(overdueCard).toContainText("7");

  statsMode = "failed";
  await page.getByRole("button", { name: "Refresh dashboard" }).click();
  await expect(page.getByText(/Counts (?:retrying|may be stale)/)).toBeVisible();
  await expect(overdueCard).toContainText("7");

  statsMode = "recovered";
  await page.getByRole("button", { name: "Refresh dashboard" }).click();
  await expect(overdueCard).toContainText("2");
  await expect(page.getByText(/Counts (?:retrying|may be stale)/)).toHaveCount(0);
  expectRuntimeClean(errors);
});
