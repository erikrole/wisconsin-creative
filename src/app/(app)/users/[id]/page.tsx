"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState, type ComponentType } from "react";
import type { UserDetail, Location, Role } from "../types";
import { AREA_LABELS, deriveStudentYear, STUDENT_YEAR_OPTIONS } from "../types";
import { useFetch } from "@/hooks/use-fetch";
import RoleBadge from "../RoleBadge";
import UserInfoTab from "./UserInfoTab";
import UserScoreboardTab from "./UserScoreboardTab";
import UserActivityTab from "./UserActivityTab";
import UserAvailabilityTab from "./UserAvailabilityTab";
import UserBadgesTab from "./UserBadgesTab";
import { BadgeMedallion } from "@/components/badges/BadgeMedallion";
import { toast } from "sonner";
import { useBreadcrumbLabel } from "@/components/BreadcrumbContext";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { UserAvatar } from "@/components/UserAvatar";
import { DetailPageHeader } from "@/components/DetailPageHeader";
import { useConfirm } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Aperture, AudioLines, Award, AlertCircle, BadgeCheck, BatteryCharging, Binoculars, Briefcase, Cable, CalendarDays, CameraIcon, ChevronDown, CloudRain, Copy, Flame, GraduationCap, Handshake, KeyRound, LifeBuoy, MoonStar, PackageCheck, Shield, ShieldCheck, ShoppingCart, TrashIcon, Trophy, UserCheck, UserRound } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { badgeRarityVariant, customBadgeIconOptions, getBadgeRarity, manualAwardGuidance, type BadgeRarity, type CustomBadgeIcon } from "@/lib/badges/display";
import { cn } from "@/lib/utils";
import { formatDateFull } from "@/lib/format";
import { FadeUp } from "@/components/ui/motion";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { useUrlState } from "@/hooks/use-url-state";
import { ProfileCompletionNotice } from "@/components/profile-completion/ProfileCompletionNotice";
import { AvatarCropDialog } from "./AvatarCropDialog";
import { useQueryClient } from "@tanstack/react-query";
import { syncCachedUserLists } from "@/lib/user-list-cache";
import { formatAnticipatedGraduation } from "@/lib/student-profile";

/* ── Tab Definitions ───────────────────────────────────── */

type TabKey = "info" | "scoreboard" | "activity" | "availability" | "badges";

type BadgeDefinitionOption = {
  id: string;
  key: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  kind: string;
  trigger: string;
  threshold: number | null;
};

type ApiEnvelope<T> = {
  data?: T;
  error?: string;
};

type AvatarResponse = {
  avatarUrl?: string | null;
};

type PasswordResetResponse = {
  temporaryPassword?: string | null;
};

type AwardResponse = {
  definition?: BadgeDefinitionOption;
};

const customIconMap: Record<string, ComponentType<{ className?: string }>> = {
  Aperture,
  AudioLines,
  Trophy,
  BadgeCheck,
  BatteryCharging,
  Binoculars,
  Cable,
  CloudRain,
  ShieldCheck,
  UserCheck,
  Handshake,
  Flame,
  LifeBuoy,
  MoonStar,
  PackageCheck,
  ShoppingCart,
};

type AwardMode = "existing" | "custom";

function awardPreviewGradient(rarity: BadgeRarity): string {
  if (rarity === "Legendary") return "bg-[radial-gradient(circle_at_50%_100%,var(--purple-bg),transparent_60%),linear-gradient(165deg,var(--background),var(--muted))]";
  if (rarity === "Rare") return "bg-[radial-gradient(circle_at_50%_100%,var(--orange-bg),transparent_60%),linear-gradient(165deg,var(--background),var(--muted))]";
  if (rarity === "Uncommon") return "bg-[radial-gradient(circle_at_50%_100%,var(--blue-bg),transparent_60%),linear-gradient(165deg,var(--background),var(--muted))]";
  return "bg-[linear-gradient(165deg,var(--background),var(--muted))]";
}

function AwardPreviewHeader({
  mode,
  selectedDefinition,
  selectedRarity,
  customName,
  customIcon,
  profileName,
}: {
  mode: AwardMode;
  selectedDefinition: BadgeDefinitionOption | null;
  selectedRarity: BadgeRarity | null;
  customName: string;
  customIcon: CustomBadgeIcon;
  profileName: string;
}) {
  const icon =
    mode === "existing"
      ? (selectedDefinition ? customIconMap[selectedDefinition.icon] ?? Trophy : null)
      : customIconMap[customIcon] ?? Trophy;
  const rarity: BadgeRarity = mode === "existing" ? (selectedRarity ?? "Common") : "Uncommon";
  const name = mode === "existing" ? (selectedDefinition?.name ?? "") : customName;

  return (
    <div className={cn("relative isolate overflow-hidden border-b border-border/40 px-6 py-7 text-center", awardPreviewGradient(rarity))}>
      <div className="pointer-events-none absolute inset-0 [background-image:linear-gradient(115deg,transparent_0%,rgba(255,255,255,0.30)_46%,transparent_58%)]" />
      <p className="relative mb-5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Awarding to {profileName}
      </p>
      <div className="relative flex justify-center">
        <BadgeMedallion
          icon={icon ?? Trophy}
          earned={false}
          rarity={rarity}
          shape="hex"
          className="size-24 shadow-[0_16px_40px_rgba(0,0,0,0.18)]"
          iconClassName="size-9"
        />
      </div>
      {name ? (
        <p className="relative mt-5 text-balance text-lg font-semibold leading-tight">{name}</p>
      ) : mode === "existing" ? (
        <p className="relative mt-5 text-sm text-muted-foreground">Choose a badge below</p>
      ) : (
        <p className="relative mt-5 text-sm text-muted-foreground">New custom badge</p>
      )}
    </div>
  );
}

function CustomIconPicker({
  value,
  onChange,
  disabled,
}: {
  value: CustomBadgeIcon;
  onChange: (icon: CustomBadgeIcon) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {customBadgeIconOptions.map((icon) => {
        const IconComponent = customIconMap[icon];
        return (
          <button
            key={icon}
            type="button"
            onClick={() => onChange(icon)}
            disabled={disabled}
            title={icon}
            className={cn(
              "flex size-10 items-center justify-center rounded-lg border transition-colors",
              value === icon
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {IconComponent && <IconComponent className="size-5" />}
          </button>
        );
      })}
    </div>
  );
}

const tabDefs: Array<{ key: TabKey; label: string }> = [
  { key: "info", label: "Info" },
  { key: "scoreboard", label: "Scoreboard" },
  { key: "activity", label: "Activity" },
  { key: "availability", label: "Availability" },
  { key: "badges", label: "Badges" },
];

function parseUserDetailTab(raw: string | null): TabKey {
  return tabDefs.some((tab) => tab.key === raw) ? (raw as TabKey) : "info";
}

function serializeDetailTab(tab: TabKey): string | null {
  return tab === "info" ? null : tab;
}

/* ── Main Page ─────────────────────────────────────────── */

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { setBreadcrumbLabel } = useBreadcrumbLabel();

  const [activeTab, setActiveTab] = useUrlState<TabKey>("tab", parseUserDetailTab, serializeDetailTab);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [pendingAvatarFile, setPendingAvatarFile] = useState<File | null>(null);
  const [togglingActive, setTogglingActive] = useState(false);
  const [resetPwDialog, setResetPwDialog] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [awardDialogOpen, setAwardDialogOpen] = useState(false);
  const [awardDefinitions, setAwardDefinitions] = useState<BadgeDefinitionOption[] | null>(null);
  const [awardDefinitionsLoading, setAwardDefinitionsLoading] = useState(false);
  const [awardMode, setAwardMode] = useState<AwardMode>("existing");
  const [selectedAwardDefinitionId, setSelectedAwardDefinitionId] = useState("");
  const [customAwardName, setCustomAwardName] = useState("");
  const [customAwardDescription, setCustomAwardDescription] = useState("");
  const [customAwardIcon, setCustomAwardIcon] = useState<CustomBadgeIcon>("Trophy");
  const [awardNote, setAwardNote] = useState("");
  const [awardBusy, setAwardBusy] = useState(false);
  const [badgesTabRevision, setBadgesTabRevision] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const avatarBusyRef = useRef(false);
  const activeBusyRef = useRef(false);
  const resetBusyRef = useRef(false);
  const awardBusyRef = useRef(false);
  const confirm = useConfirm();
  const queryClient = useQueryClient();

  // ── Data fetching via useFetch ──
  const {
    data: user,
    error: fetchError,
    reload: loadUser,
  } = useFetch<UserDetail>({
    url: `/api/users/${id}`,
    returnTo: `/users/${id}`,
  });

  // We need local user state for optimistic updates (avatar, active toggle)
  const [userOverrides, setUserOverrides] = useState<Partial<UserDetail>>({});
  const effectiveUser = user ? { ...user, ...userOverrides } : null;

  const { data: meData } = useFetch<{ id: string; role: Role }>({
    url: "/api/me",
    transform: (json) => (json as Record<string, unknown>).user as { id: string; role: Role },
    refetchOnFocus: false,
  });
  const currentUserId = meData?.id ?? null;
  const currentUserRole = meData?.role ?? null;

  const {
    data: formOptions,
    loading: formOptionsLoading,
    error: formOptionsError,
    reload: reloadFormOptions,
  } = useFetch<{ locations: Location[] }>({
    url: "/api/form-options",
    enabled: currentUserRole !== null && currentUserRole !== "COLLABORATOR",
    transform: (json) => (json as Record<string, unknown>).data as { locations: Location[] },
    refetchOnFocus: false,
  });
  const locations = formOptions?.locations ?? [];

  useEffect(() => {
    if (user?.name) setBreadcrumbLabel(user.name);
  }, [user?.name, setBreadcrumbLabel]);

  const isSelf = currentUserId != null && currentUserId === id;
  const isStaffOrAdmin = currentUserRole === "ADMIN" || currentUserRole === "STAFF";
  const canEdit = isSelf || isStaffOrAdmin;
  const canManageProfilePhoto = isSelf || currentUserRole === "ADMIN";

  function switchTab(tab: TabKey) {
    setActiveTab(tab);
  }

  useEffect(() => {
    if (user && user.staffingType !== "ST" && activeTab === "availability") {
      setActiveTab("info");
    }
  }, [activeTab, setActiveTab, user]);

  async function uploadAvatar(file: File): Promise<boolean> {
    if (avatarBusyRef.current) return false;
    avatarBusyRef.current = true;
    setUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/users/${id}/avatar`, { method: "POST", body: formData });
      if (handleAuthRedirect(res)) return false;
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Failed to upload avatar");
        toast.error(msg);
        return false;
      } else {
        const json = await parseJsonSafely<ApiEnvelope<AvatarResponse>>(res);
        const avatarUrl = json?.data?.avatarUrl ?? null;
        setUserOverrides((prev) => ({ ...prev, avatarUrl }));
        await syncCachedUserLists(queryClient, id, { avatarUrl });
        toast.success("Profile photo updated");
        return true;
      }
    } catch {
      toast.error("Network error");
      return false;
    } finally {
      avatarBusyRef.current = false;
      setUploadingAvatar(false);
    }
  }

  async function removeAvatar() {
    if (avatarBusyRef.current) return;
    const ok = await confirm({
      title: `Remove ${effectiveUser?.name ? effectiveUser.name + "'s " : ""}photo?`,
      message: "The current profile photo will be deleted permanently. A new one can be uploaded anytime.",
      confirmLabel: "Remove photo",
      variant: "danger",
    });
    if (!ok) return;
    // Optimistic: remove avatar immediately, rollback on failure
    const previousUrl = effectiveUser?.avatarUrl ?? null;
    setUserOverrides((prev) => ({ ...prev, avatarUrl: null }));
    avatarBusyRef.current = true;
    setUploadingAvatar(true);
    try {
      const res = await fetch(`/api/users/${id}/avatar`, { method: "DELETE" });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        setUserOverrides((prev) => ({ ...prev, avatarUrl: previousUrl }));
        const msg = await parseErrorMessage(res, "Failed to remove avatar");
        toast.error(msg);
      } else {
        await syncCachedUserLists(queryClient, id, { avatarUrl: null });
        toast.success("Profile photo removed");
      }
    } catch {
      setUserOverrides((prev) => ({ ...prev, avatarUrl: previousUrl }));
      toast.error("Network error");
    } finally {
      avatarBusyRef.current = false;
      setUploadingAvatar(false);
    }
  }

  async function toggleActive() {
    if (!effectiveUser || activeBusyRef.current) return;
    activeBusyRef.current = true;
    setTogglingActive(true);
    const newActive = !effectiveUser.active;
    setUserOverrides((prev) => ({ ...prev, active: newActive }));
    try {
      const res = await fetch(`/api/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: newActive }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        setUserOverrides((prev) => ({ ...prev, active: !newActive }));
        const msg = await parseErrorMessage(res, "Failed to update status");
        toast.error(msg);
      } else {
        await syncCachedUserLists(queryClient, id, { active: newActive });
        toast.success(newActive ? "User activated" : "User deactivated");
      }
    } catch {
      setUserOverrides((prev) => ({ ...prev, active: !newActive }));
      toast.error("Network error");
    } finally {
      activeBusyRef.current = false;
      setTogglingActive(false);
    }
  }

  async function handlePasswordReset() {
    if (resetBusyRef.current) return;
    resetBusyRef.current = true;
    setResetBusy(true);
    try {
      const res = await fetch(`/api/users/${id}/reset-password`, { method: "POST" });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Password reset failed");
        toast.error(msg);
      } else {
        const json = await parseJsonSafely<ApiEnvelope<PasswordResetResponse>>(res);
        setTempPassword(json?.data?.temporaryPassword ?? null);
        toast.success("Password reset successfully");
      }
    } catch {
      toast.error("Network error");
    } finally {
      resetBusyRef.current = false;
      setResetBusy(false);
    }
  }

  async function openManualAwardDialog() {
    setAwardDialogOpen(true);
    if (awardDefinitions !== null || awardDefinitionsLoading) {
      if (awardDefinitions?.length === 0) {
        setAwardMode("custom");
      }
      return;
    }

    setAwardDefinitionsLoading(true);
    try {
      const res = await fetch("/api/badges?manualOnly=true");
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Failed to load badges");
        toast.error(msg);
        setAwardDefinitions([]);
        return;
      }
      const json = await parseJsonSafely<ApiEnvelope<BadgeDefinitionOption[]>>(res);
      const definitions = json?.data ?? [];
      setAwardDefinitions(definitions);
      setSelectedAwardDefinitionId((prev) => prev || definitions[0]?.id || "");
      if (definitions.length === 0) {
        setAwardMode("custom");
      }
    } catch {
      toast.error("Network error");
      setAwardDefinitions([]);
      setAwardMode("custom");
    } finally {
      setAwardDefinitionsLoading(false);
    }
  }

  async function handleManualAward() {
    const customName = customAwardName.trim();
    const customDescription = customAwardDescription.trim();
    if (awardBusyRef.current) return;
    if (awardMode === "existing" && !selectedAwardDefinitionId) return;
    if (awardMode === "custom" && (!customName || !customDescription)) {
      toast.error("Name and description are required for custom badges");
      return;
    }

    awardBusyRef.current = true;
    setAwardBusy(true);
    try {
      const res = await fetch("/api/badges/award", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(awardMode === "custom"
          ? {
              userId: id,
              customDefinition: {
                name: customName,
                description: customDescription,
                icon: customAwardIcon,
              },
              note: awardNote.trim() || undefined,
            }
          : {
              userId: id,
              definitionId: selectedAwardDefinitionId,
              note: awardNote.trim() || undefined,
            }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Failed to award badge");
        toast.error(msg);
        return;
      }
      const json = await parseJsonSafely<ApiEnvelope<AwardResponse>>(res);
      const awardedDefinition = json?.data?.definition;
      if (awardedDefinition) {
        setAwardDefinitions((prev) => {
          if (!prev) return prev;
          if (prev.some((definition) => definition.id === awardedDefinition.id)) return prev;
          return [...prev, awardedDefinition].sort((a, b) => a.name.localeCompare(b.name));
        });
        setSelectedAwardDefinitionId(awardedDefinition.id);
      }
      toast.success("Badge awarded");
      setAwardDialogOpen(false);
      setAwardNote("");
      setCustomAwardName("");
      setCustomAwardDescription("");
      setCustomAwardIcon("Trophy");
      setAwardMode("existing");
      setBadgesTabRevision((value) => value + 1);
      if (activeTab !== "badges") {
        switchTab("badges");
      }
    } catch {
      toast.error("Network error");
    } finally {
      awardBusyRef.current = false;
      setAwardBusy(false);
    }
  }

  function handleAwardRequest(badge: { id: string }) {
    setAwardMode("existing");
    setSelectedAwardDefinitionId(badge.id);
    openManualAwardDialog();
  }

  if (fetchError) {
    return (
      <div className="py-10 px-5 flex justify-center">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircle className="size-4" />
          <AlertTitle>Failed to load user</AlertTitle>
          <AlertDescription className="mt-2 flex flex-col gap-3">
            <p>User not found or something went wrong.</p>
            <div className="flex items-center gap-3">
              <Button variant="outline" className="h-10 active:scale-[0.96]" onClick={loadUser}>
                Retry
              </Button>
              <Button variant="ghost" className="h-10 active:scale-[0.96]" asChild>
                <Link href="/users">Back to users</Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col gap-6">
        {/* Header skeleton — matches the DetailPageHeader card so the shell does not shift on load */}
        <div className="rounded-lg border border-border/50 bg-card px-4 py-4 shadow-xs sm:px-5">
          <div className="flex gap-4">
            <Skeleton className="size-16 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-7 w-48" />
              <Skeleton className="h-4 w-56" />
              <Skeleton className="h-3.5 w-40" />
            </div>
          </div>
        </div>
        {/* Tabs skeleton */}
        <Skeleton className="h-9 w-36" />
        {/* Content skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-1.5">
          <div className="rounded-xl border p-4 flex flex-col gap-4">
            {[72, 56, 44, 60, 48, 52].map((w, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-4 w-[120px] shrink-0" />
                <Skeleton className="h-8 flex-1" style={{ maxWidth: `${w}%` }} />
              </div>
            ))}
          </div>
          <div className="rounded-xl border p-4 flex flex-col gap-3">
            <Skeleton className="h-4 w-16" />
            <div className="flex gap-1.5">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <Skeleton className="h-px w-full" />
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-5 w-24 rounded-full" />
          </div>
        </div>
      </div>
    );
  }

  const profile = effectiveUser ?? user;
  if (
    (currentUserRole === "COLLABORATOR" && !isSelf) ||
    (profile.role === "COLLABORATOR" && currentUserRole !== "ADMIN")
  ) {
    return (
      <FadeUp>
        <DetailPageHeader
          className="mx-auto max-w-2xl"
          media={
            <UserAvatar
              name={profile.name}
              avatarUrl={profile.avatarUrl}
              size="xl"
              className="ring-2 ring-border ring-offset-2 ring-offset-card"
            />
          }
          title={profile.name}
          subtitle={profile.title}
          meta={
            <>
              {isSelf && profile.email ? (
                <p className="text-sm text-muted-foreground">{profile.email}</p>
              ) : null}
              <div className="mt-1 flex flex-wrap gap-2">
                <RoleBadge role={profile.role} />
                {profile.collaboratorPolicy?.affiliation.displayName ? (
                  <Badge variant="outline">{profile.collaboratorPolicy.affiliation.displayName}</Badge>
                ) : null}
                {profile.primaryArea ? <Badge variant="outline">{AREA_LABELS[profile.primaryArea] ?? profile.primaryArea}</Badge> : null}
                {profile.location ? <Badge variant="outline">{profile.location}</Badge> : null}
              </div>
            </>
          }
          actions={
            isSelf ? (
              <Button asChild variant="outline" className="h-10 active:scale-[0.96]">
                <Link href="/settings/profile">Edit profile</Link>
              </Button>
            ) : null
          }
        />
      </FadeUp>
    );
  }
  const hasStudentAvailability = profile.staffingType === "ST";
  const availableTabs = hasStudentAvailability
    ? tabDefs
    : tabDefs.filter((tab) => tab.key !== "availability");
  const selectedAwardDefinition =
    awardDefinitions?.find((definition) => definition.id === selectedAwardDefinitionId) ?? null;
  const selectedAwardRarity = selectedAwardDefinition
    ? getBadgeRarity(selectedAwardDefinition)
    : null;

  return (
    <FadeUp>
      {/* ── Profile header ── */}
      <DetailPageHeader
        media={
          canManageProfilePhoto ? (
            <>
              <input
                id="profile-avatar-upload"
                name="profileAvatarUpload"
                ref={fileInputRef}
                type="file"
                aria-label={`Upload profile photo for ${profile.name}`}
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) setPendingAvatarFile(file);
                  e.target.value = "";
                }}
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild disabled={uploadingAvatar}>
                  <button
                    type="button"
                    aria-label={profile.avatarUrl ? `Change ${profile.name}'s profile photo` : `Upload ${profile.name}'s profile photo`}
                    className="relative group rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <UserAvatar
                      name={profile.name}
                      avatarUrl={profile.avatarUrl}
                      size="xl"
                      className="cursor-pointer ring-2 ring-border ring-offset-2 ring-offset-card"
                    />
                    <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 transition-opacity flex items-center justify-center group-hover:opacity-100 group-focus-visible:opacity-100">
                      {uploadingAvatar ? (
                        <Spinner className="size-6 text-white" />
                      ) : (
                        <CameraIcon className="size-6 text-white" />
                      )}
                    </div>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
                    <CameraIcon className="mr-2 size-4" />
                    {profile.avatarUrl ? "Change photo" : "Upload photo"}
                  </DropdownMenuItem>
                  {profile.avatarUrl && (
                    <DropdownMenuItem variant="destructive" onClick={removeAvatar}>
                      <TrashIcon className="mr-2 size-4" />
                      Remove photo
                    </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
          ) : (
            <UserAvatar
              name={profile.name}
              avatarUrl={profile.avatarUrl}
              size="xl"
              className="ring-2 ring-border ring-offset-2 ring-offset-card"
            />
          )
        }
        title={profile.name}
        subtitle={profile.email}
        meta={
          <>
            {profile.role !== "STUDENT" && profile.title && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Briefcase className="size-3 shrink-0" />
                {profile.title}
              </p>
            )}
            {profile.role === "STUDENT" && (() => {
              const y = deriveStudentYear(profile.gradYear, profile.studentYearOverride);
              if (!y) return null;
              const label = STUDENT_YEAR_OPTIONS.find((o) => o.value === y)?.label ?? y;
              const anticipatedGraduation = formatAnticipatedGraduation(
                profile.graduationTerm,
                profile.gradYear,
              );
              return (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <GraduationCap className="size-3 shrink-0" />
                  {label}
                  {anticipatedGraduation ? ` · ${anticipatedGraduation}` : ""}
                </p>
              );
            })()}
            {(profile.directReport || profile.directReportName) && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <UserRound className="size-3 shrink-0" />
                Reports to{" "}
                {profile.directReport ? (
                  <Link
                    href={`/users/${profile.directReport.id}`}
                    className="hover:underline"
                  >
                    {profile.directReport.name}
                  </Link>
                ) : (
                  <span>{profile.directReportName} <span className="text-[11px] text-muted-foreground">(external)</span></span>
                )}
              </p>
            )}
            {profile.createdAt && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarDays className="size-3 shrink-0" />
                Member since {formatDateFull(profile.createdAt)}
              </p>
            )}
            {profile.gameRecord && profile.gameRecord.wins + profile.gameRecord.losses + profile.gameRecord.ties > 0 && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Trophy className="size-3 shrink-0" />
                {profile.gameRecord.wins}–{profile.gameRecord.losses}{profile.gameRecord.ties > 0 ? `–${profile.gameRecord.ties}` : ""} on official games
              </p>
            )}
            {profile.gameRecord && profile.gameRecord.eventsWorked > 0 && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarDays className="size-3 shrink-0" />
                {profile.gameRecord.eventsWorked} events worked in 2026–27
              </p>
            )}
          </>
        }
        actions={
          <>
            <RoleBadge role={profile.role} />
            {profile.active === false && (
              <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>
            )}
            {(isSelf || currentUserRole === "ADMIN") && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="h-10 gap-1.5 active:scale-[0.96]" disabled={togglingActive}>
                    {currentUserRole === "ADMIN" ? <Shield /> : <UserRound />}
                    {currentUserRole === "ADMIN" ? "Admin actions" : "Profile actions"}
                    <ChevronDown className="size-3.5 opacity-70" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {isSelf && (
                    <DropdownMenuItem asChild>
                      <Link href="/settings/security">
                        <KeyRound />
                        Change password
                      </Link>
                    </DropdownMenuItem>
                  )}
                  {!isSelf && (
                    <>
                      <DropdownMenuItem onClick={toggleActive} disabled={togglingActive}>
                        {togglingActive
                          ? "Updating status..."
                          : profile.active !== false ? "Deactivate user" : "Activate user"}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setResetPwDialog(true)}>
                        <KeyRound className="mr-2 size-4" />
                        Reset password
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuItem onClick={openManualAwardDialog}>
                    <Award className="mr-2 size-4" />
                    Award badge
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />

      {isSelf && <ProfileCompletionNotice />}

      <AvatarCropDialog
        file={pendingAvatarFile}
        profileName={profile.name}
        onClose={() => setPendingAvatarFile(null)}
        onConfirm={uploadAvatar}
      />

      {/* Password Reset Dialog */}
      <AlertDialog open={resetPwDialog || !!tempPassword} onOpenChange={(open) => {
        if (!open) { setResetPwDialog(false); setTempPassword(null); }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tempPassword ? "Password Reset" : "Reset password?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {tempPassword ? (
                <div className="flex flex-col gap-3">
                  <p>New temporary password for <strong>{profile.name}</strong>:</p>
                  <div className="flex items-center gap-2">
                    <Input value={tempPassword} readOnly className="font-mono" />
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="Copy temporary password"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(tempPassword);
                          toast.success("Copied to clipboard");
                        } catch {
                          toast.error("Could not copy. Select the password and copy it manually.");
                        }
                      }}
                    >
                      <Copy className="size-4" />
                    </Button>
                  </div>
                  <p className="text-xs">This password is shown only once. The user&apos;s existing sessions have been invalidated.</p>
                </div>
              ) : (
                <>This will generate a new temporary password for <strong>{profile.name}</strong> and invalidate all their current sessions.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {tempPassword ? (
              <AlertDialogAction onClick={() => { setTempPassword(null); setResetPwDialog(false); }}>Done</AlertDialogAction>
            ) : (
              <>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handlePasswordReset} disabled={resetBusy}>
                  {resetBusy ? "Resetting…" : "Reset password"}
                </AlertDialogAction>
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={awardDialogOpen} onOpenChange={setAwardDialogOpen}>
        <DialogContent className="max-w-lg overflow-hidden border-0 p-0 shadow-[0_24px_80px_rgba(0,0,0,0.22),0_0_0_1px_var(--border)] sm:rounded-2xl">
          <DialogTitle className="sr-only">Award badge to {profile.name}</DialogTitle>
          <DialogDescription className="sr-only">
            Award an existing catalog badge or create a custom manual badge for {profile.name}.
          </DialogDescription>
          <AwardPreviewHeader
            mode={awardMode}
            selectedDefinition={selectedAwardDefinition}
            selectedRarity={selectedAwardRarity}
            customName={customAwardName.trim()}
            customIcon={customAwardIcon}
            profileName={profile.name}
          />
          <DialogBody className="flex flex-col gap-4 bg-background px-6 py-5">
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-1">
              <Button
                type="button"
                variant={awardMode === "existing" ? "secondary" : "ghost"}
                className="h-10"
                onClick={() => setAwardMode("existing")}
                disabled={awardBusy || awardDefinitionsLoading}
              >
                Existing
              </Button>
              <Button
                type="button"
                variant={awardMode === "custom" ? "secondary" : "ghost"}
                className="h-10"
                onClick={() => setAwardMode("custom")}
                disabled={awardBusy}
              >
                Custom
              </Button>
            </div>
            <div className="flex flex-col gap-3">
              {awardMode === "existing" ? (
                <>
                  <div className="flex flex-col gap-2">
                    <label htmlFor="badge-definition" className="text-sm font-medium">
                      Badge
                    </label>
                    <Select
                      value={selectedAwardDefinitionId}
                      onValueChange={setSelectedAwardDefinitionId}
                      disabled={awardDefinitionsLoading || awardBusy}
                    >
                      <SelectTrigger id="badge-definition">
                        <SelectValue placeholder={awardDefinitionsLoading ? "Loading badges..." : "Select a badge"} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {(awardDefinitions ?? []).map((definition) => (
                            <SelectItem key={definition.id} value={definition.id}>
                              {definition.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>
                  {awardDefinitions?.length === 0 && !awardDefinitionsLoading && (
                    <p className="text-sm text-muted-foreground">
                      No active manual-awardable badges are available. Create a custom badge instead.
                    </p>
                  )}
                  {selectedAwardDefinition && selectedAwardRarity && (
                    <div className="rounded-xl bg-muted/40 px-4 py-3 shadow-[inset_0_0_0_1px_var(--border)]">
                      <p className="text-sm leading-6 text-muted-foreground">
                        {manualAwardGuidance[selectedAwardDefinition.key] ?? selectedAwardDefinition.description}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Badge variant={badgeRarityVariant(selectedAwardRarity)} size="sm">{selectedAwardRarity}</Badge>
                        <Badge variant="outline" size="sm" className="font-mono">{selectedAwardDefinition.category.toLowerCase()}</Badge>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="grid gap-3">
                  <div className="grid gap-2">
                    <label htmlFor="custom-badge-name" className="text-sm font-medium">
                      Badge name
                    </label>
                    <Input
                      id="custom-badge-name"
                      value={customAwardName}
                      onChange={(event) => setCustomAwardName(event.target.value)}
                      placeholder="Guinea Pig"
                      maxLength={80}
                      disabled={awardBusy}
                    />
                  </div>
                  <div className="grid gap-2">
                    <label htmlFor="custom-badge-description" className="text-sm font-medium">
                      Description
                    </label>
                    <Input
                      id="custom-badge-description"
                      value={customAwardDescription}
                      onChange={(event) => setCustomAwardDescription(event.target.value)}
                      placeholder="Signed up early to help test the app."
                      maxLength={180}
                      disabled={awardBusy}
                    />
                  </div>
                  <div className="grid gap-2">
                    <span className="text-sm font-medium">Icon</span>
                    <CustomIconPicker
                      value={customAwardIcon}
                      onChange={setCustomAwardIcon}
                      disabled={awardBusy}
                    />
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">
                    Custom badges are saved to the active catalog, so you can reuse this badge for the next staff member.
                  </p>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="badge-note" className="text-sm font-medium">
                Note <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Textarea
                id="badge-note"
                value={awardNote}
                onChange={(event) => setAwardNote(event.target.value)}
                placeholder="Why this person deserves this recognition..."
                maxLength={500}
                disabled={awardBusy}
                rows={3}
              />
              {(selectedAwardRarity === "Rare" || selectedAwardRarity === "Legendary") && !awardNote.trim() && (
                <p className="text-xs text-[var(--orange-text)]">
                  A note is recommended for {selectedAwardRarity} awards.
                </p>
              )}
            </div>
          </DialogBody>
          <DialogFooter className="border-t border-border/40 bg-background px-6 py-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setAwardDialogOpen(false)}
              disabled={awardBusy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleManualAward}
              disabled={
                awardBusy ||
                awardDefinitionsLoading ||
                (awardMode === "existing" ? !selectedAwardDefinitionId : !customAwardName.trim() || !customAwardDescription.trim())
              }
            >
              {awardBusy && <Spinner />}
              {awardMode === "custom" ? "Create and award" : "Award badge"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => switchTab(v as TabKey)}>
        <TabsList className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm overflow-x-auto scrollbar-hide">
          {availableTabs.map((tab) => (
            <TabsTrigger
              key={tab.key}
              value={tab.key}
              className="relative shrink-0 gap-1.5 border-b-transparent data-[state=active]:border-b-transparent after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[var(--wi-red)] after:opacity-0 after:transition-opacity data-[state=active]:after:opacity-100"
            >
              <span style={{ fontFamily: "var(--font-heading)", fontWeight: 500 }}>{tab.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Tab Content */}
      {activeTab === "info" && (
        <UserInfoTab
          user={user}
          locations={locations}
          locationsLoading={formOptionsLoading}
          locationsError={Boolean(formOptionsError)}
          onRetryLocations={reloadFormOptions}
          currentUserRole={currentUserRole}
          isSelf={isSelf}
          onUpdated={loadUser}
        />
      )}

      {activeTab === "scoreboard" && (
        <UserScoreboardTab userId={user.id} />
      )}

      {activeTab === "activity" && (
        <UserActivityTab userId={user.id} />
      )}

      {activeTab === "availability" && hasStudentAvailability && (
        <UserAvailabilityTab userId={user.id} canEdit={canEdit} currentUserRole={currentUserRole} />
      )}

      {activeTab === "badges" && (
        <UserBadgesTab
          key={badgesTabRevision}
          userId={user.id}
          canRevoke={currentUserRole === "ADMIN"}
          canAward={currentUserRole === "ADMIN"}
          onAwardRequest={handleAwardRequest}
        />
      )}
    </FadeUp>
  );
}
