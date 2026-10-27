import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { useQueryClient } from "@tanstack/react-query";
import { QueryProvider } from "@/components/QueryProvider";
import { ProfileCompletionWizard } from "@/components/profile-completion/ProfileCompletionWizard";
import { AvatarCropDialog } from "@/app/(app)/staff/[id]/AvatarCropDialog";
import { useGettingStartedState } from "@/hooks/use-getting-started";
import { uploadAvatarPhoto } from "@/lib/avatar-upload";
import { Toaster } from "@/components/ui/sonner";

function Checklist() {
  const { state, update, error } = useGettingStartedState(true);
  return <><button onClick={() => update({ done: ["guides"] })}>Read guide</button><output data-testid="checklist">{JSON.stringify(state)}</output><p>{error}</p></>;
}
function Harness() {
  const query = useQueryClient();
  Object.assign(window, { refreshOnboarding: () => query.refetchQueries({ queryKey: ["profile-completion"] }) });
  const [file, setFile] = useState<File | null>(null);
  const [photo, setPhoto] = useState<string | null>("https://example.test/original.webp");
  const [complete, setComplete] = useState(false);
  const mode = new URLSearchParams(location.search).get("view");
  if (mode === "checklist") return <Checklist />;
  if (mode === "crop") return <>
    <label>Choose photo<input aria-label="Choose photo" type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
    <output data-testid="photo">{photo}</output>
    <AvatarCropDialog file={file} avatarUrl={photo} profileName="Alex Rivera" onClose={() => setFile(null)} onConfirm={async (image, expected, actor) => {
      const url = await uploadAvatarPhoto("student", image, expected, actor);
      if (!url) return false;
      setPhoto(url); return true;
    }} />
  </>;
  return <div className="mx-auto max-w-2xl px-4 py-10">
    <header className="mb-8 space-y-2"><p className="text-sm font-bold text-[var(--accent)]">Welcome to Wisconsin Creative</p><h1 className="text-3xl">Let’s get you set up, Alex</h1><p className="text-muted-foreground">Answers save to your account as you go. Only the photo is optional.</p></header>
    {complete ? <h2>Setup complete</h2> : <ProfileCompletionWizard presentation="page" onComplete={() => setComplete(true)} />}
  </div>;
}
createRoot(document.getElementById("root")!).render(<QueryProvider userId="student"><Harness /><Toaster /></QueryProvider>);
