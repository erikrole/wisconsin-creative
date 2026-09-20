"use client";

import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type SettingsPrefRowProps = {
  icon?: ReactNode;
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  className?: string;
};

export function SettingsPrefRow({
  icon,
  label,
  description,
  checked,
  onChange,
  disabled,
  className,
}: SettingsPrefRowProps) {
  const id = `settings-pref-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  return (
    <div className={cn("flex items-start justify-between gap-4 py-2", className)}>
      <div className="flex min-w-0 gap-3">
        {icon ? <span className="mt-0.5 text-muted-foreground">{icon}</span> : null}
        <div className="min-w-0">
          <Label htmlFor={id} className="cursor-pointer font-medium">{label}</Label>
          <p className="m-0 mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <Switch id={id} name={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}
