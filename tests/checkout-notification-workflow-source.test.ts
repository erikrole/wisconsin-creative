import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("checkout notification workflow source contract", () => {
  it("schedules the durable workflow anywhere return Live Activity timing is scheduled", () => {
    const scheduler = source("src/lib/live-activity-workflow.ts");
    expect(scheduler).toContain("scheduleCheckoutOverdueNotifications(args)");
  });

  it("rechecks the expected due date and processes stages through durable steps", () => {
    const workflow = source("src/workflows/checkout-overdue-notifications.ts");
    const service = source("src/lib/services/notifications.ts");
    expect(workflow).toContain('"use workflow"');
    expect(workflow).toContain('"use step"');
    expect(workflow).toContain("expectedEndsAtIso");
    expect(service).toContain("booking.endsAt.getTime() !== args.expectedEndsAt.getTime()");
    expect(service).toContain('status: "collapsed"');
  });
});
