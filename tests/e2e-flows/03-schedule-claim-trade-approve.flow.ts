import { expect, test } from "@playwright/test";
import { apiAs, clickOpens, json, pageAs, seed } from "./helpers";

/**
 * Scheduling, approval-first: a student claims an open slot, an admin approves
 * it from the Schedule; the student who holds the other slot posts it for
 * trade, the teammate claims the trade, and the admin approves the trade.
 */
test("student claims an open shift, admin approves; trade posted, claimed and approved", async ({ browser, playwright }) => {
  const teammate = seed.users.teammate;
  const student = seed.users.student;
  const teammatePage = await pageAs(browser, "teammate");
  const adminPage = await pageAs(browser, "admin");

  await test.step("the teammate asks for the open Video slot", async () => {
    await teammatePage.goto("/schedule");
    await clickOpens(teammatePage.getByRole("button", { name: "Expand shifts" }), teammatePage.getByRole("button", { name: "Claim shift" }));
    await teammatePage.getByRole("button", { name: "Claim shift" }).click();
    // Approval-first: nothing is held until an admin says so.
    await expect(teammatePage.getByText("Request sent for Admin approval")).toBeVisible();
    const { data: mine } = await json((await apiAs(playwright, "teammate")).get("/api/my-shifts"));
    expect(JSON.stringify(mine)).not.toContain(seed.shifts.open);
  });

  await test.step("the admin approves the claim from the Schedule", async () => {
    await adminPage.goto("/schedule");
    await clickOpens(adminPage.getByRole("button", { name: "Expand shifts" }), adminPage.getByRole("button", { name: "Review 1 claim" }).first());
    const dialog = adminPage.getByRole("dialog");
    await clickOpens(adminPage.getByRole("button", { name: "Review 1 claim" }).first(), dialog);
    await expect(dialog.getByText(teammate.name)).toBeVisible();
    await dialog.getByRole("button", { name: "Approve" }).click();
    await expect(dialog).toBeHidden();
    await adminPage.reload();
    await clickOpens(adminPage.getByRole("button", { name: "Expand shifts" }), adminPage.getByRole("button", { name: "Crew size" }));
    await expect(adminPage.getByRole("button", { name: "Review 1 claim" })).toHaveCount(0);
    // Admins see the editable crew list, so the assignment shows as an Unassign control.
    await expect(adminPage.getByRole("button", { name: `Unassign ${teammate.name}` })).toBeVisible();
    await expect(adminPage.getByRole("row", { name: /2 of 2 shifts filled/ })).toBeVisible();
    // The game ends at 8 PM Madison time; rendered on the UTC server it must not become a two-day range.
    await expect(adminPage.getByText(/^[A-Z][a-z]{2} \d{1,2}-\d{1,2}$/)).toHaveCount(0);
    // The teammate sees it too, in Madison time.
    await teammatePage.reload();
    await clickOpens(teammatePage.getByRole("button", { name: "Expand shifts" }), teammatePage.getByRole("button", { name: `Open Video shift assigned to ${teammate.name}` }));
  });

  await test.step("only staff may approve", async () => {
    const studentApi = await apiAs(playwright, "student");
    const forbidden = await studentApi.patch(`/api/shift-assignments/${seed.shifts.heldAssignment}/approve`);
    expect(forbidden.status()).toBe(403);
  });

  const studentPage = await pageAs(browser, "student");
  let tradeId = "";
  await test.step("the student posts their held slot for trade", async () => {
    await studentPage.goto("/schedule");
    await clickOpens(studentPage.getByRole("button", { name: "Expand shifts" }), studentPage.getByRole("button", { name: "Trade", exact: true }));
    const dialog = studentPage.getByRole("dialog", { name: "Post this shift for trade" });
    await clickOpens(studentPage.getByRole("button", { name: "Trade", exact: true }), dialog);
    await dialog.getByRole("textbox").fill("Exam that night");
    await dialog.getByRole("button", { name: /^Post/ }).click();
    await expect(dialog).toBeHidden();
    const { data: trades } = await json((await apiAs(playwright, "student")).get("/api/shift-trades"));
    const trade = trades.find((entry: { shiftAssignmentId: string }) => entry.shiftAssignmentId === seed.shifts.heldAssignment);
    expect(trade?.status).toBe("OPEN");
    tradeId = trade.id;
  });

  await test.step("the teammate claims it on the Trades view", async () => {
    await teammatePage.goto("/schedule");
    await clickOpens(teammatePage.getByRole("radio", { name: "Trades view" }), teammatePage.getByText(`${student.name} can't work this`));
    const confirm = teammatePage.getByRole("alertdialog", { name: "Claim this shift?" });
    await clickOpens(teammatePage.getByRole("button", { name: "Claim", exact: true }).first(), confirm);
    await confirm.getByRole("button", { name: "Claim shift", exact: true }).click();
    await expect(confirm).toBeHidden();
    // The claim leaves Available and waits under Mine until an admin decides.
    await teammatePage.getByRole("tab", { name: "Mine" }).click();
    await expect(teammatePage.getByText(`Your claim on ${student.name}'s shift`)).toBeVisible();
    await expect(teammatePage.getByRole("button", { name: "Withdraw claim" })).toBeVisible();
  });

  await test.step("the admin approves the trade and the slot changes hands", async () => {
    await adminPage.goto("/schedule");
    await clickOpens(adminPage.getByRole("radio", { name: "Trades view" }), adminPage.getByText(`${teammate.name} wants ${student.name}'s shift`));
    await adminPage.getByRole("button", { name: "Approve", exact: true }).first().click();
    await expect(adminPage.getByText(`${teammate.name} wants ${student.name}'s shift`)).toHaveCount(0);
    const { data: open } = await json((await apiAs(playwright, "admin")).get("/api/shift-trades?status=OPEN"));
    expect(open.map((entry: { id: string }) => entry.id)).not.toContain(tradeId);
    const { data: mine } = await json((await apiAs(playwright, "teammate")).get("/api/my-shifts"));
    expect(JSON.stringify(mine)).toContain(seed.shifts.held);

    await clickOpens(adminPage.getByRole("radio", { name: "List view" }), adminPage.getByRole("button", { name: "Expand shifts" }));
    await clickOpens(adminPage.getByRole("button", { name: "Expand shifts" }), adminPage.getByRole("button", { name: "Crew size" }));
    await expect(adminPage.getByRole("button", { name: `Unassign ${student.name}` })).toHaveCount(0);
    await expect(adminPage.getByRole("button", { name: `Unassign ${teammate.name}` })).toHaveCount(2);
  });
});
