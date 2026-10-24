"use client";

import { useState } from "react";
import type { SportConfig } from "./types";
import { SPORT_AUTO_ASSIGN_POLICY_LABELS } from "@/lib/sport-auto-assign-policy";
import type { SportSetupEntry, SportSetupResponse } from "@/lib/services/sport-setup";
import { AREAS, AREA_LABELS, SPORT_GROUPS } from "./types";
import { formatMinutes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { ChevronRightIcon, PlaneIcon, SlidersHorizontalIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsGroup } from "../_components/SettingsGroup";

/** Call-time options: 0, 15, 30, 45, 60 ... 240 minutes */
const CALL_TIME_OPTIONS = [0, 15, 30, 45, 60, 90, 120, 150, 180, 210, 240];

type CountField = "homeStaffCount" | "homeStudentCount" | "awayStaffCount" | "awayStudentCount";

function coverageInputName(sportCode: string, area: string, field: string): string {
  return `sportCoverage.${sportCode}.${area}.${field}`;
}

/** Small number field used in the crew grids. */
export function CrewCount({
  id,
  value,
  onChange,
  disabled,
  label,
}: {
  id?: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <Input
      id={id}
      name={id}
      type="number"
      inputMode="numeric"
      min={0}
      max={20}
      value={value}
      onChange={(e) => onChange(Math.max(0, parseInt(e.target.value) || 0))}
      className="h-9 w-14 px-1 text-center tabular-nums"
      disabled={disabled}
      aria-label={label}
    />
  );
}

/** "Students arrive [60 min] before and stay [60 min] after." */
export function CallTimeRow({
  start,
  end,
  onChange,
  disabled,
}: {
  start: number;
  end: number;
  onChange: (field: "shiftStartOffset" | "shiftEndOffset", value: number) => void;
  disabled?: boolean;
}) {
  const picker = (field: "shiftStartOffset" | "shiftEndOffset", value: number, label: string) => (
    <Select value={String(value)} onValueChange={(v) => onChange(field, parseInt(v))} disabled={disabled}>
      <SelectTrigger size="sm" className="w-[104px]" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {CALL_TIME_OPTIONS.map((m) => (
          <SelectItem key={m} value={String(m)}>{formatMinutes(m)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>Students arrive</span>
        {picker("shiftStartOffset", start, "Student call time before start")}
        <span>early and stay</span>
        {picker("shiftEndOffset", end, "Student call time after end")}
        <span>after.</span>
      </div>
      <p className="m-0 text-[13px] text-muted-foreground">Staff and collaborators use the event start and end.</p>
    </div>
  );
}

export default function ShiftConfigTable({
  configs,
  saving,
  onToggleActive,
  onUpdateShift,
  onUpdateOffset,
  dirtyCodes,
  onSave,
  onDiscard,
  sportSetup,
  onOpenSetup,
}: {
  configs: SportConfig[];
  sportSetup: SportSetupResponse | null;
  onOpenSetup: (sportCode: string) => void;
  saving: string | null;
  onToggleActive: (sportCode: string) => void;
  onUpdateShift: (sportCode: string, area: string, field: CountField, value: number) => void;
  onUpdateOffset: (sportCode: string, field: "shiftStartOffset" | "shiftEndOffset", value: number) => void;
  dirtyCodes: Set<string>;
  onSave: (sportCode: string) => void;
  onDiscard: (sportCode: string) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  function getConfig(sportCode: string) {
    return configs.find((c) => c.sportCode === sportCode);
  }

  /** For grouped sports, use the first code's config as representative */
  function getGroupConfig(codes: string[]) {
    for (const code of codes) {
      const c = getConfig(code);
      if (c) return c;
    }
    return null;
  }

  function isGroupActive(codes: string[]) {
    return codes.some((c) => getConfig(c)?.active);
  }

  function getSetup(sportCode: string): SportSetupEntry | null {
    return sportSetup?.sports.find((entry) => entry.sportCode === sportCode) ?? null;
  }

  function getShiftCount(sportCode: string, area: string, field: CountField): number {
    const config = getConfig(sportCode);
    if (!config) return 0;
    const sc = config.shiftConfigs.find((s) => s.area === area);
    if (!sc) return 0;
    if (field === "homeStudentCount") return sc.homeStudentCount ?? sc.homeCount ?? 0;
    if (field === "awayStudentCount") return sc.awayStudentCount ?? sc.awayCount ?? 0;
    return sc[field] ?? 0;
  }

  function crewTotal(sportCode: string, side: "home" | "away") {
    return AREAS.reduce(
      (sum, area) =>
        sum +
        getShiftCount(sportCode, area, side === "home" ? "homeStaffCount" : "awayStaffCount") +
        getShiftCount(sportCode, area, side === "home" ? "homeStudentCount" : "awayStudentCount"),
      0,
    );
  }

  function toggleOpen(label: string) {
    setOpen((previous) => {
      const next = new Set(previous);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  return (
    <SettingsGroup
      title="Sports"
      description="Turn a sport on to create shifts for its games, then set the crew each game needs."
    >
      {SPORT_GROUPS.map((group) => {
        const primaryCode = group.codes[0]!; // every SPORT_GROUP has at least one code
        const config = getGroupConfig(group.codes);
        const active = isGroupActive(group.codes);
        const dirty = group.codes.some((code) => dirtyCodes.has(code));
        const expanded = active && (dirty || open.has(group.label));
        const rowSaving = saving?.startsWith(primaryCode) ?? false;
        const panelId = `sport-panel-${primaryCode}`;

        return (
          <div key={group.label} className={cn(!active && "bg-muted/20")}>
            <div className="flex items-center gap-3 px-4 py-3">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-start gap-2 text-left disabled:cursor-default"
                onClick={() => toggleOpen(group.label)}
                disabled={!active}
                aria-expanded={active ? expanded : undefined}
                aria-controls={active ? panelId : undefined}
              >
                <ChevronRightIcon
                  className={cn(
                    "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
                    expanded && "rotate-90",
                    !active && "invisible",
                  )}
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-bold text-foreground">{group.label}</span>
                    {group.codes.length > 1 ? (
                      <span className="text-[13px] text-muted-foreground">{group.codes.join(" + ")}</span>
                    ) : null}
                    {dirty ? <span className="text-[13px] font-bold text-[var(--orange-text)]">Unsaved</span> : null}
                  </span>
                  <span className="mt-0.5 block text-[13px] text-muted-foreground">
                    {active
                      ? `${crewTotal(primaryCode, "home")} home · ${crewTotal(primaryCode, "away")} away · call ${formatMinutes(config?.shiftStartOffset ?? 60)} early`
                      : "Off. No shifts are created for its games."}
                  </span>
                </span>
              </button>
              <Switch
                checked={active}
                onCheckedChange={() => onToggleActive(primaryCode)}
                disabled={saving?.endsWith("-toggle") ?? false}
                aria-label={`${group.label} shift generation`}
              />
            </div>

            {sportSetup && active ? (
              <div className="flex flex-col gap-1 pb-3 pl-10 pr-4">
                {group.codes.map((code) => {
                  const setup = getSetup(code);
                  const travel = setup
                    ? [...setup.staff, ...setup.students].filter((member) => member.defaultTraveler).length
                    : 0;
                  const rosterSize = setup ? setup.staff.length + setup.students.length : 0;
                  return (
                    <div key={code} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
                      {group.codes.length > 1 ? (
                        <span className="min-w-12 font-bold">{code}</span>
                      ) : null}
                      <span>
                        Auto assign:{" "}
                        <span className={cn("font-bold", setup?.policy === "HOLD" ? "text-[var(--orange-text)]" : "text-foreground")}>
                          {SPORT_AUTO_ASSIGN_POLICY_LABELS[setup?.policy ?? "FULL_CREW"]}
                        </span>
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{rosterSize === 0 ? "Nobody on the roster" : `${rosterSize} on the roster`}</span>
                      {travel > 0 ? (
                        <span className="inline-flex items-center gap-1">
                          <span aria-hidden="true">·</span>
                          <PlaneIcon className="size-3" aria-hidden="true" />
                          {travel} travel
                        </span>
                      ) : null}
                      <Button
                        type="button"
                        variant="link"
                        className="h-auto p-0 text-[13px]"
                        onClick={() => onOpenSetup(code)}
                      >
                        <SlidersHorizontalIcon data-icon="inline-start" className="size-3.5" />
                        Set up
                      </Button>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {expanded && (
              <div id={panelId} className="flex flex-col gap-4 border-t border-border bg-muted/20 px-4 py-4 sm:pl-10">
                <div className="overflow-x-auto">
                  <table className="border-collapse text-sm [&_td]:py-1 [&_td]:pr-2 [&_th]:pb-1.5 [&_th]:pr-2 [&_th]:text-left [&_th]:text-[13px] [&_th]:font-bold [&_th]:text-muted-foreground">
                    <thead>
                      <tr>
                        <th className="min-w-32" rowSpan={2}>Minimum crew</th>
                        <th colSpan={2} className="!text-center">Home game</th>
                        <th className="w-4" aria-hidden="true" />
                        <th colSpan={2} className="!text-center">Away game</th>
                      </tr>
                      <tr className="[&_th]:!font-normal">
                        <th className="!text-center">Staff</th>
                        <th className="!text-center">Students</th>
                        <th aria-hidden="true" />
                        <th className="!text-center">Staff</th>
                        <th className="!text-center">Students</th>
                      </tr>
                    </thead>
                    <tbody>
                      {AREAS.map((area) => (
                        <tr key={area}>
                          <td className="font-bold">{AREA_LABELS[area]}</td>
                          {(["homeStaffCount", "homeStudentCount", null, "awayStaffCount", "awayStudentCount"] as const).map((field, index) =>
                            field === null ? (
                              <td key={`gap-${index}`} aria-hidden="true" />
                            ) : (
                              <td key={field} className="text-center">
                                <CrewCount
                                  id={coverageInputName(primaryCode, area, field)}
                                  value={getShiftCount(primaryCode, area, field)}
                                  onChange={(value) => onUpdateShift(primaryCode, area, field, value)}
                                  disabled={rowSaving}
                                  label={`${group.label} ${AREA_LABELS[area]} ${field.startsWith("home") ? "home" : "away"} ${field.endsWith("StaffCount") ? "Staff" : "Student"} count`}
                                />
                              </td>
                            ),
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <CallTimeRow
                  start={config?.shiftStartOffset ?? 60}
                  end={config?.shiftEndOffset ?? 60}
                  onChange={(field, value) => onUpdateOffset(primaryCode, field, value)}
                  disabled={rowSaving}
                />

                {dirty ? (
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={Boolean(saving)}
                      onClick={() => onDiscard(primaryCode)}
                    >
                      Discard
                    </Button>
                    <Button
                      type="button"
                      disabled={Boolean(saving)}
                      loading={saving === `${primaryCode}-save`}
                      onClick={() => onSave(primaryCode)}
                    >
                      {group.codes.length > 1 ? `Save for ${group.codes.join(" + ")}` : "Save"}
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        );
      })}
    </SettingsGroup>
  );
}
