import { expect, test } from "@playwright/test";
import { apiAs, json, pageAs, seed } from "./helpers";
import { WRAPPED_UNLOCK_ISO } from "../../src/lib/wrapped/dates";

/**
 * Creative Wrapped opens for everyone on December 1. Before then students see
 * the countdown and admins can preview any person's recap; after, the recap
 * plays. The admin preview is also the only way to read someone else's recap.
 */
test("Wrapped opens on time: countdown or recap for students, preview for admins", async ({ browser, playwright }) => {
  const unlocked = Date.now() >= Date.parse(WRAPPED_UNLOCK_ISO);
  const studentPage = await pageAs(browser, "student");
  const adminPage = await pageAs(browser, "admin");

  await test.step(unlocked ? "the student's recap plays" : "the student sees the countdown", async () => {
    await studentPage.goto("/wrapped");
    if (unlocked) {
      await expect(studentPage.getByRole("heading", { level: 1 })).not.toHaveText("Opens December 1");
    } else {
      await expect(studentPage.getByRole("heading", { name: "Opens December 1" })).toBeVisible();
      await expect(studentPage.getByText(/\d+ days? to go|Opens tomorrow|Opens today/)).toBeVisible();
    }
    const api = await apiAs(playwright, "student");
    const own = await json(api.get("/api/wrapped"));
    expect(own.data.status).toBe(unlocked ? "ready" : "locked");
    // Students cannot peek early or at anyone else.
    expect((await api.get("/api/wrapped?preview=1")).status()).toBe(403);
    expect((await api.get(`/api/wrapped?userId=${seed.users.teammate.id}`)).status()).toBe(403);
  });

  await test.step("the admin previews a student's recap", async () => {
    await adminPage.goto("/wrapped");
    await expect(adminPage.getByRole("heading", { level: 1 })).not.toHaveText("Opens December 1");
    await expect(adminPage.getByRole("combobox", { name: "Preview Wrapped as" })).toBeVisible();
    const api = await apiAs(playwright, "admin");
    const theirs = await json(api.get(`/api/wrapped?userId=${seed.users.student.id}`));
    expect(theirs.data.status).toBe("ready");
    expect(theirs.data.preview).toBe(true);
    // The student's gear checkout from the reservation flow counts in their recap.
    expect(JSON.stringify(theirs.data.recap)).toMatch(/"id":"gear"/);
  });
});
