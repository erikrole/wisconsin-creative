"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { OPEN_PROFILE_COMPLETION_EVENT, openProfileCompletion } from "@/lib/profile-completion-events";

// A "Finish your profile" click that lands before the wizard has loaded is
// replayed once the wizard mounts.
const pendingOpen = { current: false };

const ProfileCompletionWizard = dynamic(
  () =>
    import("./ProfileCompletionWizard").then(({ ProfileCompletionWizard: Wizard }) =>
      function LoadedWizard(props: { autoOpen: boolean }) {
        useEffect(() => {
          if (!pendingOpen.current) return;
          pendingOpen.current = false;
          openProfileCompletion();
        }, []);
        return <Wizard {...props} />;
      },
    ),
  { ssr: false },
);

/** Keeps the profile wizard (forms, photo cropper, motion) out of the first-load bundle. */
export function ProfileCompletionLoader({ autoOpen }: { autoOpen: boolean }) {
  const [load, setLoad] = useState(false);
  const loadRef = useRef(false);

  useEffect(() => {
    const start = () => {
      loadRef.current = true;
      setLoad(true);
    };
    const onOpen = () => {
      if (loadRef.current) return;
      pendingOpen.current = true;
      start();
    };
    window.addEventListener(OPEN_PROFILE_COMPLETION_EVENT, onOpen);
    // Safari has no requestIdleCallback.
    const hasIdle = "requestIdleCallback" in window;
    const idle = hasIdle ? window.requestIdleCallback(start, { timeout: 3000 }) : window.setTimeout(start, 1500);
    return () => {
      window.removeEventListener(OPEN_PROFILE_COMPLETION_EVENT, onOpen);
      if (hasIdle) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
    };
  }, []);

  return load ? <ProfileCompletionWizard autoOpen={autoOpen} /> : null;
}
