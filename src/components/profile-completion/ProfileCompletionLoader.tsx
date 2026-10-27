"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useIdleReady } from "@/hooks/use-idle-ready";
import { useProfileCompletion } from "@/hooks/use-profile-completion";
import { OPEN_PROFILE_COMPLETION_EVENT, openProfileCompletion } from "@/lib/profile-completion-events";

// A "Finish your profile" click that lands before the wizard has loaded is
// replayed once the wizard mounts.
const pendingOpen = { current: false };

const ProfileCompletionWizard = dynamic(
  () =>
    import("./ProfileCompletionWizard").then(({ ProfileCompletionWizard: Wizard }) =>
      function LoadedWizard(props: { autoOpen: boolean }) {
        const { data } = useProfileCompletion();
        useEffect(() => {
          if (!pendingOpen.current || !data) return;
          pendingOpen.current = false;
          openProfileCompletion();
        }, [data]);
        return <Wizard {...props} />;
      },
    ),
  { ssr: false },
);

/**
 * Keeps the profile wizard (forms, photo cropper, motion) out of the first-load bundle. It loads only when the
 * profile needs setup or a "Finish your profile" click asks for it, so a complete profile never downloads it.
 */
export function ProfileCompletionLoader({ autoOpen }: { autoOpen: boolean }) {
  const [clicked, setClicked] = useState(false);
  const idleReady = useIdleReady();
  const { data } = useProfileCompletion(idleReady || clicked);

  const loadedRef = useRef(false);
  useEffect(() => {
    const onOpen = () => {
      // Once the wizard is mounted it handles the event itself.
      if (loadedRef.current) return;
      pendingOpen.current = true;
      setClicked(true);
    };
    window.addEventListener(OPEN_PROFILE_COMPLETION_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_PROFILE_COMPLETION_EVENT, onOpen);
  }, []);

  const load = clicked || (autoOpen && Boolean(data?.completion.shouldPrompt));
  useEffect(() => {
    loadedRef.current = load;
  }, [load]);
  return load ? <ProfileCompletionWizard autoOpen={autoOpen} /> : null;
}
