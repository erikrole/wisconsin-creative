"use client";

import { useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { ResourceType, Role, ShiftArea } from "@prisma/client";
import { Button } from "@/components/ui/button";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { GuideTargetingControls } from "@/components/resources/GuideTargetingControls";
import {
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
  disabled?: boolean;
  onTypeChange: (value: ResourceType) => void;
  onCategoryChange: (value: string) => void;
  onFeaturedChange: (value: boolean) => void;
  onFeaturedRankChange: (value: number | null) => void;
  onTargetRolesChange: (value: Role[]) => void;
  onTargetAreasChange: (value: ShiftArea[]) => void;
};

export function GuideSettingsPanel({
  type,
  category,
  categorySuggestions,
  featured,
  featuredRank,
  targetRoles,
  targetAreas,
  disabled,
  onTypeChange,
  onCategoryChange,
  onFeaturedChange,
  onFeaturedRankChange,
  onTargetRolesChange,
  onTargetAreasChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const extras = [
    featured ? "Featured" : null,
    targetRoles.length > 0 ? "Role-limited" : null,
    targetAreas.length > 0 ? "Area-limited" : null,
  ].filter(Boolean);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <section className="rounded-lg border border-border/70 bg-card/40">
        <h2>
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="group h-auto min-h-12 w-full justify-between gap-3 whitespace-normal rounded-lg px-4 py-3 text-left"
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">Guide settings</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {RESOURCE_TYPE_LABELS[type]}
                  {category ? ` · ${category}` : ""}
                  {extras.length > 0 ? ` · ${extras.join(" · ")}` : ""}
                </span>
              </span>
              <ChevronDownIcon
                className={cn(
                  "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
                  open && "rotate-180",
                )}
                aria-hidden="true"
              />
            </Button>
          </CollapsibleTrigger>
        </h2>
        <CollapsibleContent>
          <div className="flex flex-col gap-4 border-t border-border/70 p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="guide-type">Guide focus</Label>
                <Select value={type} onValueChange={(value) => onTypeChange(value as ResourceType)} disabled={disabled}>
                  <SelectTrigger id="guide-type" className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>Guide focus</SelectLabel>
                      {RESOURCE_TYPE_OPTIONS.map((option) => (
                        <SelectItem key={option} value={option}>
                          {RESOURCE_TYPE_LABELS[option]}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <p className="text-pretty text-xs text-muted-foreground">
                  {RESOURCE_TYPE_DESCRIPTIONS[type]}
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="category">Category</Label>
                <Input
                  id="category"
                  value={category}
                  onChange={(event) => onCategoryChange(event.target.value)}
                  list="guide-category-suggestions"
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
            </div>

            <GuideTargetingControls
              featured={featured}
              featuredRank={featuredRank}
              targetRoles={targetRoles}
              targetAreas={targetAreas}
              disabled={disabled}
              embedded
              onFeaturedChange={onFeaturedChange}
              onFeaturedRankChange={onFeaturedRankChange}
              onTargetRolesChange={onTargetRolesChange}
              onTargetAreasChange={onTargetAreasChange}
            />
          </div>
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}
