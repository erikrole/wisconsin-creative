"use client";

import { Role, ShiftArea } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  GUIDE_AREA_OPTIONS,
  GUIDE_ROLE_OPTIONS,
  GUIDE_AREA_LABELS,
  GUIDE_ROLE_LABELS,
} from "@/lib/guide-categories";

type Props = {
  featured: boolean;
  featuredRank: number | null;
  targetRoles: Role[];
  targetAreas: ShiftArea[];
  disabled?: boolean;
  embedded?: boolean;
  onFeaturedChange: (value: boolean) => void;
  onFeaturedRankChange: (value: number | null) => void;
  onTargetRolesChange: (value: Role[]) => void;
  onTargetAreasChange: (value: ShiftArea[]) => void;
};

function toggleValue<T extends string>(items: T[], value: T, checked: boolean) {
  if (checked) return items.includes(value) ? items : [...items, value];
  return items.filter((item) => item !== value);
}

export function GuideTargetingControls({
  featured,
  featuredRank,
  targetRoles,
  targetAreas,
  disabled,
  embedded = false,
  onFeaturedChange,
  onFeaturedRankChange,
  onTargetRolesChange,
  onTargetAreasChange,
}: Props) {
  return (
    <section className={embedded ? "flex flex-col gap-4" : "rounded-lg border bg-card p-4"}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Landing page priority</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Feature important Guides and rank them for the roles and Creative areas that need them first.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              id="guide-featured"
              checked={featured}
              onCheckedChange={onFeaturedChange}
              disabled={disabled}
            />
            <Label htmlFor="guide-featured" className="cursor-pointer text-sm">
              Featured
            </Label>
          </div>
        </div>

        {featured && (
          <div className="max-w-40">
            <Label htmlFor="guide-featured-rank">Featured rank</Label>
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
              className="mt-1"
            />
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Target roles</legend>
            <p className="text-xs text-muted-foreground">Leave blank for every role.</p>
            <div className="flex flex-wrap gap-2">
              {GUIDE_ROLE_OPTIONS.map((option) => {
                const value = option.value as Role;
                const checked = targetRoles.includes(value);
                return (
                  <label
                    key={option.value}
                    className="flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 text-sm"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(next) => {
                        onTargetRolesChange(toggleValue(targetRoles, value, next === true));
                      }}
                      disabled={disabled}
                    />
                    {option.label}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Target areas</legend>
            <p className="text-xs text-muted-foreground">Leave blank for every area.</p>
            <div className="flex flex-wrap gap-2">
              {GUIDE_AREA_OPTIONS.map((option) => {
                const value = option.value as ShiftArea;
                const checked = targetAreas.includes(value);
                return (
                  <label
                    key={option.value}
                    className="flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 text-sm"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(next) => {
                        onTargetAreasChange(toggleValue(targetAreas, value, next === true));
                      }}
                      disabled={disabled}
                    />
                    {option.label}
                  </label>
                );
              })}
            </div>
          </fieldset>
        </div>

        {(targetRoles.length > 0 || targetAreas.length > 0) && (
          <div className="flex flex-wrap gap-2">
            {targetRoles.map((role) => (
              <Badge key={role} variant="secondary">
                {GUIDE_ROLE_LABELS[role] ?? "Collaborators"}
              </Badge>
            ))}
            {targetAreas.map((area) => (
              <Badge key={area} variant="outline">
                {GUIDE_AREA_LABELS[area]}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
