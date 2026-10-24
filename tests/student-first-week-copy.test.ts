import { describe, expect, it } from "vitest";
import { welcomeNextSteps } from "@/app/(app)/welcome/WelcomeDone";

describe("student first-week copy", () => {
  it("tells a new student to sign in to the app with the account they just made", () => {
    const app = welcomeNextSteps("STUDENT").find((step) => step.title === "Get the iPhone app");
    expect(app?.detail).toMatch(/same email and password/i);
  });
});
