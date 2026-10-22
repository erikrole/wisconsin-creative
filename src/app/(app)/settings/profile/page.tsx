"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/UserAvatar";
import EmptyState from "@/components/EmptyState";
import { useFetch } from "@/hooks/use-fetch";
import {
  handleAuthRedirect,
  isAbortError,
  parseErrorMessage,
  parseJsonSafely,
} from "@/lib/errors";
import { AREA_OPTIONS } from "@/app/(app)/staff/types";
import { PROFILE_COMPLETION_QUERY_KEY } from "@/hooks/use-profile-completion";
import { SettingsPageShell } from "../SettingsPageShell";
import { SettingsGroup, SettingsRow } from "../_components/SettingsGroup";
import { ShiftCalendarFeed } from "../_components/ShiftCalendarFeed";
import { SettingsSaveBar } from "../_components/SettingsSaveBar";
import { formatPhoneInput } from "@/lib/profile-phone";
import { syncCachedUserLists } from "@/lib/user-list-cache";
import { useCurrentUser } from "@/hooks/use-current-user";
import { isDirty } from "@/lib/utils";

type Profile = {
  id: string;
  name: string;
  personalPhone: string | null;
  workPhone: string | null;
  workPhoneNotApplicable: boolean;
  wiscardNumber: string | null;
  avatarUrl: string | null;
  primaryArea: "VIDEO" | "PHOTO" | "GRAPHICS" | "SOCIAL" | "COMMS" | "LIVE_PRODUCTION" | null;
  title: string | null;
  athleticsEmail: string | null;
  slackHandle: string | null;
};

type FormState = Omit<Profile, "id" | "avatarUrl" | "workPhoneNotApplicable">;

function toForm(p: Profile): FormState {
  return {
    name: p.name,
    personalPhone: formatPhoneInput(p.personalPhone ?? ""),
    workPhone: formatPhoneInput(p.workPhone ?? ""),
    wiscardNumber: p.wiscardNumber ?? "",
    primaryArea: p.primaryArea,
    title: p.title ?? "",
    athleticsEmail: p.athleticsEmail ?? "",
    slackHandle: p.slackHandle ?? "",
  };
}

export default function ProfileSettingsPage() {
  const queryClient = useQueryClient();
  const { data: currentUser } = useCurrentUser();
  const isCollaborator = currentUser?.role === "COLLABORATOR";
  const { data: fetched, loading, error, reload } = useFetch<Profile>({
    url: "/api/me/profile",
    returnTo: "/settings/profile",
    transform: (json) => json.data as Profile,
  });

  const [local, setLocal] = useState<FormState | null>(null);
  const [prevFetched, setPrevFetched] = useState(fetched);
  if (fetched !== prevFetched) {
    setPrevFetched(fetched);
    setLocal(null);
  }

  const base = fetched ? toForm(fetched) : null;
  const form = local ?? base;
  const dirty = base && form ? isDirty(form, base) : false;

  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const savingRef = useRef(false);

  // Avatar state managed separately (different endpoint)
  const [avatarUrl, setAvatarUrl] = useState<string | null | undefined>(undefined);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const uploadingAvatarRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const effectiveAvatarUrl = avatarUrl === undefined ? (fetched?.avatarUrl ?? null) : avatarUrl;

  function syncProfileCache(profile: Profile) {
    queryClient.setQueryData(["fetch", "/api/me/profile"], { data: profile });
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setLocal((prev) => ({ ...(prev ?? base!), [key]: value }));
    if (key === "name") setNameError(null);
  }

  async function handleSave() {
    if (!form || !fetched) return;
    if (savingRef.current) return;
    if (!form.name.trim()) {
      setNameError("Name is required.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const res = await fetch("/api/me/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          personalPhone: form.personalPhone || null,
          workPhone: form.workPhone || null,
          wiscardNumber: form.wiscardNumber || null,
          primaryArea: form.primaryArea || null,
          title: form.title || null,
          athleticsEmail: form.athleticsEmail || null,
          slackHandle: form.slackHandle || null,
        }),
      });

      if (res.status === 401) { handleAuthRedirect(res, "/settings/profile"); return; }

      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Failed to save profile.");
        toast.error(msg);
        return;
      }

      const json = await parseJsonSafely<{ data?: Profile }>(res);
      if (!json?.data) {
        toast.error("Profile was saved, but the response could not be read. Refresh before continuing.");
        reload();
        return;
      }

      syncProfileCache(json.data);
      await syncCachedUserLists(queryClient, fetched.id, json.data);
      await queryClient.invalidateQueries({ queryKey: PROFILE_COMPLETION_QUERY_KEY });
      setLocal(null);
      setAvatarUrl(undefined);
      toast.success("Profile saved.");
    } catch (err) {
      if (isAbortError(err)) return;
      toast.error("Could not reach the server. Check your connection.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function handleAvatarUpload(file: File) {
    if (!fetched) return;
    if (uploadingAvatarRef.current) return;
    uploadingAvatarRef.current = true;
    setUploadingAvatar(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/users/${fetched.id}/avatar`, { method: "POST", body: fd });
      if (res.status === 401) { handleAuthRedirect(res, "/settings/profile"); return; }
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Avatar upload failed.");
        toast.error(msg);
        return;
      }
      const json = await parseJsonSafely<{ data?: { avatarUrl?: string | null } }>(res);
      if (!json?.data) {
        toast.error("Photo was uploaded, but the response could not be read. Refresh profile before continuing.");
        reload();
        return;
      }
      const nextAvatarUrl = json.data.avatarUrl ?? null;
      setAvatarUrl(nextAvatarUrl);
      if (fetched) syncProfileCache({ ...fetched, avatarUrl: nextAvatarUrl });
      await syncCachedUserLists(queryClient, fetched.id, { avatarUrl: nextAvatarUrl });
      toast.success("Profile photo updated.");
    } catch (err) {
      if (isAbortError(err)) return;
      toast.error("Upload failed. Check your connection.");
    } finally {
      uploadingAvatarRef.current = false;
      setUploadingAvatar(false);
    }
  }

  async function handleAvatarRemove() {
    if (!fetched || !effectiveAvatarUrl) return;
    if (uploadingAvatarRef.current) return;
    uploadingAvatarRef.current = true;
    setUploadingAvatar(true);
    try {
      const res = await fetch(`/api/users/${fetched.id}/avatar`, { method: "DELETE" });
      if (res.status === 401) { handleAuthRedirect(res, "/settings/profile"); return; }
      if (!res.ok) {
        toast.error("Could not remove photo.");
        return;
      }
      setAvatarUrl(null);
      syncProfileCache({ ...fetched, avatarUrl: null });
      await syncCachedUserLists(queryClient, fetched.id, { avatarUrl: null });
      toast.success("Profile photo removed.");
    } catch (err) {
      if (isAbortError(err)) return;
      toast.error("Remove failed. Check your connection.");
    } finally {
      uploadingAvatarRef.current = false;
      setUploadingAvatar(false);
    }
  }

  if (loading) {
    return (
      <SettingsPageShell href="/settings/profile">
        <div className="flex flex-col gap-7">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </SettingsPageShell>
    );
  }

  if (error || !form) {
    const msg = error === "network"
      ? "Could not reach the server. Check your connection."
      : "Could not load profile.";
    return (
      <SettingsPageShell href="/settings/profile">
        <EmptyState
          inline
          icon={error === "network" ? "wifi-off" : "users"}
          title={error === "network" ? "You are offline" : "Could not load profile"}
          description={msg}
          actionLabel="Retry"
          onAction={reload}
        />
      </SettingsPageShell>
    );
  }

  return (
    <SettingsPageShell href="/settings/profile" mainClassName="flex flex-col gap-7">
      <SettingsGroup>
        <div className="flex flex-wrap items-center gap-4 px-4 py-5">
          <div className="relative shrink-0">
            <UserAvatar name={form.name || "?"} avatarUrl={effectiveAvatarUrl} size="xl" />
            {uploadingAvatar && (
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-background/70">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="m-0 text-base font-bold">{form.name || "Your name"}</p>
            <p className="m-0 mt-0.5 text-[13px] text-muted-foreground">JPG, PNG, or WebP up to 4.5 MB.</p>
            <div className="mt-2.5 flex gap-2">
              <Button
                className="h-10"
                variant="outline"
                disabled={uploadingAvatar || saving}
                onClick={() => fileInputRef.current?.click()}
              >
                <Camera className="size-4" />
                {effectiveAvatarUrl ? "Change photo" : "Add photo"}
              </Button>
              {effectiveAvatarUrl && (
                <Button
                  className="h-10"
                  variant="ghost"
                  disabled={uploadingAvatar || saving}
                  onClick={handleAvatarRemove}
                >
                  <Trash2 className="size-4" />
                  Remove
                </Button>
              )}
            </div>
          </div>
          <input
            ref={fileInputRef}
            id="profile-avatar-file"
            name="profileAvatarFile"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleAvatarUpload(file);
              e.target.value = "";
            }}
          />
        </div>
      </SettingsGroup>

      <SettingsGroup title={isCollaborator ? "Your name" : "About you"}>
        <SettingsRow label="Name" htmlFor="profile-name">
          <Input
            id="profile-name"
            name="name"
            autoComplete="name"
            value={form.name}
            onChange={(e) => setField("name", e.target.value)}
            placeholder="Full name"
            aria-invalid={!!nameError}
            disabled={saving}
          />
          {nameError && <p className="m-0 mt-1.5 text-xs text-destructive">{nameError}</p>}
        </SettingsRow>
        {!isCollaborator && (
          <>
            <SettingsRow label="Title" htmlFor="profile-title">
              <Input
                id="profile-title"
                name="title"
                autoComplete="organization-title"
                value={form.title ?? ""}
                onChange={(e) => setField("title", e.target.value)}
                placeholder="e.g. Video Producer"
                disabled={saving}
              />
            </SettingsRow>
            <SettingsRow label="Primary area" htmlFor="profile-area">
              <Select
                name="primaryArea"
                value={form.primaryArea ?? "__none__"}
                onValueChange={(v) =>
                  setField("primaryArea", v === "__none__" ? null : v as FormState["primaryArea"])
                }
                disabled={saving}
              >
                <SelectTrigger id="profile-area">
                  <SelectValue placeholder="Select area" />
                </SelectTrigger>
                <SelectContent><SelectGroup>
                  <SelectItem value="__none__">None</SelectItem>
                  {AREA_OPTIONS.map((a) => (
                    <SelectItem key={a.value} value={a.value}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectGroup></SelectContent>
              </Select>
            </SettingsRow>
          </>
        )}
      </SettingsGroup>

      {!isCollaborator && (
        <>
          <SettingsGroup title="Contact">
          <SettingsRow label="Personal phone" htmlFor="profile-personal-phone">
            <Input
              id="profile-personal-phone"
              name="personalPhone"
              type="tel"
              autoComplete="tel"
              placeholder="(XXX) XXX-XXXX"
              value={form.personalPhone ?? ""}
              onChange={(e) => setField("personalPhone", formatPhoneInput(e.target.value))}
              disabled={saving}
            />
          </SettingsRow>
          <SettingsRow label="Work phone" htmlFor="profile-work-phone">
            <Input
              id="profile-work-phone"
              name="workPhone"
              type="tel"
              autoComplete="work tel"
              placeholder={fetched?.workPhoneNotApplicable ? "No work phone" : "(XXX) XXX-XXXX"}
              value={form.workPhone ?? ""}
              onChange={(e) => setField("workPhone", formatPhoneInput(e.target.value))}
              disabled={saving}
            />
          </SettingsRow>
          <SettingsRow label="Athletics email" htmlFor="profile-athletics-email" description="Your UW Athletics address, separate from your login email.">
            <Input
              id="profile-athletics-email"
              name="athleticsEmail"
              type="email"
              autoComplete="email"
              placeholder="you@athletics.wisc.edu"
              value={form.athleticsEmail ?? ""}
              onChange={(e) => setField("athleticsEmail", e.target.value)}
              disabled={saving}
            />
          </SettingsRow>
          <SettingsRow label="Slack handle" htmlFor="profile-slack">
            <Input
              id="profile-slack"
              name="slackHandle"
              autoComplete="off"
              placeholder="@handle"
              value={form.slackHandle ?? ""}
              onChange={(e) => setField("slackHandle", e.target.value)}
              disabled={saving}
            />
          </SettingsRow>
          </SettingsGroup>

          <SettingsGroup title="Kiosk">
          <SettingsRow label="Wiscard value" htmlFor="profile-wiscard" description="Lets the kiosk recognize you.">
            <Input
              id="profile-wiscard"
              name="wiscardNumber"
              autoComplete="off"
              placeholder="Scan or type"
              value={form.wiscardNumber ?? ""}
              onChange={(e) => setField("wiscardNumber", e.target.value)}
              disabled={saving}
            />
          </SettingsRow>
          </SettingsGroup>
        </>
      )}

      <SettingsSaveBar
        dirty={Boolean(dirty)}
        saving={saving}
        onReset={() => { setLocal(null); setNameError(null); }}
        onSave={() => { void handleSave(); }}
      />

      {!isCollaborator && <ShiftCalendarFeed />}
    </SettingsPageShell>
  );
}
