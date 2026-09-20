"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SettingsSaveBarProps = {
  dirty: boolean;
  saving: boolean;
  onReset?: () => void;
  onSave?: () => void;
  saveLabel?: string;
  savedLabel?: string;
  className?: string;
};

export function SettingsSaveBar({
  dirty,
  saving,
  onReset,
  onSave,
  saveLabel = "Save changes",
  savedLabel = "Saved",
  className,
}: SettingsSaveBarProps) {
  return (
    <div className={cn("flex flex-wrap items-center justify-end gap-3 pt-1", className)}>
      <p role="status" className="mr-auto text-sm text-muted-foreground">
        {saving ? "Saving" : dirty ? "Unsaved changes" : "All changes saved"}
      </p>
      {onReset ? (
        <Button type="button" variant="outline" className="h-10" onClick={onReset} disabled={!dirty || saving}>
          Reset changes
        </Button>
      ) : null}
      <Button
        type={onSave ? "button" : "submit"}
        className="h-10"
        disabled={!dirty || saving}
        loading={saving}
        onClick={onSave}
      >
        {dirty ? saveLabel : savedLabel}
      </Button>
    </div>
  );
}
