import { GEAR_CATALOG } from "./catalog";
import { buildHandoutBoard } from "./handout";
import { buildOrderPlan } from "./order";
import { orderPhase, receivingRows } from "./receiving";
import type { GearPicksAdminResponse } from "./types";

type AttentionInput = Pick<GearPicksAdminResponse, "cycle" | "summary" | "budget" | "students"> &
  Partial<Pick<GearPicksAdminResponse, "participants" | "order" | "receipts" | "handouts">>;

export type AttentionItem = {
  key: string;
  tone: "red" | "amber" | "blue";
  text: string;
  /** In-page anchor to the section that fixes it. */
  href: string;
};

/** What an admin should look at first on the UA results, most urgent first. */
export function gearAttentionItems(data: AttentionInput, now: Date = new Date()): AttentionItem[] {
  const items: AttentionItem[] = [];
  const { budget, summary, students, cycle } = data;
  const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

  if (budget.remainingCents < 0) {
    items.push({ key: "over", tone: "red", text: "Planned spend is over the budget", href: "#allotment-overview" });
  }
  const needingSize = students.filter((student) => student.needsSize).length;
  if (needingSize > 0) {
    items.push({
      key: "sizes",
      tone: "amber",
      text: `${plural(needingSize, "student has", "students have")} no size on file`,
      href: "#gear-admin-students",
    });
  }
  if (!budget.confirmed) {
    items.push({ key: "budget", tone: "amber", text: "The budget is still a placeholder", href: "#allotment-overview" });
  }
  if (!cycle.launchedAt) {
    items.push({ key: "launch", tone: "blue", text: "Picks aren’t open to staff yet", href: "#gear-admin-access" });
  } else {
    const waiting = summary.draftCount + summary.notStartedCount;
    if (waiting > 0) {
      items.push({
        key: "picks",
        tone: "blue",
        text: `${plural(waiting, "staff member hasn’t", "staff members haven’t")} submitted picks`,
        href: "#gear-admin-people",
      });
    }
  }
  if (students.length === 0) {
    items.push({ key: "students", tone: "blue", text: "No students are on the list yet", href: "#gear-admin-students" });
  }
  items.push(...orderAttentionItems(data, now, plural));
  return items;
}

/** Order, receiving and handout follow-ups. Skipped when the page data does not carry them. */
function orderAttentionItems(data: AttentionInput, now: Date, plural: (count: number, one: string, many: string) => string): AttentionItem[] {
  const { participants, order, receipts, handouts, students, cycle } = data;
  if (!participants || !order || !receipts || !handouts) return [];
  const items: AttentionItem[] = [];
  const plan = buildOrderPlan(participants, GEAR_CATALOG.kits, students);
  const rows = receivingRows(plan, receipts);
  const phase = orderPhase(order, rows);
  const picksClosed = !cycle.isOpen || (cycle.deadline !== null && new Date(cycle.deadline) <= now);

  if (plan.missingSizePeople.length > 0 && phase === "PLANNING") {
    items.push({
      key: "order-sizes",
      tone: "amber",
      text: `${plural(plan.missingSizePeople.length, "person needs", "people need")} a size before the order`,
      href: "#order",
    });
  }
  if (picksClosed && !order.placedAt) {
    items.push({ key: "order-not-placed", tone: "amber", text: "Picks are closed and the order isn’t recorded yet", href: "#order" });
  }
  if (order.placedAt && order.expectedAt && new Date(order.expectedAt) < now) {
    const late = rows.filter((row) => row.outstanding > 0).reduce((sum, row) => sum + row.outstanding, 0);
    if (late > 0) {
      items.push({ key: "order-late", tone: "red", text: `${plural(late, "piece is", "pieces are")} past the expected arrival date`, href: "#receiving" });
    }
  }
  if (phase === "RECEIVING" || phase === "RECEIVED") {
    const waiting = buildHandoutBoard(participants, students, handouts, GEAR_CATALOG.kits).filter(
      (person) => person.status !== "DONE" && person.pieces.some((piece) => !piece.handed && !piece.blocked),
    ).length;
    if (waiting > 0) {
      items.push({ key: "handout", tone: "blue", text: `${plural(waiting, "person is", "people are")} waiting on gear to be handed out`, href: "#handout" });
    }
  }
  return items;
}
