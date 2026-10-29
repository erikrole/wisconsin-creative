"use client";

import { ResourceType, Role, ShiftArea } from "@/lib/client-enums";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  GUIDE_AREA_OPTIONS,
  GUIDE_ROLE_OPTIONS,
  RESOURCE_TYPE_DESCRIPTIONS,
  RESOURCE_TYPE_LABELS,
  RESOURCE_TYPE_OPTIONS,
} from "@/lib/guide-categories";
import { cn } from "@/lib/utils";

type Props = {
  type: ResourceType;
  category: string;
  categorySuggestions: string[];
  featured: boolean;
  featuredRank: number | null;
  targetRoles: Role[];
  targetAreas: ShiftArea[];
  /** Edit only: whether the guide is live. New guides publish from the top bar. */
  published?: boolean;
  disabled?: boolean;
  onTypeChange: (value: ResourceType) => void;
  onCategoryChange: (value: string) => void;
  onFeaturedChange: (value: boolean) => void;
  onFeaturedRankChange: (value: number | null) => void;
  onTargetRolesChange: (value: Role[]) => void;
  onTargetAreasChange: (value: ShiftArea[]) => void;
  onPublishedChange?: (value: boolean) => void;
};

function toggleValue<T extends string>(items: T[], value: T) {
  return items.includes(value) ? items.filter((item) => item !== value) : [...items, value];
}

function ChipToggle({
  label,
  pressed,
  disabled,
  onToggle,
}: {
  label: string;
  pressed: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "guide-chip transition-[background-color,color,scale] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.96] disabled:opacity-50",
        pressed && "guide-chip-on",
      )}
    >
      {label}
    </button>
  );
}

function SettingsGroup({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2 text-sm font-bold text-foreground">{label}</legend>
      {children}
      {hint && <p className="text-pretty text-xs leading-relaxed text-muted-foreground">{hint}</p>}
    </fieldset>
  );
}

/**
 * The editor's quiet side panel: what kind of guide this is, who it's for,
 * and whether it leads the library. Empty audience lists mean everyone.
 */
export function GuideSettingsPanel({
  type,
  category,
  categorySuggestions,
  featured,
  featuredRank,
  targetRoles,
  targetAreas,
  published,
  disabled,
  onTypeChange,
  onCategoryChange,
  onFeaturedChange,
  onFeaturedRankChange,
  onTargetRolesChange,
  onTargetAreasChange,
  onPublishedChange,
}: Props) {
  return (
    <section aria-labelledby="guide-settings-heading" className="flex flex-col gap-6">
      <h2 id="guide-settings-heading" className="resource-kicker">Guide settings</h2>

      {published !== undefined && onPublishedChange && (
        <label className="guide-setting-switch">
          <span className="min-w-0">
            <span className="block text-sm font-bold">{published ? "Published" : "Draft"}</span>
            <span className="block text-xs text-muted-foreground">
              {published ? "Everyone it's for can read it." : "Only staff and admins can see it."}
            </span>
          </span>
          <Switch checked={published} onCheckedChange={onPublishedChange} disabled={disabled} aria-label="Published" />
        </label>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="guide-type" className="text-sm font-bold">Type</Label>
        <Select value={type} onValueChange={(value) => onTypeChange(value as ResourceType)} disabled={disabled}>
          <SelectTrigger id="guide-type" className="h-10 bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Type</SelectLabel>
              {RESOURCE_TYPE_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {RESOURCE_TYPE_LABELS[option]}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <p className="text-pretty text-xs leading-relaxed text-muted-foreground">
          {RESOURCE_TYPE_DESCRIPTIONS[type]}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="category" className="text-sm font-bold">Category</Label>
        <Input
          id="category"
          value={category}
          onChange={(event) => onCategoryChange(event.target.value)}
          list="guide-category-suggestions"
          placeholder="e.g. SOPs, Media Drive"
          className="bg-card"
          disabled={disabled}
        />
        {categorySuggestions.length > 0 && (
          <datalist id="guide-category-suggestions">
            {categorySuggestions.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
        )}
      </div>

      <SettingsGroup
        label="Who it's for"
        hint="Leave all off for everyone. Guides stay internal: collaborators only see Brand assets."
      >
        <div className="flex flex-wrap gap-1.5">
          {GUIDE_ROLE_OPTIONS.map((option) => {
            const value = option.value as Role;
            return (
              <ChipToggle
                key={option.value}
                label={option.label}
                pressed={targetRoles.includes(value)}
                disabled={disabled}
                onToggle={() => onTargetRolesChange(toggleValue(targetRoles, value))}
              />
            );
          })}
        </div>
      </SettingsGroup>

      <SettingsGroup label="Creative areas" hint="Puts it in For you for these areas. Leave all off for every area.">
        <div className="flex flex-wrap gap-1.5">
          {GUIDE_AREA_OPTIONS.map((option) => {
            const value = option.value as ShiftArea;
            return (
              <ChipToggle
                key={option.value}
                label={option.label}
                pressed={targetAreas.includes(value)}
                disabled={disabled}
                onToggle={() => onTargetAreasChange(toggleValue(targetAreas, value))}
              />
            );
          })}
        </div>
      </SettingsGroup>

      <div className="flex flex-col gap-3">
        <label className="guide-setting-switch">
          <span className="min-w-0">
            <span className="block text-sm font-bold">Feature in the library</span>
            <span className="block text-xs text-muted-foreground">Leads For you for everyone.</span>
          </span>
          <Switch checked={featured} onCheckedChange={onFeaturedChange} disabled={disabled} aria-label="Feature in the library" />
        </label>
        {featured && (
          <div className="flex items-center justify-between gap-3 px-1">
            <Label htmlFor="guide-featured-rank" className="text-sm">Order</Label>
            <Input
              id="guide-featured-rank"
              type="number"
              min={1}
              max={999}
              value={featuredRank ?? ""}
              placeholder="Auto"
              onChange={(event) => {
                const next = Number.parseInt(event.target.value, 10);
                onFeaturedRankChange(Number.isFinite(next) ? next : null);
              }}
              disabled={disabled}
              className="h-10 w-24 bg-card"
            />
          </div>
        )}
      </div>
    </section>
  );
}
