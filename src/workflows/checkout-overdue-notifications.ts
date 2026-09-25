import { sleep } from "workflow";
import {
  getCheckoutEscalationStageTiming,
  processCheckoutEscalationStage,
} from "@/lib/services/notifications";
import {
  CHECKOUT_ESCALATION_STAGE_TYPES,
  type CheckoutEscalationStageType,
} from "@/lib/checkout-escalation-policy";
import { recordJobRun } from "@/lib/services/job-runs";

export async function checkoutOverdueNotificationsWorkflow(
  bookingId: string,
  expectedEndsAtIso: string,
) {
  "use workflow";

  const results = [];
  for (const stageType of CHECKOUT_ESCALATION_STAGE_TYPES) {
    const result = await runCheckoutEscalationStage(
      bookingId,
      expectedEndsAtIso,
      stageType,
    );
    results.push(result);
    if (result.status === "superseded" || result.status === "closed") break;
  }
  return results;
}

async function runCheckoutEscalationStage(
  bookingId: string,
  expectedEndsAtIso: string,
  stageType: CheckoutEscalationStageType,
) {
  "use workflow";

  for (;;) {
    const timing = await getCheckoutEscalationStageTimingStep(
      bookingId,
      expectedEndsAtIso,
      stageType,
    );
    if (timing.status !== "scheduled") return timing;

    const triggerAt = new Date(timing.triggerAt);
    if (triggerAt.getTime() > Date.now()) await sleep(triggerAt);

    const result = await processCheckoutEscalationStageStep(
      bookingId,
      expectedEndsAtIso,
      stageType,
      timing.triggerAt,
    );
    if (result.status !== "not_eligible") return result;
  }
}

async function getCheckoutEscalationStageTimingStep(
  bookingId: string,
  expectedEndsAtIso: string,
  stageType: CheckoutEscalationStageType,
) {
  "use step";
  return getCheckoutEscalationStageTiming({
    bookingId,
    expectedEndsAt: new Date(expectedEndsAtIso),
    stageType,
  });
}

async function processCheckoutEscalationStageStep(
  bookingId: string,
  expectedEndsAtIso: string,
  stageType: CheckoutEscalationStageType,
  triggerAtIso: string,
) {
  "use step";
  const dueAt = new Date(triggerAtIso);
  try {
    const result = await processCheckoutEscalationStage({
      bookingId,
      expectedEndsAt: new Date(expectedEndsAtIso),
      stageType,
    });
    await recordJobRun({
      job: "checkout_escalation",
      outcome: result.status === "not_eligible" ? "skipped" : "succeeded",
      dueAt,
      detail: stageType,
    });
    return result;
  } catch (error) {
    await recordJobRun({ job: "checkout_escalation", outcome: "failed", dueAt, detail: stageType });
    throw error;
  }
}
