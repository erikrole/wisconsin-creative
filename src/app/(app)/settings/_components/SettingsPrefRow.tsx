"use client";

import type { ReactNode } from "react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type SettingsPrefRowProps = {
  /** Kept for existing callers; rows are text-only now. */
  icon?: ReactNode;
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  className?: string;
};

/** A switch row sized to sit inside a SettingsGroup card. */
export function SettingsPrefRow({
  label,
  description,
  checked,
  onChange,
  disabled,
  className,
}: SettingsPrefRowProps) {
  const id = `settings-pref-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  return (
    <div className={cn("flex items-center justify-between gap-6 px-4 py-3.5", className)}>
      <div className="min-w-0">
        <label htmlFor={id} className="block cursor-pointer text-sm font-bold leading-snug">{label}</label>
        <p className="m-0 mt-0.5 text-[13px] leading-snug text-muted-foreground text-pretty">{description}</p>
      </div>
      <Switch id={id} name={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}
