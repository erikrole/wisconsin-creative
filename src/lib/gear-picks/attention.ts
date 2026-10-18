import type { GearPicksAdminResponse } from "./types";

export type AttentionItem = {
  key: string;
  tone: "red" | "amber" | "blue";
  text: string;
  /** In-page anchor to the section that fixes it. */
  href: string;
};

/** What an admin should look at first on the UA results, most urgent first. */
export function gearAttentionItems(data: Pick<GearPicksAdminResponse, "cycle" | "summary" | "budget" | "students">): AttentionItem[] {
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
  return items;
}
