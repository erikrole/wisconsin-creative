"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useProfileCompletion } from "@/hooks/use-profile-completion";
import { OPEN_PROFILE_COMPLETION_EVENT } from "@/lib/profile-completion-events";

const ProfileCompletionDialog = dynamic(
  () => import("./ProfileCompletionDialog").then((module) => module.ProfileCompletionDialog),
  { ssr: false },
);

type ProfileCompletionWizardProps = {
  onComplete?: () => void;
  onSnooze?: () => void;
  autoOpen?: boolean;
};

export function ProfileCompletionWizard({ autoOpen = true, ...props }: ProfileCompletionWizardProps = {}) {
  const { data } = useProfileCompletion();
  const [activated, setActivated] = useState(false);
  const [manualOpenRequest, setManualOpenRequest] = useState(0);

  useEffect(() => {
    if (autoOpen && data?.completion.shouldPrompt) setActivated(true);
  }, [autoOpen, data?.completion.shouldPrompt]);

  useEffect(() => {
    const openWizard = () => {
      if (!data) return;
      setActivated(true);
      // Retain the request across the chunk load; dispatching another event
      // would race the dialog's listener on a user's first click.
      setManualOpenRequest((request) => request + 1);
    };
    window.addEventListener(OPEN_PROFILE_COMPLETION_EVENT, openWizard);
    return () => window.removeEventListener(OPEN_PROFILE_COMPLETION_EVENT, openWizard);
  }, [data]);

  // Once opened, keep the same form instance so cache refreshes, snoozing,
  // completion, and navigation do not discard an in-progress edit.
  return activated
    ? <ProfileCompletionDialog {...props} autoOpen={autoOpen} manualOpenRequest={manualOpenRequest} />
    : null;
}
