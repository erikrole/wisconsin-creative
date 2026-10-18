"use client";

import { useState } from "react";
import { Trash2Icon } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import type { GearPickAdminStudent } from "@/lib/gear-picks/types";

type Change = { action: "addStudent"; userId: string } | { action: "removeStudent"; studentId: string };

type Props = {
  students: GearPickAdminStudent[];
  candidates: { id: string; name: string }[];
  studentKitCents: number;
  pending: boolean;
  onApply: (change: Change, success: string) => Promise<boolean>;
};

const usd = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const CARD = "overflow-hidden rounded-[14px] border border-[#E8E8EC] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:border-white/10 dark:bg-card";
const HEAD = "text-[11px] font-bold uppercase tracking-[0.09em] text-[#6B6F7A] dark:text-muted-foreground";
const ROW = "grid grid-cols-[minmax(160px,1.4fr)_100px_100px_110px_44px] items-center gap-3.5 border-b border-[#F0F1F3] px-5 py-3 text-sm last:border-b-0 dark:border-white/10";

/** Students on the UA roster: sizes come from their profile, and anyone missing one is flagged. */
export function StudentsSection({ students, candidates, studentKitCents, pending, onApply }: Props) {
  const confirm = useConfirm();
  const [filter, setFilter] = useState<"all" | "needs">("all");
  const [userId, setUserId] = useState("");
  const needing = students.filter((student) => student.needsSize);
  const shown = filter === "needs" ? needing : students;

  return (
    <section aria-labelledby="gear-admin-students" className="mb-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <h2 id="gear-admin-students" className="text-[22px] font-extrabold tracking-[-0.03em]">Students</h2>
          <span className="rounded-md bg-[#EEF1FD] px-2 py-0.5 text-xs font-bold text-[#3E63DD] dark:bg-[#3E63DD]/20 dark:text-[#AEBDF5]">
            Student kit · {usd(studentKitCents)} each
          </span>
        </div>
        <div className="flex gap-0.5 rounded-[10px] bg-[#F0F1F3] p-[3px] dark:bg-white/10" role="group" aria-label="Filter students">
          {([["all", `All ${students.length}`], ["needs", `Needs size ${needing.length}`]] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              className={`rounded-lg px-3 py-1.5 text-[13px] font-bold ${filter === key ? "bg-white shadow-[0_1px_2px_rgba(0,0,0,0.08)] dark:bg-card" : "text-[#60646C] dark:text-muted-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Combobox
          options={candidates.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
          value={userId}
          onValueChange={setUserId}
          placeholder="Add a student…"
          searchPlaceholder="Search students"
          emptyMessage="No matching active students."
          className="sm:max-w-xs"
        />
        <Button
          className="min-h-10"
          disabled={pending || !userId}
          onClick={async () => {
            const name = candidates.find((candidate) => candidate.id === userId)?.name ?? "The student";
            if (await onApply({ action: "addStudent", userId }, `${name} was added to the student list.`)) setUserId("");
          }}
        >
          Add student
        </Button>
      </div>

      {students.length === 0 ? (
        <div className={`${CARD} px-5 py-8 text-center text-sm text-[#60646C] dark:text-muted-foreground`}>
          No students on the list yet. Add the students who get a kit this year.
        </div>
      ) : (
        <div className={`${CARD} overflow-x-auto`}>
          <div className="min-w-[640px]">
            <div className={`${ROW} bg-[#FAFAFB] dark:bg-white/5`}>
              <span className={HEAD}>Student</span>
              <span className={HEAD}>Top size</span>
              <span className={HEAD}>Shoe size</span>
              <span className={`${HEAD} text-right`}>Status</span>
              <span className="sr-only">Remove</span>
            </div>
            {shown.length === 0 && (
              <div className="px-5 py-6 text-center text-sm text-[#60646C] dark:text-muted-foreground">Everyone has a size.</div>
            )}
            {shown.map((student) => (
              <div key={student.id} className={ROW}>
                <span className="font-bold">
                  {student.user.name}
                  {!student.user.active && <span className="ml-2 text-xs font-normal text-[#8B8D98]">Inactive</span>}
                </span>
                <SizeCell value={student.topSize} />
                <SizeCell value={student.shoeSize} />
                <span className={`text-right font-mono text-xs ${student.needsSize ? "text-[#AB6400]" : "text-[#218358]"}`}>
                  {student.needsSize ? "Needs size" : "Ready"}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-9"
                  disabled={pending}
                  aria-label={`Remove ${student.user.name} from the student list`}
                  onClick={async () => {
                    const ok = await confirm({
                      title: `Remove ${student.user.name}?`,
                      message: "They will no longer get a student kit this year. The change is recorded in the audit log.",
                      confirmLabel: "Remove",
                      variant: "danger",
                    });
                    if (ok) await onApply({ action: "removeStudent", studentId: student.id }, `${student.user.name} was removed from the student list.`);
                  }}
                >
                  <Trash2Icon className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="mt-2 text-xs text-[#8B8D98]">Sizes come from each student’s profile. Students fill them in there.</p>
    </section>
  );
}

function SizeCell({ value }: { value: string | null }) {
  return value ? (
    <span className="font-mono text-[13px]">{value}</span>
  ) : (
    <span className="w-fit rounded-lg border border-dashed border-[#E5B84A] bg-[#FFFBEA] px-2.5 py-1 text-[13px] font-bold text-[#AB6400] dark:bg-[#AB6400]/10">Missing</span>
  );
}
