"use client";

import { useEverOpen } from "@/hooks/use-ever-open";
import dynamic from "next/dynamic";
import { useState } from "react";
import { toast } from "@/lib/toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useFetch } from "@/hooks/use-fetch";
import { handleAuthRedirect, classifyError, isAbortError, parseJsonSafely } from "@/lib/errors";
import type { SportConfig } from "./types";
import { AREAS, SPORT_GROUPS, defaultShiftConfigs } from "./types";
import ShiftConfigTable from "./ShiftConfigTable";
import NonGameScheduleCard from "./NonGameScheduleCard";
import { SettingsPageShell } from "../SettingsPageShell";
import { SettingsGroup, SettingsRow } from "../_components/SettingsGroup";
import EmptyState from "@/components/EmptyState";
import type { SportSetupResponse } from "@/lib/services/sport-setup";

const SportSetupWizard = dynamic(() => import("@/components/schedule/SportSetupWizard").then((mod) => mod.SportSetupWizard));

type RebaseSummary = {
  groupsCreated: number;
  groupsRebased: number;
  slotsAdded: number;
  slotsRemoved: number;
  slotsRetimed: number;
  protectedSlots: number;
  protectedOverageSlots: number;
  publishedSkipped: number;
  workingCopiesSkipped: number;
};

type CallTimeSyncSummary = {
  shiftsUpdated: number;
  workingCopiesUpdated: number;
  invalidWorkingCopies: number;
};

export default function SportsSettingsPage() {
  const { data: fetchedConfigs, loading, error, reload } = useFetch<SportConfig[]>({
    url: "/api/sport-configs",
    returnTo: "/settings/sports",
    transform: (json) => (json.data as SportConfig[]) ?? [],
  });
  // Local state for optimistic updates on mutations
  const [localConfigs, setLocalConfigs] = useState<SportConfig[] | null>(null);
  const configs = localConfigs ?? fetchedConfigs ?? [];
  // Sync local state when fetch data changes
  const [prevFetched, setPrevFetched] = useState(fetchedConfigs);
  if (fetchedConfigs !== prevFetched) {
    setPrevFetched(fetchedConfigs);
    setLocalConfigs(null);
  }
  const setConfigs = (updater: SportConfig[] | ((prev: SportConfig[]) => SportConfig[])) => {
    setLocalConfigs(typeof updater === "function" ? updater(configs) : updater);
  };
  const [saving, setSaving] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const everWizard = useEverOpen(wizardOpen);
  const [wizardSportCode, setWizardSportCode] = useState<string | null>(null);
  // Policy, roster, and travel are read from the same endpoint the wizard
  // writes through, so this page cannot drift from what the wizard shows.
  const {
    data: sportSetup,
    reload: reloadSportSetup,
  } = useFetch<SportSetupResponse | null>({
    url: "/api/schedule/sport-setup",
    returnTo: "/settings/sports",
    transform: (json) => (json.data as SportSetupResponse) ?? null,
  });
  const [dirtyCodes, setDirtyCodes] = useState<Set<string>>(() => new Set());

  function getConfig(sportCode: string) {
    return configs.find((c) => c.sportCode === sportCode);
  }

  /** Find the group that a sport code belongs to */
  function findGroup(sportCode: string) {
    return SPORT_GROUPS.find((g) => g.codes.includes(sportCode));
  }

  async function toggleActive(sportCode: string) {
    const group = findGroup(sportCode);
    const codes = group ? group.codes : [sportCode];
    const groupActive = codes.some((code) => getConfig(code)?.active);
    const nextActive = !groupActive;
    if (codes.some((code) => dirtyCodes.has(code))) {
      toast.error("Save or discard this sport's staffing changes before turning generation off.");
      return;
    }

    // For groups whose configs don't exist yet, the group endpoint will create
    // them on demand with default shift counts (matches single-code POST).
    const needsCreate = codes.some((code) => !getConfig(code));
    const patch: Parameters<typeof applyGroupPatch>[2] = { active: nextActive };
    if (needsCreate && nextActive) {
      patch.shiftConfigs = defaultShiftConfigs();
    }
    await applyGroupPatch(sportCode, sportCode + "-toggle", patch);
  }

  async function applyGroupPatch(
    sportCode: string,
    savingKey: string,
    patch: {
      active?: boolean;
      shiftConfigs?: SportConfig["shiftConfigs"];
      shiftStartOffset?: number;
      shiftEndOffset?: number;
    },
  ): Promise<boolean> {
    const group = findGroup(sportCode);
    const codes = group ? group.codes : [sportCode];

    setSaving(savingKey);
    try {
      const res = await fetch("/api/sport-configs/group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codes, ...patch }),
      });
      if (handleAuthRedirect(res, "/settings/sports")) return false;
      if (res.ok) {
        const json = await parseJsonSafely<{
          data?: SportConfig[];
          rebase?: RebaseSummary | null;
          rebaseFailed?: boolean;
          callTimes?: CallTimeSyncSummary | null;
          callTimesFailed?: boolean;
        }>(res);
        const updated = json?.data;
        if (!Array.isArray(updated)) {
          toast.error("Saved, but the response could not be read. Refresh sports settings before continuing.");
          reload();
          return false;
        }
        const byCode = new Map(updated.map((c) => [c.sportCode, c]));
        setConfigs((prev) =>
          prev.map((c) => byCode.get(c.sportCode) ?? c)
            .concat(updated.filter((c) => !prev.some((p) => p.sportCode === c.sportCode)))
        );
        const rebase = json?.rebase;
        const callTimes = json?.callTimes;
        const changedEvents = (rebase?.groupsCreated ?? 0) + (rebase?.groupsRebased ?? 0);
        const skippedReview = (rebase?.publishedSkipped ?? 0) + (rebase?.workingCopiesSkipped ?? 0);
        const group = findGroup(sportCode);
        if (changedEvents > 0) {
          toast.success(`Saved and updated ${changedEvents} upcoming ${changedEvents === 1 ? "event" : "events"}`);
        } else if (group && group.codes.length > 1) {
          toast.success(`Saved - applies to ${group.codes.join(" + ")}`);
        } else {
          toast.success("Saved");
        }
        if (skippedReview > 0) {
          toast.info(`${skippedReview} published or in-progress ${skippedReview === 1 ? "schedule needs" : "schedules need"} review before changing.`);
        }
        if ((rebase?.protectedOverageSlots ?? 0) > 0) {
          const kept = rebase!.protectedOverageSlots;
          toast.info(`${kept} ${kept === 1 ? "slot was" : "slots were"} kept because staffing or manual changes already exist.`);
        }
        if ((callTimes?.shiftsUpdated ?? 0) > 0) {
          toast.info(`${callTimes!.shiftsUpdated} current ${callTimes!.shiftsUpdated === 1 ? "call time was" : "call times were"} updated from Sport settings.`);
        }
        if ((callTimes?.workingCopiesUpdated ?? 0) > 0) {
          toast.info("Private working schedules were updated so publishing will keep the new call times.");
        }
        if ((callTimes?.invalidWorkingCopies ?? 0) > 0) {
          toast.warning("Some private working schedules could not be updated. Review or discard them before publishing.");
        }
        if (json?.rebaseFailed) {
          toast.warning("Defaults were saved, but upcoming schedules could not be refreshed. Save again to retry safely.");
        }
        if (json?.callTimesFailed) {
          toast.warning("Defaults were saved, but current call times could not be synchronized. Save again to retry safely.");
        }
        return true;
      } else if (res.status === 429) {
        toast.error("Too many changes - please slow down.");
      } else {
        toast.error("Save failed - your changes were not applied.");
      }
      return false;
    } catch (err) {
      if (isAbortError(err)) return false;
      const kind = classifyError(err);
      toast.error(kind === "network" ? "You're offline. Check your connection." : "Something went wrong");
      return false;
    } finally {
      setSaving(null);
    }
  }

  async function updateShiftCount(
    sportCode: string,
    area: string,
    field: "homeStaffCount" | "homeStudentCount" | "awayStaffCount" | "awayStudentCount",
    value: number,
  ) {
    const config = getConfig(sportCode);
    if (!config) return;

    const updatedConfigs = AREAS.map((a) => {
      const existing = config.shiftConfigs.find((sc) => sc.area === a);
      const homeStaffCount = a === area && field === "homeStaffCount" ? value : (existing?.homeStaffCount ?? 0);
      const homeStudentCount = a === area && field === "homeStudentCount" ? value : (existing?.homeStudentCount ?? existing?.homeCount ?? 0);
      const awayStaffCount = a === area && field === "awayStaffCount" ? value : (existing?.awayStaffCount ?? 0);
      const awayStudentCount = a === area && field === "awayStudentCount" ? value : (existing?.awayStudentCount ?? existing?.awayCount ?? 0);
      if (a === area) {
        return {
          area: a,
          homeCount: homeStaffCount + homeStudentCount,
          awayCount: awayStaffCount + awayStudentCount,
          homeStaffCount,
          homeStudentCount,
          awayStaffCount,
          awayStudentCount,
        };
      }
      return {
        area: a,
        homeCount: existing?.homeCount ?? 0,
        awayCount: existing?.awayCount ?? 0,
        homeStaffCount: existing?.homeStaffCount ?? 0,
        homeStudentCount: existing?.homeStudentCount ?? existing?.homeCount ?? 0,
        awayStaffCount: existing?.awayStaffCount ?? 0,
        awayStudentCount: existing?.awayStudentCount ?? existing?.awayCount ?? 0,
      };
    });

    const codes = findGroup(sportCode)?.codes ?? [sportCode];
    setConfigs((previous) => previous.map((item) =>
      codes.includes(item.sportCode) ? { ...item, shiftConfigs: updatedConfigs } : item,
    ));
    setDirtyCodes((previous) => {
      const next = new Set(previous);
      for (const code of codes) next.add(code);
      return next;
    });
  }

  async function updateOffset(sportCode: string, field: "shiftStartOffset" | "shiftEndOffset", value: number) {
    const codes = findGroup(sportCode)?.codes ?? [sportCode];
    setConfigs((previous) => previous.map((item) =>
      codes.includes(item.sportCode) ? { ...item, [field]: value } : item,
    ));
    setDirtyCodes((previous) => {
      const next = new Set(previous);
      for (const code of codes) next.add(code);
      return next;
    });
  }

  async function saveConfig(sportCode: string) {
    const config = getConfig(sportCode);
    if (!config) return;
    const saved = await applyGroupPatch(sportCode, `${sportCode}-save`, {
      shiftConfigs: config.shiftConfigs,
      shiftStartOffset: config.shiftStartOffset,
      shiftEndOffset: config.shiftEndOffset,
    });
    if (!saved) return;
    const codes = findGroup(sportCode)?.codes ?? [sportCode];
    setDirtyCodes((previous) => {
      const next = new Set(previous);
      for (const code of codes) next.delete(code);
      return next;
    });
  }

  function discardConfig(sportCode: string) {
    const codes = findGroup(sportCode)?.codes ?? [sportCode];
    const baseline = fetchedConfigs ?? [];
    setConfigs((previous) => previous.map((item) =>
      codes.includes(item.sportCode)
        ? baseline.find((saved) => saved.sportCode === item.sportCode) ?? item
        : item,
    ));
    setDirtyCodes((previous) => {
      const next = new Set(previous);
      for (const code of codes) next.delete(code);
      return next;
    });
    toast.success("Unsaved staffing changes discarded");
  }

  const description = "Which sports get shifts, and the crew each game needs.";

  /* ---------- Loading skeleton ---------- */
  if (loading) {
    return (
      <SettingsPageShell href="/settings/sports" description={description} mainClassName="flex flex-col gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between rounded-xl border p-4">
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
            <Skeleton className="h-5 w-9 rounded-full" />
          </div>
        ))}
      </SettingsPageShell>
    );
  }

  /* ---------- Error state ---------- */
  if (error) {
    return (
      <SettingsPageShell href="/settings/sports" description={description}>
        <EmptyState
          inline
          icon={error === "network" ? "wifi-off" : "calendar"}
          title={error === "network" ? "You are offline" : "Could not load sports"}
          description={
            error === "network"
              ? "Could not reach the server. Check your connection and try again."
              : "Something went wrong loading sports configuration."
          }
          actionLabel="Retry"
          onAction={reload}
        />
      </SettingsPageShell>
    );
  }

  /* ---------- Normal render ---------- */
  return (
    <SettingsPageShell href="/settings/sports" description={description} mainClassName="flex flex-col gap-7">
      <SettingsGroup id="sport-setup">
        <SettingsRow
          label="Auto assign setup"
          description="Walk through each sport to set what Auto assign does, who it can pick from, and who travels."
        >
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              setWizardSportCode(null);
              setWizardOpen(true);
            }}
          >
            Open setup
          </Button>
        </SettingsRow>
      </SettingsGroup>

      {everWizard && (
        <SportSetupWizard
          open={wizardOpen}
          onOpenChange={setWizardOpen}
          startAtSportCode={wizardSportCode}
          onCompleted={() => {
            reload();
            reloadSportSetup();
          }}
        />
      )}

      <div id="sports">
        <ShiftConfigTable
          configs={configs}
          sportSetup={sportSetup ?? null}
          onOpenSetup={(sportCode) => {
            setWizardSportCode(sportCode);
            setWizardOpen(true);
          }}
          saving={saving}
          onToggleActive={toggleActive}
          onUpdateShift={updateShiftCount}
          onUpdateOffset={updateOffset}
          dirtyCodes={dirtyCodes}
          onSave={saveConfig}
          onDiscard={discardConfig}
        />
      </div>

      <div id="non-game">
        <NonGameScheduleCard />
      </div>
    </SettingsPageShell>
  );
}
