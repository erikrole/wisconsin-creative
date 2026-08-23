"use client";

import { useCallback, useEffect, useState } from "react";
import { BookmarkIcon, BookmarkPlusIcon, FilterIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

type FilterPreset = {
  id: string;
  label: string;
  sport: string | null;
  location: string | null;
};

const PRESETS_KEY = "gear-tracker:filter-presets";

function loadPresets(): FilterPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function savePresets(presets: FilterPreset[]) {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}

function presetLabel(sport: string | null, location: string | null): string {
  if (sport && location) return `${sport} \u00B7 ${location}`;
  return sport || location || "Custom";
}

type Props = {
  availableSports: string[];
  availableLocations: string[];
  activeSport: string | null;
  activeLocation: string | null;
  setActiveSport: (sport: string | null) => void;
  setActiveLocation: (loc: string | null) => void;
  clearFilters: () => void;
  hasActiveFilter: boolean;
};

export function FilterChips({
  availableSports,
  availableLocations,
  activeSport,
  activeLocation,
  setActiveSport,
  setActiveLocation,
  clearFilters,
  hasActiveFilter,
}: Props) {
  const [presets, setPresets] = useState<FilterPreset[]>([]);

  // Load presets from localStorage on mount
  useEffect(() => {
    setPresets(loadPresets());
  }, []);

  const handleSavePreset = useCallback(() => {
    if (!activeSport && !activeLocation) return;
    const label = presetLabel(activeSport, activeLocation);
    // Don't save duplicate
    const existing = loadPresets();
    if (existing.some((p) => p.sport === activeSport && p.location === activeLocation)) return;
    const preset: FilterPreset = {
      id: crypto.randomUUID(),
      label,
      sport: activeSport,
      location: activeLocation,
    };
    const updated = [...existing, preset];
    savePresets(updated);
    setPresets(updated);
  }, [activeSport, activeLocation]);

  const handleDeletePreset = useCallback((id: string) => {
    const updated = loadPresets().filter((p) => p.id !== id);
    savePresets(updated);
    setPresets(updated);
  }, []);

  const handleApplyPreset = useCallback((preset: FilterPreset) => {
    setActiveSport(preset.sport);
    setActiveLocation(preset.location);
  }, [setActiveSport, setActiveLocation]);

  const isCurrentPresetSaved = presets.some(
    (p) => p.sport === activeSport && p.location === activeLocation
  );

  if (availableSports.length <= 1 && availableLocations.length <= 1 && presets.length === 0 && !hasActiveFilter) return null;

  // Build trigger label
  const triggerLabel = hasActiveFilter
    ? presetLabel(activeSport, activeLocation)
    : "Filter";

  return (
    <div className="flex items-center gap-1">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant={hasActiveFilter ? "default" : "outline"} size="sm" className="h-10 gap-1.5">
            <FilterIcon className="size-3.5" />
            {triggerLabel}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-3">
          <div className="flex flex-col gap-3">
            {/* Sport filters */}
            {availableSports.length > 1 && (
              <div>
                <p className="text-[0.65rem] text-muted-foreground uppercase tracking-wider font-medium mb-1.5">Sport</p>
                <div className="flex flex-wrap gap-1">
                  {availableSports.map((code) => (
                    <Button
                      key={`sport-${code}`}
                      variant={activeSport === code ? "default" : "outline"}
                      size="sm"
                      className="h-10 px-3 text-xs"
                      onClick={() => setActiveSport(activeSport === code ? null : code)}
                    >
                      {code}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Location filters */}
            {availableLocations.length > 1 && (
              <div>
                <p className="text-[0.65rem] text-muted-foreground uppercase tracking-wider font-medium mb-1.5">Location</p>
                <div className="flex flex-wrap gap-1">
                  {availableLocations.map((name) => (
                    <Button
                      key={`loc-${name}`}
                      variant={activeLocation === name ? "default" : "outline"}
                      size="sm"
                      className="h-10 px-3 text-xs"
                      onClick={() => setActiveLocation(activeLocation === name ? null : name)}
                    >
                      {name}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            {hasActiveFilter && (
              <div className="flex items-center gap-2 pt-1 border-t border-border/50">
                {!isCurrentPresetSaved && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-10 px-3 text-xs text-muted-foreground"
                        onClick={handleSavePreset}
                      >
                        <BookmarkPlusIcon className="size-3 mr-1" />
                        Save view
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Save this filter combination</TooltipContent>
                  </Tooltip>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-10 px-3 text-xs text-muted-foreground"
                  onClick={clearFilters}
                >
                  <XIcon className="size-3 mr-1" />
                  Clear
                </Button>
              </div>
            )}

            {/* Saved presets */}
            {presets.length > 0 && (
              <div className="pt-1 border-t border-border/50">
                <p className="text-[0.65rem] text-muted-foreground uppercase tracking-wider font-medium mb-1.5">
                  <BookmarkIcon className="size-3 inline-block mr-0.5 -mt-0.5" />
                  Saved
                </p>
                <div className="flex flex-wrap gap-1">
                  {presets.map((preset) => {
                    const isActive = preset.sport === activeSport && preset.location === activeLocation;
                    return (
                      <div key={preset.id} className="flex items-center gap-0.5">
                        <Button
                          variant={isActive ? "default" : "outline"}
                          size="sm"
                          className="h-10 px-3 text-xs"
                          onClick={() => {
                            if (isActive) {
                              clearFilters();
                            } else {
                              handleApplyPreset(preset);
                            }
                          }}
                        >
                          {preset.label}
                        </Button>
                        <Button
                          variant="ghost"
                          className="size-10 text-muted-foreground"
                          onClick={() => handleDeletePreset(preset.id)}
                          aria-label={`Delete saved filter "${preset.label}"`}
                        >
                          <XIcon className="size-3" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {hasActiveFilter && (
        <Button
          variant="ghost"
          className="size-10 text-muted-foreground"
          onClick={clearFilters}
          aria-label="Clear dashboard filters"
        >
          <XIcon className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
