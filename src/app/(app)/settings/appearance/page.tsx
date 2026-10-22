"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SettingsPageShell } from "../SettingsPageShell";
import { SettingsGroup } from "../_components/SettingsGroup";
import {
  applyThemeChoice,
  readStoredThemeChoice,
  setThemeChoice,
  subscribeToThemeChoice,
  subscribeToSystemTheme,
  type ThemeChoice,
} from "@/lib/theme";

const SCALE_KEY = "text-scale";

type ScaleChoice = {
  id: "small" | "default" | "large" | "xlarge";
  label: string;
  value: number;
};

const SCALE_CHOICES: ScaleChoice[] = [
  { id: "small",   label: "Small",       value: 0.9 },
  { id: "default", label: "Default",     value: 1.0 },
  { id: "large",   label: "Large",       value: 1.15 },
  { id: "xlarge",  label: "Extra large", value: 1.3 },
];

function applyScale(value: number) {
  document.documentElement.style.setProperty("--text-scale", String(value));
}

function readStoredScale(): number {
  try {
    const v = localStorage.getItem(SCALE_KEY);
    const n = v ? parseFloat(v) : NaN;
    if (Number.isFinite(n) && n >= 0.85 && n <= 1.4) return n;
  } catch { /* ignore */ }
  return 1;
}

export default function AppearancePage() {
  const [theme, setTheme] = useState<ThemeChoice>("system");
  const [scale, setScale] = useState<number>(1);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const storedTheme = readStoredThemeChoice();
    setTheme(storedTheme);
    applyThemeChoice(storedTheme);
    setScale(readStoredScale());
    setMounted(true);
  }, []);

  useEffect(() => subscribeToThemeChoice(setTheme), []);

  // Re-apply theme when OS preference changes while in "system" mode.
  useEffect(() => {
    if (theme !== "system") return;
    return subscribeToSystemTheme(() => applyThemeChoice("system"));
  }, [theme]);

  function pickTheme(choice: ThemeChoice) {
    setThemeChoice(choice, { animate: true });
    toast.success(
      choice === "system" ? "Following your system theme" : `Switched to ${choice} mode`,
      { duration: 1500 }
    );
  }

  function pickScale(value: number) {
    setScale(value);
    applyScale(value);
    try {
      if (value === 1) localStorage.removeItem(SCALE_KEY);
      else localStorage.setItem(SCALE_KEY, String(value));
    } catch { /* ignore */ }
  }

  function resetAll() {
    pickTheme("system");
    pickScale(1);
  }

  return (
    <SettingsPageShell
      href="/settings/appearance"
      description="Saved on this device only, so set it again on your phone or other browsers."
      mainClassName="flex flex-col gap-7"
    >
      <SettingsGroup title="Theme">
        <div role="group" aria-label="Theme" className="grid grid-cols-3 gap-3 p-4 max-sm:grid-cols-1">
          {THEME_CHOICES.map((c) => (
            <ThemeChoiceCard
              key={c.id}
              choice={c}
              active={mounted && theme === c.id}
              onClick={() => pickTheme(c.id)}
            />
          ))}
        </div>
      </SettingsGroup>

      <SettingsGroup title="Text size" description="Applies everywhere in the app on this device.">
        <div className="p-4">
          <div
            role="group"
            aria-label="Text size"
            className="grid grid-cols-4 gap-1 rounded-lg bg-muted p-1 max-sm:grid-cols-2"
          >
            {SCALE_CHOICES.map((c) => {
              const isActive = mounted && Math.abs(scale - c.value) < 0.001;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => pickScale(c.value)}
                  aria-pressed={isActive}
                  aria-label={`Text size: ${c.label}`}
                  className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-md px-3 py-2 text-sm transition-[background-color,box-shadow,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    isActive
                      ? "bg-card font-bold text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span aria-hidden="true" style={{ fontSize: `${15 * c.value}px` }} className="font-bold leading-none">
                    Aa
                  </span>
                  <span className="text-xs">{c.label}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="px-4 py-3.5">
          <p className="m-0 text-sm font-bold">Preview</p>
          <p className="m-0 mt-1 text-base">Changes apply right away. This line shows the current body size.</p>
          <p className="m-0 mt-0.5 text-sm text-muted-foreground">
            Smaller secondary text, like the help copy under form fields.
          </p>
        </div>
      </SettingsGroup>

      <div>
        <Button
          className="h-10"
          variant="ghost"
          onClick={resetAll}
          disabled={!mounted || (theme === "system" && Math.abs(scale - 1) < 0.001)}
        >
          Reset to defaults
        </Button>
      </div>
    </SettingsPageShell>
  );
}

const THEME_CHOICES: Array<{ id: ThemeChoice; label: string; description: string }> = [
  { id: "light", label: "Light", description: "Always light." },
  { id: "dark", label: "Dark", description: "Always dark." },
  { id: "system", label: "System", description: "Match this device." },
];

/** A tiny window sketch in each theme, so the choice is something you can see. */
function ThemeChoiceCard({
  choice,
  active,
  onClick,
}: {
  choice: { id: ThemeChoice; label: string; description: string };
  active: boolean;
  onClick: () => void;
}) {
  const half = (dark: boolean) => (
    <div
      className="flex h-full flex-1 flex-col gap-1.5 p-2.5"
      style={{ background: dark ? "#111214" : "#fbfbfc" }}
    >
      <span className="h-1.5 w-8 rounded-full" style={{ background: dark ? "#ececef" : "#1c2024" }} />
      <span className="h-1.5 w-12 rounded-full" style={{ background: dark ? "#3a3c42" : "#dcdce1" }} />
      <span className="mt-auto h-3 w-8 rounded-md" style={{ background: dark ? "#8da4ef" : "#3e63dd" }} />
    </div>
  );
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`Theme: ${choice.label}`}
      className="group flex flex-col gap-2 text-left focus-visible:outline-none"
    >
      <span
        className={`flex h-24 overflow-hidden rounded-lg border transition-[box-shadow,border-color] group-focus-visible:ring-2 group-focus-visible:ring-ring ${
          active ? "border-primary ring-2 ring-primary" : "border-border group-hover:border-foreground/30"
        }`}
      >
        {choice.id === "system" ? (
          <>
            {half(false)}
            {half(true)}
          </>
        ) : (
          half(choice.id === "dark")
        )}
      </span>
      <span className="flex items-baseline gap-2 px-0.5">
        <span className="text-sm font-bold">{choice.label}</span>
        <span className="text-xs text-muted-foreground">{choice.description}</span>
      </span>
    </button>
  );
}
