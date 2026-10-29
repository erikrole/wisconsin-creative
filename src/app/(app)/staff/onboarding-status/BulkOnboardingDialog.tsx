"use client";

import { useState } from "react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserAvatar } from "@/components/UserAvatar";
import { handleAuthRedirect, parseErrorMessage } from "@/lib/errors";
import { ONBOARDING_MANUAL_STEPS, ONBOARDING_STEP_LABELS, type OnboardingManualStep } from "@/lib/onboarding-checklist";

type Student = { id: string; name: string; avatarUrl: string | null; createdAt: string };

const NEW_WINDOW_MS = 30 * 86_400_000;

/** Tick one admin step for a whole new group of students at once. New accounts start selected. */
export function BulkOnboardingDialog({ students, onClose }: { students: Student[]; onClose: () => void }) {
  const [step, setStep] = useState<OnboardingManualStep>(ONBOARDING_MANUAL_STEPS[0]);
  const [selected, setSelected] = useState(() => new Set(students.filter((s) => Date.now() - new Date(s.createdAt).getTime() < NEW_WINDOW_MS).map((s) => s.id)));
  const [saving, setSaving] = useState(false);

  async function apply() {
    setSaving(true);
    const res = await fetch("/api/onboarding-checklist/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step, done: true, userIds: [...selected] }),
    });
    setSaving(false);
    if (handleAuthRedirect(res)) return;
    if (!res.ok) { toast.error(await parseErrorMessage(res, "Failed to update onboarding")); return; }
    toast.success(`${ONBOARDING_STEP_LABELS[step]} ticked for ${selected.size} ${selected.size === 1 ? "student" : "students"}`);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <div>
            <DialogTitle>Tick a step for a group</DialogTitle>
            <DialogDescription>Marks the step done on each selected student&apos;s checklist.</DialogDescription>
          </div>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <Select value={step} onValueChange={(value) => setStep(value as OnboardingManualStep)}>
            <SelectTrigger aria-label="Step"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ONBOARDING_MANUAL_STEPS.map((key) => <SelectItem key={key} value={key}>{ONBOARDING_STEP_LABELS[key]}</SelectItem>)}
            </SelectContent>
          </Select>
          <ul className="m-0 flex max-h-72 list-none flex-col overflow-y-auto p-0">
            {students.map((student) => (
              <li key={student.id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                  <Checkbox
                    checked={selected.has(student.id)}
                    onCheckedChange={(next) => setSelected((prev) => {
                      const copy = new Set(prev);
                      if (next === true) copy.add(student.id); else copy.delete(student.id);
                      return copy;
                    })}
                  />
                  <UserAvatar name={student.name} avatarUrl={student.avatarUrl} size="sm" />
                  <span className="min-w-0 truncate">{student.name}</span>
                </label>
              </li>
            ))}
          </ul>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={saving || selected.size === 0} onClick={apply}>Tick for {selected.size}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
