"use client";

import type { SportConfig } from "./types";
import { SPORT_AUTO_ASSIGN_POLICY_LABELS } from "@/lib/sport-auto-assign-policy";
import type { SportSetupEntry, SportSetupResponse } from "@/lib/services/sport-setup";
import { AREAS, AREA_LABELS, SPORT_GROUPS } from "./types";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { PlaneIcon, RotateCcwIcon, SaveIcon, SlidersHorizontalIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Generate call-time options: 0, 15, 30, 45, 60 ... 240 minutes */
const CALL_TIME_OPTIONS = [0, 15, 30, 45, 60, 90, 120, 150, 180, 210, 240];

function formatMinutes(mins: number): string {
  if (mins === 0) return "None";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return h === 1 ? "1 hr" : `${h} hrs`;
  return `${h}h ${m}m`;
}

function coverageInputName(sportCode: string, area: string, field: string): string {
  return `sportCoverage.${sportCode}.${area}.${field}`;
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
  onUpdateShift: (
    sportCode: string,
    area: string,
    field: "homeStaffCount" | "homeStudentCount" | "awayStaffCount" | "awayStudentCount",
    value: number,
  ) => void;
  onUpdateOffset: (sportCode: string, field: "shiftStartOffset" | "shiftEndOffset", value: number) => void;
  dirtyCodes: Set<string>;
  onSave: (sportCode: string) => void;
  onDiscard: (sportCode: string) => void;
}) {
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

  function getShiftCount(
    sportCode: string,
    area: string,
    field: "homeStaffCount" | "homeStudentCount" | "awayStaffCount" | "awayStudentCount",
  ): number {
    const config = getConfig(sportCode);
    if (!config) return 0;
    const sc = config.shiftConfigs.find((s) => s.area === area);
    if (!sc) return 0;
    if (field === "homeStudentCount") return sc.homeStudentCount ?? sc.homeCount ?? 0;
    if (field === "awayStudentCount") return sc.awayStudentCount ?? sc.awayCount ?? 0;
    return sc[field] ?? 0;
  }

  return (
    <div className="flex flex-col gap-4">
      {SPORT_GROUPS.map((group) => {
        const primaryCode = group.codes[0]!; // every SPORT_GROUP has at least one code
        const config = getGroupConfig(group.codes);
        const active = isGroupActive(group.codes);
        const dirty = group.codes.some((code) => dirtyCodes.has(code));

        return (
          <Card key={group.label}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-base">{group.label}</CardTitle>
                  <span className="text-xs text-muted-foreground">
                    {group.codes.length > 1
                      ? `applies to ${group.codes.join(" + ")}`
                      : group.codes[0]}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {dirty && (
                    <>
                      <Badge variant="orange" size="sm">Unsaved</Badge>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-10 px-2 text-xs"
                        disabled={Boolean(saving)}
                        onClick={() => onDiscard(primaryCode)}
                      >
                        <RotateCcwIcon data-icon="inline-start" />
                        Discard
                      </Button>
                      <Button
                        type="button"
                        className="h-10 px-3 text-xs"
                        disabled={Boolean(saving)}
                        onClick={() => onSave(primaryCode)}
                      >
                        <SaveIcon data-icon="inline-start" />
                        {saving === `${primaryCode}-save` ? "Saving..." : "Save"}
                      </Button>
                    </>
                  )}
                  <Badge variant={active ? "green" : "gray"} size="sm">
                    {active ? "Active" : "Off"}
                  </Badge>
                  <Switch
                    checked={active}
                    onCheckedChange={() => onToggleActive(primaryCode)}
                    disabled={saving?.endsWith("-toggle") ?? false}
                    aria-label={`${group.label} shift generation`}
                  />
                </div>
              </div>

              {sportSetup ? (
                <div className="mt-3 flex flex-col gap-1.5 rounded-md border border-border/60 bg-muted/25 p-2.5">
                  {group.codes.map((code) => {
                    const setup = getSetup(code);
                    const travel = setup
                      ? [...setup.staff, ...setup.students].filter((member) => member.defaultTraveler).length
                      : 0;
                    const rosterSize = setup ? setup.staff.length + setup.students.length : 0;
                    return (
                      <div key={code} className="flex flex-wrap items-center gap-2 text-xs">
                        {group.codes.length > 1 ? (
                          <span className="min-w-14 font-medium text-muted-foreground">{code}</span>
                        ) : null}
                        <span className="text-muted-foreground">Auto assign</span>
                        <Badge
                          variant={setup?.policy === "HOLD" ? "orange" : setup?.policy === "STAFF_ONLY" ? "blue" : "gray"}
                          size="sm"
                        >
                          {SPORT_AUTO_ASSIGN_POLICY_LABELS[setup?.policy ?? "FULL_CREW"]}
                        </Badge>
                        <span className="text-muted-foreground">
                          {rosterSize === 0
                            ? "Nobody on the roster"
                            : `${rosterSize} on the roster`}
                        </span>
                        {travel > 0 ? (
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <PlaneIcon className="size-3" />
                            {travel} travel
                          </span>
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="ml-auto h-10 px-2 text-xs"
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
            </CardHeader>

            {active && (
              <CardContent className="pt-0 flex flex-col gap-4">
                {/* Shift counts table */}
                <div className="overflow-x-auto">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">Minimum crew</p>
                    <p className="text-xs text-muted-foreground">
                      Generated shifts create both Staff slots and Student slots from these counts.
                    </p>
                  </div>
                  <table className="w-full border-collapse text-sm [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:text-muted-foreground [&_th]:border-b [&_th]:border-border [&_th]:bg-muted/40 [&_td]:px-3 [&_td]:py-2 [&_td]:border-b [&_td]:border-border/40 [&_tr:last-child_td]:border-b-0">
                    <thead>
                      <tr>
                        <th className="min-w-36">Area</th>
                        <th className="text-center">Home Staff</th>
                        <th className="text-center">Home Student</th>
                        <th className="text-center">Home total</th>
                        <th className="text-center">Away Staff</th>
                        <th className="text-center">Away Student</th>
                        <th className="text-center">Away total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {AREAS.map((area) => {
                        const homeStaff = getShiftCount(primaryCode, area, "homeStaffCount");
                        const homeStudent = getShiftCount(primaryCode, area, "homeStudentCount");
                        const awayStaff = getShiftCount(primaryCode, area, "awayStaffCount");
                        const awayStudent = getShiftCount(primaryCode, area, "awayStudentCount");
                        return (
                        <tr key={area}>
                          <td className="font-medium">{AREA_LABELS[area]}</td>
                          <td className="text-center">
                            <Input
                              id={coverageInputName(primaryCode, area, "homeStaffCount")}
                              name={coverageInputName(primaryCode, area, "homeStaffCount")}
                              type="number"
                              min={0}
                              max={20}
                              value={getShiftCount(primaryCode, area, "homeStaffCount")}
                              onChange={(e) =>
                                onUpdateShift(primaryCode, area, "homeStaffCount", Math.max(0, parseInt(e.target.value) || 0))
                              }
                              className="w-14 text-center inline-block"
                              disabled={saving?.startsWith(primaryCode) ?? false}
                              aria-label={`${group.label} ${AREA_LABELS[area]} home Staff count`}
                            />
                          </td>
                          <td className="text-center">
                            <Input
                              id={coverageInputName(primaryCode, area, "homeStudentCount")}
                              name={coverageInputName(primaryCode, area, "homeStudentCount")}
                              type="number"
                              min={0}
                              max={20}
                              value={getShiftCount(primaryCode, area, "homeStudentCount")}
                              onChange={(e) =>
                                onUpdateShift(primaryCode, area, "homeStudentCount", Math.max(0, parseInt(e.target.value) || 0))
                              }
                              className="w-14 text-center inline-block"
                              disabled={saving?.startsWith(primaryCode) ?? false}
                              aria-label={`${group.label} ${AREA_LABELS[area]} home Student count`}
                            />
                          </td>
                          <td className="text-center text-sm font-semibold tabular-nums">{homeStaff + homeStudent}</td>
                          <td className="text-center">
                            <Input
                              id={coverageInputName(primaryCode, area, "awayStaffCount")}
                              name={coverageInputName(primaryCode, area, "awayStaffCount")}
                              type="number"
                              min={0}
                              max={20}
                              value={getShiftCount(primaryCode, area, "awayStaffCount")}
                              onChange={(e) =>
                                onUpdateShift(primaryCode, area, "awayStaffCount", Math.max(0, parseInt(e.target.value) || 0))
                              }
                              className="w-14 text-center inline-block"
                              disabled={saving?.startsWith(primaryCode) ?? false}
                              aria-label={`${group.label} ${AREA_LABELS[area]} away Staff count`}
                            />
                          </td>
                          <td className="text-center">
                            <Input
                              id={coverageInputName(primaryCode, area, "awayStudentCount")}
                              name={coverageInputName(primaryCode, area, "awayStudentCount")}
                              type="number"
                              min={0}
                              max={20}
                              value={getShiftCount(primaryCode, area, "awayStudentCount")}
                              onChange={(e) =>
                                onUpdateShift(primaryCode, area, "awayStudentCount", Math.max(0, parseInt(e.target.value) || 0))
                              }
                              className="w-14 text-center inline-block"
                              disabled={saving?.startsWith(primaryCode) ?? false}
                              aria-label={`${group.label} ${AREA_LABELS[area]} away Student count`}
                            />
                          </td>
                          <td className="text-center text-sm font-semibold tabular-nums">{awayStaff + awayStudent}</td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Call time config */}
                <div className="flex flex-wrap items-center gap-4 pt-1">
                  <span className="text-sm text-muted-foreground font-medium">Student call time</span>
                  <div className="flex items-center gap-2">
                    <Select
                      value={String(config?.shiftStartOffset ?? 60)}
                      onValueChange={(v) => onUpdateOffset(primaryCode, "shiftStartOffset", parseInt(v))}
                      disabled={saving?.startsWith(primaryCode) ?? false}
                    >
                      <SelectTrigger size="sm" className="w-[110px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CALL_TIME_OPTIONS.map((m) => (
                          <SelectItem key={m} value={String(m)}>{formatMinutes(m)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-sm text-muted-foreground">before</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      value={String(config?.shiftEndOffset ?? 60)}
                      onValueChange={(v) => onUpdateOffset(primaryCode, "shiftEndOffset", parseInt(v))}
                      disabled={saving?.startsWith(primaryCode) ?? false}
                    >
                      <SelectTrigger size="sm" className="w-[110px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CALL_TIME_OPTIONS.map((m) => (
                          <SelectItem key={m} value={String(m)}>{formatMinutes(m)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-sm text-muted-foreground">after</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Staff and collaborators use the event start and end.</p>
                </div>
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
