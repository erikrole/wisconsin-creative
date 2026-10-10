"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { parseErrorMessage } from "@/lib/errors";
export function AuthorizeRadioClip({ input, name }: { input: { state: string; codeChallenge: string }; name: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function authorize() {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/radio-clip/authorize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      if (!response.ok) throw new Error(await parseErrorMessage(response, "Could not sign in. Try again."));
      const { callbackURL } = await response.json();
      window.location.assign(callbackURL);
    } catch (error) { setError(error instanceof Error ? error.message : "Sign-in failed."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-4"><p>Continue as <strong>{name}</strong> on this Mac.</p><p className="text-sm text-muted-foreground">Radio Clip uses your Wisconsin Creative access. Your recordings and local projects stay on your Mac and shared drive.</p>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<Button onClick={authorize} disabled={busy} className="w-full">{busy ? "Connecting…" : "Continue to Radio Clip"}</Button><p className="text-xs text-muted-foreground">To cancel, close this window and return to Radio Clip.</p></div>;
}
