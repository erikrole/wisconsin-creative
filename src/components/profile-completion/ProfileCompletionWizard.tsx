"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import { AlertCircleIcon, ArrowLeftIcon, ArrowRightIcon, CameraIcon, CheckIcon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { UserAvatar } from "@/components/UserAvatar";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { OPEN_PROFILE_COMPLETION_EVENT } from "@/lib/profile-completion-events";
import {
  PROFILE_STEP_COPY,
  PROFILE_STEP_SHORT_LABELS,
  visibleProfileSteps,
  type ProfileCompletionStep,
} from "@/lib/profile-completion";
import { uploadAvatarPhoto } from "@/lib/avatar-upload";
import { syncAvatarCaches } from "@/lib/user-list-cache";
import { AvatarCropDialog } from "@/app/(app)/staff/[id]/AvatarCropDialog";
import { formatPhoneInput } from "@/lib/profile-phone";
import { APPAREL_FIT_OPTIONS, MENS_SHOE_SIZE_OPTIONS, SHOE_SYSTEM_OPTIONS, TOP_SIZE_OPTIONS, WOMENS_SHOE_SIZE_OPTIONS } from "@/lib/profile-sizing";
import {
  anticipatedGraduationOptions,
  anticipatedGraduationValue,
  parseAnticipatedGraduation,
  STUDENT_YEAR_OPTIONS,
  type StudentYearValue,
} from "@/lib/student-profile";
import {
  PROFILE_COMPLETION_QUERY_KEY,
  fetchProfileCompletion,
  type ProfileCompletionResponse,
  useProfileCompletion,
} from "@/hooks/use-profile-completion";
import { cn } from "@/lib/utils";
import { useOnboardingSave } from "@/hooks/use-onboarding-save";
import type { OnboardingGroup } from "@/lib/onboarding-save";

type LegacyPhoneType = "PERSONAL" | "WORK" | "";
type ApiEnvelope = { data?: ProfileCompletionResponse };
type StepDirection = -1 | 1;
type StepMotionContext = { direction: StepDirection; reduceMotion: boolean };
const GRADUATION_OPTIONS = anticipatedGraduationOptions();
const STEP_EASE_OUT = [0.16, 1, 0.3, 1] as const;
const STEP_EASE_IN_OUT = [0.4, 0, 0.2, 1] as const;

const STEP_TRANSITION_VARIANTS: Variants = {
  initial: ({ direction, reduceMotion }: StepMotionContext) => ({
    opacity: 0,
    ...(reduceMotion ? {} : { transform: `translate3d(0, ${direction * 4}px, 0)` }),
  }),
  animate: ({ reduceMotion }: StepMotionContext) => ({
    opacity: 1,
    ...(reduceMotion ? {} : { transform: "translate3d(0, 0, 0)" }),
    transition: {
      duration: reduceMotion ? 0.12 : 0.2,
      ease: STEP_EASE_OUT,
    },
  }),
  exit: ({ direction, reduceMotion }: StepMotionContext) => ({
    opacity: 0,
    ...(reduceMotion ? {} : { transform: `translate3d(0, ${direction * -4}px, 0)` }),
    transition: {
      duration: 0.12,
      ease: STEP_EASE_IN_OUT,
    },
  }),
};

function isKnownOption(value: string | null, options: string[]) {
  return Boolean(value && options.includes(value));
}

type ProfileCompletionWizardProps = {
  onComplete?: () => void;
  onSnooze?: () => void;
  autoOpen?: boolean;
  /**
   * `dialog` — returning-user modal in the app shell.
   * `page` — first-session inline setup on `/welcome` (matches native Welcome).
   */
  presentation?: "dialog" | "page";
};

export function ProfileCompletionWizard({
  onComplete,
  onSnooze,
  autoOpen = true,
  presentation = "dialog",
}: ProfileCompletionWizardProps = {}) {
  const isPage = presentation === "page";
  const queryClient = useQueryClient();
  const { data } = useProfileCompletion();
  const reduceMotion = Boolean(useReducedMotion());
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<ProfileCompletionStep>("EMAIL");
  const [stepDirection, setStepDirection] = useState<StepDirection>(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [needsProfileRefresh, setNeedsProfileRefresh] = useState(false);
  const autoOpenedRef = useRef(false);
  const closeWithoutSnoozeRef = useRef(false);
  const manualReviewRef = useRef(false);

  const [athleticsEmail, setAthleticsEmail] = useState("");
  const [legacyPhoneType, setLegacyPhoneType] = useState<LegacyPhoneType>("");
  const [personalPhone, setPersonalPhone] = useState("");
  const [workPhone, setWorkPhone] = useState("");
  const [noWorkPhone, setNoWorkPhone] = useState(false);
  const [wiscardCardNumber, setWiscardCardNumber] = useState("");
  const [wiscardIssueCode, setWiscardIssueCode] = useState("");
  const [studentYear, setStudentYear] = useState<StudentYearValue | "">("");
  const [anticipatedGraduation, setAnticipatedGraduation] = useState("");
  const [topSizeFit, setTopSizeFit] = useState<"UNISEX" | "WOMENS" | "MENS" | "">("");
  const [topSizeChoice, setTopSizeChoice] = useState("");
  const [topSizeOther, setTopSizeOther] = useState("");
  const [shoeSizeSystem, setShoeSizeSystem] = useState<"US_WOMENS" | "US_MENS" | "">("");
  const [shoeSizeChoice, setShoeSizeChoice] = useState("");
  const [shoeSizeOther, setShoeSizeOther] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const graduationDraft = parseAnticipatedGraduation(anticipatedGraduation);
  const autosave = useOnboardingSave({
    data,
    onResume: (next) => {
      if (isPage && next.completion.firstIncompleteStep) setStep(next.completion.firstIncompleteStep);
    },
    values: {
      athleticsEmail: athleticsEmail.trim() || null, personalPhone: personalPhone.trim() || null,
      workPhone: noWorkPhone ? null : workPhone.trim() || null, workPhoneNotApplicable: noWorkPhone,
      wiscardCardNumber: wiscardCardNumber || null, wiscardIssueCode: wiscardIssueCode || null,
      studentYearOverride: studentYear || null,
      graduationTerm: graduationDraft?.term ?? null, gradYear: graduationDraft?.year ?? null,
      topSizeFit: topSizeFit || null, topSize: topSizeChoice === "OTHER" ? topSizeOther.trim() : topSizeChoice || null,
      shoeSizeSystem: shoeSizeSystem || null, shoeSize: shoeSizeChoice === "OTHER" ? shoeSizeOther.trim() : shoeSizeChoice || null,
    },
    applyGroup: (group, profile) => {
      if (group === "EMAIL") setAthleticsEmail(profile.athleticsEmail ?? "");
      if (group === "PERSONAL_PHONE") setPersonalPhone(profile.personalPhone ?? (profile.role === "STUDENT" ? profile.phone : null) ?? "");
      if (group === "WORK_PHONE") { setWorkPhone(profile.workPhone ?? ""); setNoWorkPhone(profile.workPhoneNotApplicable); }
      if (group === "WISCARD") { setWiscardCardNumber(profile.wiscardCardNumber ?? ""); setWiscardIssueCode(profile.wiscardIssueCode ?? ""); }
      if (group === "STUDENT") setStudentYear(profile.studentYearOverride ?? "");
      if (group === "GRADUATION") setAnticipatedGraduation(anticipatedGraduationValue(profile.graduationTerm, profile.gradYear));
      if (group === "CLOTHING") {
        setTopSizeFit(profile.topSizeFit ?? "");
        const known = !profile.topSize || isKnownOption(profile.topSize, [...TOP_SIZE_OPTIONS]);
        setTopSizeChoice(known ? profile.topSize ?? "" : "OTHER"); setTopSizeOther(known ? "" : profile.topSize ?? "");
      }
      if (group === "SHOES") {
        setShoeSizeSystem(profile.shoeSizeSystem ?? "");
        const options = profile.shoeSizeSystem === "US_MENS" ? MENS_SHOE_SIZE_OPTIONS : WOMENS_SHOE_SIZE_OPTIONS;
        const known = !profile.shoeSize || isKnownOption(profile.shoeSize, options);
        setShoeSizeChoice(known ? profile.shoeSize ?? "" : "OTHER"); setShoeSizeOther(known ? "" : profile.shoeSize ?? "");
      }
    },
  });

  useEffect(() => {
    // Background refreshes must not replace details the person is typing.
    if (!data || open) return;
    const profile = data.profile;
    setAthleticsEmail(profile.athleticsEmail ?? "");
    setPersonalPhone(profile.personalPhone ?? (profile.role === "STUDENT" ? profile.phone : null) ?? "");
    setWorkPhone(profile.workPhone ?? "");
    setNoWorkPhone(profile.workPhoneNotApplicable);
    setLegacyPhoneType(
      profile.phone && profile.phone === profile.personalPhone
        ? "PERSONAL"
        : profile.phone && profile.phone === profile.workPhone
          ? "WORK"
          : "",
    );
    setWiscardCardNumber(profile.wiscardCardNumber ?? "");
    setWiscardIssueCode(profile.wiscardIssueCode ?? "");
    setStudentYear(profile.studentYearOverride ?? "");
    setAnticipatedGraduation(anticipatedGraduationValue(profile.graduationTerm, profile.gradYear));
    setTopSizeFit(profile.topSizeFit ?? "");
    if (isKnownOption(profile.topSize, [...TOP_SIZE_OPTIONS])) {
      setTopSizeChoice(profile.topSize ?? "");
      setTopSizeOther("");
    } else if (profile.topSize) {
      setTopSizeChoice("OTHER");
      setTopSizeOther(profile.topSize);
    }
    setShoeSizeSystem(profile.shoeSizeSystem ?? "");
    const shoeOptions = profile.shoeSizeSystem === "US_MENS" ? MENS_SHOE_SIZE_OPTIONS : WOMENS_SHOE_SIZE_OPTIONS;
    if (isKnownOption(profile.shoeSize, shoeOptions)) {
      setShoeSizeChoice(profile.shoeSize ?? "");
      setShoeSizeOther("");
    } else if (profile.shoeSize) {
      setShoeSizeChoice("OTHER");
      setShoeSizeOther(profile.shoeSize);
    }
  }, [data, open]);

  useEffect(() => {
    if (!data) return;
    if (isPage) {
      if (autoOpenedRef.current) return;
      autoOpenedRef.current = true;
      setStep(
        data.completion.firstIncompleteStep
          ?? visibleProfileSteps(data.profile.role)[0]!,
      );
      setOpen(true);
      return;
    }
    if (!autoOpen || !data.completion.shouldPrompt || autoOpenedRef.current) return;
    autoOpenedRef.current = true;
    setStep(
      data.completion.firstIncompleteStep
        ?? visibleProfileSteps(data.profile.role)[0]!,
    );
    setOpen(true);
  }, [autoOpen, data, isPage]);

  useEffect(() => {
    const openWizard = () => {
      if (!data) return;
      closeWithoutSnoozeRef.current = false;
      manualReviewRef.current = data.completion.isComplete;
      setError("");
      setStep(data.completion.firstIncompleteStep ?? visibleProfileSteps(data.profile.role)[0]!);
      setOpen(true);
    };
    window.addEventListener(OPEN_PROFILE_COMPLETION_EVENT, openWizard);
    return () => window.removeEventListener(OPEN_PROFILE_COMPLETION_EVENT, openWizard);
  }, [data]);

  const visibleSteps = useMemo(() => data ? visibleProfileSteps(data.profile.role) : [], [data]);
  const stepIndex = visibleSteps.indexOf(step);
  const isLastStep = stepIndex === visibleSteps.length - 1;
  const shoeOptions = shoeSizeSystem === "US_MENS" ? MENS_SHOE_SIZE_OPTIONS : WOMENS_SHOE_SIZE_OPTIONS;
  const selectedTopSize = topSizeChoice === "OTHER" ? topSizeOther.trim() : topSizeChoice;
  const selectedShoeSize = shoeSizeChoice === "OTHER" ? shoeSizeOther.trim() : shoeSizeChoice;
  const clothingLabel = APPAREL_FIT_OPTIONS.find((option) => option.value === topSizeFit)?.label;
  const shoeSystemLabel = SHOE_SYSTEM_OPTIONS.find((option) => option.value === shoeSizeSystem)?.label;
  const legacyPhone = data?.profile.phone?.trim() ?? "";
  const isStudent = data?.profile.role === "STUDENT";
  const isCollaborator = data?.profile.role === "COLLABORATOR";
  // Students and collaborators get a single personal-phone field — no work
  // phone, no legacy-number classification.
  const hasSimplePhoneStep = isStudent || isCollaborator;
  const copy = step === "PHONES" && hasSimplePhoneStep
    ? { title: "Add your phone number", description: "Add the personal phone number we should use to reach you." }
    : PROFILE_STEP_COPY[step];
  const requiresSetup = data?.completion.requiresSetup === true;
  const isOptionalStep = step === "PHOTO" || (step === "APPAREL" && !requiresSetup);
  const stepMotionContext = { direction: stepDirection, reduceMotion };
  const needsLegacyClassification = Boolean(
    !hasSimplePhoneStep && legacyPhone && !data?.profile.personalPhone && !data?.profile.workPhone,
  );

  const canContinue = useMemo(() => {
    if (!data) return false;
    if (step === "EMAIL") {
      return data.profile.email.toLowerCase().endsWith("@wisc.edu")
        && athleticsEmail.trim().toLowerCase().endsWith("@athletics.wisc.edu");
    }
    if (step === "PHONES") {
      const personalPhoneIsComplete = personalPhone.replace(/\D/g, "").length === 10;
      if (hasSimplePhoneStep) return personalPhoneIsComplete;
      return (!needsLegacyClassification || Boolean(legacyPhoneType))
        && personalPhoneIsComplete
        && (noWorkPhone || workPhone.replace(/\D/g, "").length === 10);
    }
    if (step === "WISCARD") {
      return /^\d{10}$/.test(wiscardCardNumber.trim()) && /^\d$/.test(wiscardIssueCode.trim());
    }
    if (step === "STUDENT") {
      return Boolean(studentYear);
    }
    if (step === "PHOTO") return Boolean(data.profile.avatarUrl);
    const topSize = topSizeChoice === "OTHER" ? topSizeOther.trim() : topSizeChoice;
    const shoeSize = shoeSizeChoice === "OTHER" ? shoeSizeOther.trim() : shoeSizeChoice;
    return Boolean(topSizeFit && topSize && shoeSizeSystem && shoeSize);
  }, [
    athleticsEmail,
    data,
    hasSimplePhoneStep,
    legacyPhoneType,
    needsLegacyClassification,
    noWorkPhone,
    personalPhone,
    shoeSizeChoice,
    shoeSizeOther,
    shoeSizeSystem,
    step,
    studentYear,
    topSizeChoice,
    topSizeFit,
    topSizeOther,
    wiscardCardNumber,
    wiscardIssueCode,
    workPhone,
  ]);

  async function patchCompletion(body: Record<string, unknown>) {
    await autosave.protectMutation();
    const response = await fetch("/api/me/profile-completion", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (handleAuthRedirect(response)) return null;
    if (!response.ok) throw new Error(await parseErrorMessage(response, "Profile details were not saved."));
    const json = await parseJsonSafely<ApiEnvelope>(response);
    if (!json?.data) throw new Error("Profile details were saved, but the response could not be read. Refresh before continuing.");
    await autosave.protectMutation();
    await queryClient.cancelQueries({ queryKey: PROFILE_COMPLETION_QUERY_KEY });
    queryClient.setQueryData(PROFILE_COMPLETION_QUERY_KEY, json.data);
    setNeedsProfileRefresh(false);
    return json.data;
  }

  function goToStep(nextStep: ProfileCompletionStep, direction: StepDirection) {
    setStepDirection(direction);
    setStep(nextStep);
    setError("");
  }

  async function saveCurrentStep() {
    if (!canContinue || saving) return;
    setSaving(true);
    setError("");
    try {
      if (data?.versions) {
        const activeGroups: OnboardingGroup[] = step === "EMAIL" ? ["EMAIL"]
          : step === "PHONES" ? hasSimplePhoneStep ? ["PERSONAL_PHONE"] : ["PERSONAL_PHONE", "WORK_PHONE"]
          : step === "WISCARD" ? ["WISCARD"] : step === "STUDENT" ? ["STUDENT", "GRADUATION"] : ["CLOTHING", "SHOES"];
        activeGroups.forEach((group) => autosave.markDirty(group));
        if (!await autosave.flush()) return;
        goToStep(visibleSteps[Math.min(stepIndex + 1, visibleSteps.length - 1)]!, 1);
        return;
      }
      const graduation = parseAnticipatedGraduation(anticipatedGraduation);
      const body = step === "EMAIL"
        ? { step, athleticsEmail: athleticsEmail.trim() }
        : step === "PHONES"
          ? {
              step,
              personalPhone: personalPhone.trim(),
              ...(hasSimplePhoneStep ? {} : {
                workPhone: noWorkPhone ? null : workPhone.trim(),
                workPhoneNotApplicable: noWorkPhone,
              }),
            }
          : step === "WISCARD"
            ? {
                step,
                wiscardCardNumber: wiscardCardNumber.trim(),
                wiscardIssueCode: wiscardIssueCode.trim(),
              }
            : step === "STUDENT" && studentYear
              ? {
                  step,
                  studentYearOverride: studentYear,
                  ...(graduation ? { graduationTerm: graduation.term, gradYear: graduation.year } : {}),
                }
              : {
                  step,
                  topSizeFit,
                  topSize: topSizeChoice === "OTHER" ? topSizeOther.trim() : topSizeChoice,
                  shoeSizeSystem,
                  shoeSize: shoeSizeChoice === "OTHER" ? shoeSizeOther.trim() : shoeSizeChoice,
                };
      const updated = await patchCompletion(body);
      if (!updated) return;
      if (updated.completion.isComplete && (!manualReviewRef.current || isLastStep)) {
        closeWithoutSnoozeRef.current = true;
        manualReviewRef.current = false;
        setOpen(false);
        toast.success("Profile complete");
        onComplete?.();
        return;
      }
      goToStep(visibleSteps[Math.min(stepIndex + 1, visibleSteps.length - 1)]!, 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Profile details were not saved.");
    } finally {
      setSaving(false);
    }
  }

  async function uploadPhoto(file: File, expectedAvatarUrl: string | null, expectedActorId: string | null) {
    if (!data || saving) return false;
    setSaving(true);
    setError("");
    try {
      const avatarUrl = await uploadAvatarPhoto(data.profile.id, file, expectedAvatarUrl, expectedActorId);
      if (!avatarUrl) return false;
      await syncAvatarCaches(queryClient, data.profile.id, avatarUrl);
      try {
        await refreshProfile();
      } catch {
        setNeedsProfileRefresh(true);
      }
      toast.success("Profile photo saved");
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Profile photo was not saved.");
      throw reason instanceof Error ? reason : new Error("Your photo could not be saved. Your crop is still here.");
    } finally {
      setSaving(false);
    }
  }

  async function refreshProfile() {
    await queryClient.cancelQueries({ queryKey: PROFILE_COMPLETION_QUERY_KEY });
    const updated = await queryClient.fetchQuery({
      queryKey: PROFILE_COMPLETION_QUERY_KEY,
      queryFn: ({ signal }) => fetchProfileCompletion(signal),
      staleTime: 0,
    });
    if (!updated) throw new Error("Setup could not be refreshed.");
    setNeedsProfileRefresh(false);
  }

  async function retryProfileRefresh() {
    if (saving) return;
    setSaving(true);
    try {
      await refreshProfile();
    } catch {
      setNeedsProfileRefresh(true);
    } finally {
      setSaving(false);
    }
  }

  function skipOptionalStep() {
    if (isLastStep) {
      void snooze();
      return;
    }
    goToStep(visibleSteps[stepIndex + 1]!, 1);
  }

  async function finishPhotoStep() {
    if (saving) return;
    setSaving(true); setError("");
    try {
      if (!await autosave.flush()) return;
      let updated: ProfileCompletionResponse | null;
      try { updated = await patchCompletion({ step: "FINISH", expectedUserId: data?.profile.id }); }
      catch (error) {
        updated = await autosave.refresh();
        if (!updated?.completion.onboardingComplete) throw error;
      }
      if (!updated?.completion.onboardingComplete) return;
      closeWithoutSnoozeRef.current = true;
      setOpen(false);
      toast.success("Setup complete");
      onComplete?.();
    } catch (error) { setError(error instanceof Error ? error.message : "Couldn’t finish setup. Retry to continue."); }
    finally { setSaving(false); }
  }

  async function snooze() {
    if (saving || requiresSetup) return;
    setSaving(true);
    setError("");
    try {
      if (!await autosave.flush()) return;
      const updated = await patchCompletion({ step: "SNOOZE" });
      if (!updated) return;
      closeWithoutSnoozeRef.current = true;
      setOpen(false);
      toast.message("We’ll remind you tomorrow.");
      onSnooze?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The reminder could not be postponed.");
    } finally {
      setSaving(false);
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setOpen(true);
      return;
    }
    if (saving) return;
    if (closeWithoutSnoozeRef.current) {
      closeWithoutSnoozeRef.current = false;
      setOpen(false);
      return;
    }
    void snooze();
  }

  function classifyLegacyPhone(value: string) {
    if (value !== "PERSONAL" && value !== "WORK") return;
    setLegacyPhoneType(value);
    if (value === "PERSONAL") {
      setPersonalPhone(legacyPhone);
      if (workPhone === legacyPhone) setWorkPhone("");
    } else {
      setWorkPhone(legacyPhone);
      setNoWorkPhone(false);
      if (personalPhone === legacyPhone) setPersonalPhone("");
    }
    autosave.markDirty("PERSONAL_PHONE");
    autosave.markDirty("WORK_PHONE");
  }

  if (!data) return null;

  // Page presentation always shows the active step; dialog waits for open.
  if (!isPage && !open) {
    return (
      <AvatarCropDialog
        file={photoFile}
        profileName={data.profile.name}
        avatarUrl={data.profile.avatarUrl}
        onClose={() => setPhotoFile(null)}
        onConfirm={uploadPhoto}
      />
    );
  }

  const stepFields = (
              <div onBlurCapture={() => { void autosave.flush(); }}>
          <div className="mb-4 flex flex-col gap-2" aria-live="polite">
            <p className="text-xs text-muted-foreground">{autosave.state === "saving" ? "Saving…" : autosave.state === "saved" ? "Saved to your account" : autosave.message || "Changes waiting to save"}</p>
            {autosave.state === "error" && <Button type="button" variant="outline" className="self-start" onClick={() => { void autosave.flush(); }}>Retry save</Button>}
            {autosave.state === "conflict" && <Alert>
              <AlertCircleIcon aria-hidden="true" />
              <AlertDescription className="col-start-2 flex min-w-0 flex-col gap-3">
                <span>Some answers changed elsewhere. Use the saved answers or keep the edits shown in this form.</span>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={autosave.useSaved}>Use saved answers</Button>
                  <Button type="button" onClick={() => { void autosave.keepEdits(); }}>Save my answers</Button>
                </div>
              </AlertDescription>
            </Alert>}
          </div>
          {step === "EMAIL" && (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <Label htmlFor="profile-completion-campus-email">Campus email and site login</Label>
                <Input id="profile-completion-campus-email" type="email" value={data.profile.email} disabled />
                <p className="text-xs text-muted-foreground">Your site login must use your @wisc.edu address.</p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="profile-completion-athletics-email">Athletics email</Label>
                <Input
                  id="profile-completion-athletics-email"
                  name="athleticsEmail"
                  type="email"
                  autoComplete="email"
                  value={athleticsEmail}
                  onChange={(event) => { setAthleticsEmail(event.target.value); setError(""); autosave.markDirty("EMAIL"); }}
                  placeholder="name@athletics.wisc.edu"
                  aria-invalid={Boolean(athleticsEmail && !athleticsEmail.toLowerCase().endsWith("@athletics.wisc.edu"))}
                  disabled={saving}
                />
                <p className="text-xs text-muted-foreground">Everyone should enter their @athletics.wisc.edu address.</p>
              </div>
              {!data.profile.email.toLowerCase().endsWith("@wisc.edu") && (
                <Alert variant="destructive">
                  <AlertCircleIcon />
                  <AlertDescription>Your current login is not a @wisc.edu address. Ask an administrator to correct it before completing this step.</AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {step === "PHONES" && (
            <div className="flex flex-col gap-5">
              {needsLegacyClassification && (
                <div className="flex flex-col gap-2">
                  <Label id="legacy-phone-type-label">We already have {legacyPhone}. Which number is it?</Label>
                  <ToggleGroup
                    type="single"
                    value={legacyPhoneType}
                    onValueChange={classifyLegacyPhone}
                    aria-labelledby="legacy-phone-type-label"
                    className="self-start"
                  >
                    <ToggleGroupItem value="PERSONAL">Personal</ToggleGroupItem>
                    <ToggleGroupItem value="WORK">Work</ToggleGroupItem>
                  </ToggleGroup>
                </div>
              )}
              <div className={hasSimplePhoneStep ? "grid grid-cols-1 gap-4" : "grid grid-cols-1 gap-4 sm:grid-cols-2"}>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="profile-completion-personal-phone">Personal phone</Label>
                  <Input
                    id="profile-completion-personal-phone"
                    name="personalPhone"
                    type="tel"
                    autoComplete="tel"
                    value={personalPhone}
                    onChange={(event) => { setPersonalPhone(formatPhoneInput(event.target.value)); setError(""); autosave.markDirty("PERSONAL_PHONE"); }}
                    placeholder="(XXX) XXX-XXXX"
                    disabled={saving}
                  />
                </div>
                {!hasSimplePhoneStep && (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="profile-completion-work-phone">Work phone</Label>
                    <Input
                      id="profile-completion-work-phone"
                      name="workPhone"
                      type="tel"
                      autoComplete="work tel"
                      value={workPhone}
                      onChange={(event) => { setWorkPhone(formatPhoneInput(event.target.value)); setNoWorkPhone(false); setError(""); autosave.markDirty("WORK_PHONE"); }}
                      placeholder="(XXX) XXX-XXXX"
                      disabled={saving || noWorkPhone}
                    />
                  </div>
                )}
              </div>
              {!hasSimplePhoneStep && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="profile-completion-no-work-phone"
                    checked={noWorkPhone}
                    onCheckedChange={(checked) => { setNoWorkPhone(checked === true); if (checked) setWorkPhone(""); autosave.markDirty("WORK_PHONE", true); }}
                    disabled={saving}
                  />
                  <Label htmlFor="profile-completion-no-work-phone" className="font-normal">I don’t have a work phone</Label>
                </div>
              )}
            </div>
          )}

          {step === "WISCARD" && (
            <div className="flex flex-col gap-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_160px]">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="profile-completion-wiscard-number">Wiscard number</Label>
                  <Input
                    id="profile-completion-wiscard-number"
                    name="wiscardCardNumber"
                    inputMode="numeric"
                    autoComplete="off"
                    value={wiscardCardNumber}
                    onChange={(event) => { setWiscardCardNumber(event.target.value.replace(/\D/g, "").slice(0, 10)); autosave.markDirty("WISCARD"); }}
                    placeholder="XXXXXXXXXX"
                    disabled={saving}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="profile-completion-wiscard-issue">Issue code</Label>
                  <Input
                    id="profile-completion-wiscard-issue"
                    name="wiscardIssueCode"
                    inputMode="numeric"
                    autoComplete="off"
                    value={wiscardIssueCode}
                    onChange={(event) => { setWiscardIssueCode(event.target.value.replace(/\D/g, "").slice(0, 1)); autosave.markDirty("WISCARD"); }}
                    placeholder="X"
                    disabled={saving}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Issue code can be found in the bottom right of your Wiscard. Enter the 10-digit card number and the single-digit issue code.</p>
            </div>
          )}

          {step === "STUDENT" && (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <Label htmlFor="profile-completion-student-year">Year</Label>
                <Select value={studentYear} onValueChange={(value) => { setStudentYear(value as StudentYearValue); autosave.markDirty("STUDENT", true); }} disabled={saving}>
                  <SelectTrigger id="profile-completion-student-year"><SelectValue placeholder="Select year" /></SelectTrigger>
                  <SelectContent><SelectGroup>
                    {STUDENT_YEAR_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectGroup></SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="profile-completion-graduation">Anticipated graduation</Label>
                <Select value={anticipatedGraduation} onValueChange={(value) => { setAnticipatedGraduation(value); autosave.markDirty("GRADUATION", true); }} disabled={saving}>
                  <SelectTrigger id="profile-completion-graduation"><SelectValue placeholder="Select term and year" /></SelectTrigger>
                  <SelectContent><SelectGroup>
                    {GRADUATION_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectGroup></SelectContent>
                </Select>
              </div>
            </div>
          )}

          {step === "APPAREL" && (
            <div className="flex flex-col gap-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="profile-completion-top-fit">Clothing sizing</Label>
                  <Select value={topSizeFit} onValueChange={(value) => { setTopSizeFit(value as typeof topSizeFit); autosave.markDirty("CLOTHING", true); }} disabled={saving}>
                    <SelectTrigger id="profile-completion-top-fit">
                      <SelectValue placeholder="Men’s or Women’s">{topSizeFit === "UNISEX" ? "Unisex (saved)" : undefined}</SelectValue>
                    </SelectTrigger>
                    <SelectContent><SelectGroup>
                      {APPAREL_FIT_OPTIONS.filter((option) => option.value !== "UNISEX").map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup></SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="profile-completion-top-size">Top size</Label>
                  <Select value={topSizeChoice} onValueChange={(value) => { setTopSizeChoice(value); autosave.markDirty("CLOTHING", true); }} disabled={saving || !topSizeFit}>
                    <SelectTrigger id="profile-completion-top-size"><SelectValue placeholder={topSizeFit ? "Select size" : "Choose clothing sizing first"} /></SelectTrigger>
                    <SelectContent><SelectGroup>
                      {TOP_SIZE_OPTIONS.map((size) => <SelectItem key={size} value={size}>{size}</SelectItem>)}
                      <SelectItem value="OTHER">Other</SelectItem>
                    </SelectGroup></SelectContent>
                  </Select>
                </div>
              </div>
              {topSizeChoice === "OTHER" && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="profile-completion-top-other">Other top size</Label>
                  <Input id="profile-completion-top-other" value={topSizeOther} onChange={(event) => { setTopSizeOther(event.target.value); autosave.markDirty("CLOTHING"); }} maxLength={40} disabled={saving} />
                </div>
              )}
              <div className="grid grid-cols-1 gap-4 border-t pt-5 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="profile-completion-shoe-system">US shoe sizing</Label>
                  <Select
                    value={shoeSizeSystem}
                    onValueChange={(value) => {
                      if (value === shoeSizeSystem) return;
                      setShoeSizeSystem(value as typeof shoeSizeSystem);
                      setShoeSizeChoice("");
                      setShoeSizeOther("");
                      autosave.markDirty("SHOES", true);
                    }}
                    disabled={saving}
                  >
                    <SelectTrigger id="profile-completion-shoe-system"><SelectValue placeholder="Men’s or Women’s" /></SelectTrigger>
                    <SelectContent><SelectGroup>
                      {SHOE_SYSTEM_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectGroup></SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="profile-completion-shoe-size">Shoe size</Label>
                  <Select value={shoeSizeChoice} onValueChange={(value) => { setShoeSizeChoice(value); autosave.markDirty("SHOES", true); }} disabled={saving || !shoeSizeSystem}>
                    <SelectTrigger id="profile-completion-shoe-size"><SelectValue placeholder={shoeSizeSystem ? "Select size" : "Choose shoe sizing first"} /></SelectTrigger>
                    <SelectContent><SelectGroup>
                      {shoeOptions.map((size) => <SelectItem key={size} value={size}>{size}</SelectItem>)}
                      <SelectItem value="OTHER">Other</SelectItem>
                    </SelectGroup></SelectContent>
                  </Select>
                </div>
              </div>
              {shoeSizeChoice === "OTHER" && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="profile-completion-shoe-other">Other shoe size</Label>
                  <Input id="profile-completion-shoe-other" value={shoeSizeOther} onChange={(event) => { setShoeSizeOther(event.target.value); autosave.markDirty("SHOES"); }} maxLength={40} disabled={saving} />
                </div>
              )}
              {clothingLabel && selectedTopSize && shoeSystemLabel && selectedShoeSize && (
                <div role="status" className="rounded-lg bg-muted/50 px-4 py-3">
                  <p className="text-xs text-muted-foreground">Your sizes for team orders</p>
                  <p className="mt-1 text-sm font-medium">{clothingLabel} {selectedTopSize} · US {shoeSystemLabel} {selectedShoeSize}</p>
                </div>
              )}
            </div>
          )}

          {step === "PHOTO" && (
            <div className="flex flex-col items-center gap-5 py-4 text-center">
              <UserAvatar
                avatarUrl={data.profile.avatarUrl}
                name={data.profile.name}
                size="xl"
                className="size-28"
              />
              <div className="flex flex-col items-center gap-2">
                <Button type="button" variant="outline" asChild disabled={saving}>
                  <label htmlFor="profile-completion-photo">
                    <CameraIcon data-icon="inline-start" />
                    {data.profile.avatarUrl ? "Change photo" : "Choose photo"}
                  </label>
                </Button>
                <input
                  id="profile-completion-photo"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
        onChange={(event) => {
          setPhotoFile(event.target.files?.[0] ?? null);
          event.target.value = "";
        }}
                  disabled={saving}
                />
                <p className="text-xs text-muted-foreground">JPEG, PNG, or WebP. You can crop and reposition before saving.</p>
              </div>
            </div>
          )}
              </div>
  );

  const actions = (
    <>
      {!requiresSetup && step !== "PHOTO" && (
        <Button type="button" variant="ghost" onClick={snooze} disabled={saving} className="order-last h-10 w-full sm:order-none sm:mr-auto sm:w-auto">
          Remind me tomorrow
        </Button>
      )}
      {stepIndex > 0 && (
        <Button
          type="button"
          variant="outline"
          className="h-10"
          onClick={() => goToStep(visibleSteps[stepIndex - 1]!, -1)}
          disabled={saving}
        >
          <ArrowLeftIcon data-icon="inline-start" />
          Back
        </Button>
      )}
      <Button
        type="button"
        className="h-10"
        onClick={step === "PHOTO" ? finishPhotoStep : isOptionalStep && !canContinue ? skipOptionalStep : saveCurrentStep}
        disabled={saving || needsProfileRefresh || (step === "PHOTO" && !data.completion.requiredComplete) || (!canContinue && !isOptionalStep)}
      >
        {saving ? <Spinner data-icon="inline-start" /> : isLastStep ? <CheckIcon data-icon="inline-start" /> : null}
        {isLastStep ? "Finish" : isOptionalStep && !canContinue ? "Skip for now" : "Continue"}
        {!saving && !isLastStep && <ArrowRightIcon data-icon="inline-end" />}
      </Button>
    </>
  );

  const cropDialog = (
    <AvatarCropDialog
      file={photoFile}
      profileName={data.profile.name}
      avatarUrl={data.profile.avatarUrl}
      onClose={() => setPhotoFile(null)}
      onConfirm={uploadPhoto}
    />
  );

  const refreshNotice = needsProfileRefresh && (
    <Alert>
      <AlertCircleIcon />
      <AlertDescription className="space-y-3">
        <p>Your photo was saved, but setup couldn’t refresh. Refresh setup to continue.</p>
        <Button type="button" variant="outline" onClick={retryProfileRefresh} disabled={saving}>Refresh setup</Button>
      </AlertDescription>
    </Alert>
  );

  if (isPage) {
    return (
      <div className="flex flex-col gap-4">
        <nav aria-label="Setup steps" className="space-y-2">
          <ol className="flex gap-1.5">
            {visibleSteps.map((visibleStep, index) => (
              <li key={visibleStep} className="flex-1">
                <button
                  type="button"
                  onClick={() => goToStep(visibleStep, index > stepIndex ? 1 : -1)}
                  disabled={saving}
                  aria-label={`${PROFILE_STEP_SHORT_LABELS[visibleStep]}, step ${index + 1} of ${visibleSteps.length}`}
                  aria-current={visibleStep === step ? "step" : undefined}
                  className="group flex h-6 w-full items-center"
                >
                  <span
                    className={cn(
                      "h-1 w-full rounded-full transition-colors",
                      index <= stepIndex ? "bg-[var(--accent)]" : "bg-[var(--border)] group-hover:bg-[var(--text-muted)]",
                    )}
                  />
                </button>
              </li>
            ))}
          </ol>
          <p className="text-sm text-[var(--text-secondary)] tabular-nums">
            Step {stepIndex + 1} of {visibleSteps.length} · {PROFILE_STEP_SHORT_LABELS[step]}
          </p>
        </nav>

        <section className="min-w-0 rounded-2xl border border-[var(--border)] bg-card shadow-xs">
          <header className="space-y-1 px-5 pt-6 sm:px-8">
            <div className="grid">
              <AnimatePresence initial={false} custom={stepMotionContext}>
                <motion.div
                  key={`heading-${step}`}
                  custom={stepMotionContext}
                  variants={STEP_TRANSITION_VARIANTS}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="col-start-1 row-start-1 flex flex-col gap-1"
                >
                  <h2 className="text-xl">{copy.title}</h2>
                  <p className="text-sm text-[var(--text-secondary)]">{copy.description}</p>
                </motion.div>
              </AnimatePresence>
            </div>
          </header>

          <div className="flex min-h-[260px] flex-col gap-5 px-5 py-6 sm:px-8">
            <div className="relative grid flex-1">
              <AnimatePresence initial={false} custom={stepMotionContext}>
                <motion.div
                  key={`body-${step}`}
                  custom={stepMotionContext}
                  variants={STEP_TRANSITION_VARIANTS}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="col-start-1 row-start-1"
                >
                  {stepFields}
                </motion.div>
              </AnimatePresence>
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>

          <footer className="flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:px-8 max-sm:[&>button]:w-full">
            {actions}
          </footer>
        </section>
        {cropDialog}
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="grid max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-lg sm:max-w-2xl">
        <DialogHeader className="flex-col items-start gap-3 pr-14">
          <div className="flex w-full items-center justify-between gap-4">
            <Badge variant="orange" size="sm">Step {stepIndex + 1} of {visibleSteps.length}</Badge>
            <span className="text-xs text-muted-foreground">
              {data.completion.completedCount} of {data.completion.totalCount} details complete
            </span>
          </div>
          <Progress
            value={((stepIndex + 1) / visibleSteps.length) * 100}
            aria-label={`Step ${stepIndex + 1} of ${visibleSteps.length}`}
          />
          <div className="grid w-full">
            <AnimatePresence initial={false} custom={stepMotionContext}>
              <motion.div
                key={`heading-${step}`}
                custom={stepMotionContext}
                variants={STEP_TRANSITION_VARIANTS}
                initial="initial"
                animate="animate"
                exit="exit"
                className="col-start-1 row-start-1 flex flex-col gap-1"
              >
                <DialogTitle>{copy.title}</DialogTitle>
                <DialogDescription>{copy.description}{isOptionalStep ? " Optional — you can add this later from your profile." : ""}</DialogDescription>
              </motion.div>
            </AnimatePresence>
          </div>
        </DialogHeader>

        <DialogBody className="flex min-h-0 flex-col gap-5 py-5 sm:min-h-[300px]">
          <div className="relative grid flex-1">
            <AnimatePresence initial={false} custom={stepMotionContext}>
              <motion.div
                key={`body-${step}`}
                custom={stepMotionContext}
                variants={STEP_TRANSITION_VARIANTS}
                initial="initial"
                animate="animate"
                exit="exit"
                className="col-start-1 row-start-1"
              >
                {stepFields}
              </motion.div>
            </AnimatePresence>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {refreshNotice}
        </DialogBody>

        <DialogFooter className="border-t pt-4">
          {actions}
        </DialogFooter>
      </DialogContent>
      {cropDialog}
    </Dialog>
  );
}
