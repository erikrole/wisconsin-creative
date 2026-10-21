"use client";

import { useEffect, useState } from "react";
import { DownloadIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { chromeFont } from "@/lib/chrome-font";
import { cn } from "@/lib/utils";

const DONE_KEY = "wc-install-prompt-done";

// Chromium fires this when the site passes its installability checks; it isn't in lib.dom yet.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isDone() {
  try {
    return localStorage.getItem(DONE_KEY) !== null;
  } catch {
    return false;
  }
}

function markDone() {
  try {
    localStorage.setItem(DONE_KEY, String(Date.now()));
  } catch {
    // Private mode: the prompt may show again next visit, which is acceptable.
  }
}

function isInstalled() {
  return window.matchMedia("(display-mode: standalone)").matches;
}

/**
 * Offers "Install app" to Android Chrome visitors once. Dismissing or installing is remembered
 * on the device, and it never appears inside the installed app. iPhone gets Safari's native
 * Smart App Banner instead (see the itunes metadata in the app layout).
 */
export function InstallAppPrompt() {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (!/Android/i.test(navigator.userAgent) || isInstalled() || isDone()) return;

    function onPrompt(e: Event) {
      e.preventDefault();
      setEvent(e as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      markDone();
      setEvent(null);
    }

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!event) return null;

  function dismiss() {
    markDone();
    setEvent(null);
  }

  async function install() {
    const pending = event;
    if (!pending) return;
    markDone();
    setEvent(null);
    await pending.prompt();
  }

  return (
    <div
      role="region"
      aria-label="Install the app"
      className={cn(
        chromeFont.className,
        "fixed inset-x-3 z-[var(--z-overlay)] mx-auto flex max-w-[420px] items-center gap-3 rounded-2xl border border-border bg-card p-3 pl-4 shadow-lg",
        "bottom-[calc(72px+env(safe-area-inset-bottom,0px))] md:bottom-4 md:left-auto md:right-4 md:mx-0 print:hidden",
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--wi-red)] text-white" aria-hidden="true">
        <DownloadIcon className="size-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-tight">Add Wisconsin Creative</p>
        <p className="text-xs text-muted-foreground">Open it from your home screen, like an app.</p>
      </div>
      <Button size="sm" onClick={install}>Install</Button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Not now"
        className="-mr-1 flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      >
        <XIcon className="size-4" />
      </button>
    </div>
  );
}
