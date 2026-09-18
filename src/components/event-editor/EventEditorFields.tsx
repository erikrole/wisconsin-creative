"use client";

import { CalendarIcon, RotateCcw } from "lucide-react";
import { format } from "date-fns";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatCalendarEventDateRange } from "@/lib/calendar-event-dates";
import {
  NONE_LOCATION_VALUE,
  NONE_SPORT_VALUE,
  QUARTER_HOUR_MINUTES,
  buildEventDraftDateTime,
  type EventEditorDraft,
  type EventTypeDraft,
} from "@/lib/event-editor";
import { SPORT_CODES } from "@/lib/sports";
import { VENUE_TONES } from "@/lib/venue-tone";

export type EventEditorLocation = { id: string; name: string };

function eventTypeLabel(type: EventTypeDraft): string {
  if (type === "non-game") return "Non-game";
  return VENUE_TONES[type].label;
}

function DateTimeField({
  label,
  fieldId,
  date,
  time,
  allDay,
  disabled,
  onDateChange,
  onTimeChange,
}: {
  label: string;
  fieldId: string;
  date: Date | undefined;
  time: string;
  allDay: boolean;
  disabled?: boolean;
  onDateChange: (date: Date | undefined) => void;
  onTimeChange: (time: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`${fieldId}-time`}>{label}</Label>
      <div className="flex gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className="min-w-0 flex-1 justify-start gap-2 font-normal"
              disabled={disabled}
              aria-label={`${label} date`}
            >
              <CalendarIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{date ? format(date, "MMM d, yyyy") : "Pick a date"}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="single" selected={date} onSelect={onDateChange} initialFocus />
          </PopoverContent>
        </Popover>
        {!allDay && (
          <Input
            id={`${fieldId}-time`}
            name={`${fieldId}Time`}
            type="time"
            step={QUARTER_HOUR_MINUTES * 60}
            value={time}
            onChange={(event) => onTimeChange(event.target.value)}
            className="w-[120px] shrink-0"
            disabled={disabled}
          />
        )}
      </div>
    </div>
  );
}

function RestoreButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="flex items-center gap-1 text-[11px] text-[var(--orange-text)] hover:opacity-80"
      onClick={onClick}
      disabled={disabled}
    >
      <RotateCcw className="size-3" />
      Restore calendar value
    </button>
  );
}

export function EventEditorFields({
  draft,
  onChange,
  locations,
  locationsError,
  locationsLoading,
  disabled,
  imported,
  venueHint,
  timingHint,
  locks,
  onRevert,
  onStartTimingTouch,
  onEndTimingTouch,
}: {
  draft: EventEditorDraft;
  onChange: (patch: Partial<EventEditorDraft>) => void;
  locations: EventEditorLocation[];
  locationsError?: string;
  locationsLoading?: boolean;
  disabled?: boolean;
  imported?: boolean;
  venueHint?: string | null;
  timingHint?: string;
  locks?: {
    title?: boolean;
    type?: boolean;
    location?: boolean;
    timing?: boolean;
  };
  onRevert?: {
    title?: () => void;
    type?: () => void;
    location?: () => void;
    timing?: () => void;
  };
  onStartTimingTouch?: () => void;
  onEndTimingTouch?: () => void;
}) {
  const allDayPreview = (() => {
    if (!draft.allDay || !draft.startDate || !draft.endDate) return null;
    const startsAt = buildEventDraftDateTime(draft.startDate, draft.startTime, true, false);
    const endsAt = buildEventDraftDateTime(draft.endDate, draft.endTime, true, true);
    if (!startsAt || !endsAt || new Date(endsAt) <= new Date(startsAt)) return null;
    return formatCalendarEventDateRange({ startsAt, endsAt, allDay: true });
  })();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="event-title">Title</Label>
          {imported && locks?.title && onRevert?.title ? (
            <RestoreButton onClick={onRevert.title} disabled={disabled} />
          ) : null}
        </div>
        <Input
          id="event-title"
          placeholder="e.g. Men's Basketball vs Duke"
          value={draft.title}
          onChange={(event) => onChange({ title: event.target.value })}
          maxLength={200}
          disabled={disabled}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="event-subtitle">
          Label <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="event-subtitle"
          value={draft.subtitle}
          onChange={(event) => onChange({ subtitle: event.target.value })}
          maxLength={100}
          placeholder="e.g. Homecoming, White Out"
          disabled={disabled}
        />
      </div>

      <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Date and time</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {timingHint ?? "Moving the event also moves its crew and call times. Existing gear reservation windows stay unchanged."}
            </p>
          </div>
          {imported && locks?.timing && onRevert?.timing ? (
            <RestoreButton onClick={onRevert.timing} disabled={disabled} />
          ) : null}
        </div>
        <div className="flex items-start gap-2">
          <Checkbox
            id="event-all-day"
            checked={draft.allDay}
            onCheckedChange={(checked) => onChange({ allDay: checked === true })}
            disabled={disabled}
          />
          <div className="flex flex-col gap-0.5">
            <Label htmlFor="event-all-day" className="cursor-pointer">All-day event</Label>
            <p className="text-xs text-muted-foreground">
              {draft.allDay ? "Uses inclusive dates with no call time." : "Uses the selected local start and end times."}
            </p>
          </div>
        </div>
        <DateTimeField
          label={draft.allDay ? "Start date" : "Starts"}
          fieldId="event-start"
          date={draft.startDate}
          time={draft.startTime}
          allDay={draft.allDay}
          disabled={disabled}
          onDateChange={(date) => {
            onChange({ startDate: date, endDate: draft.endDate ?? date });
            onStartTimingTouch?.();
          }}
          onTimeChange={(time) => {
            onChange({ startTime: time });
            onStartTimingTouch?.();
          }}
        />
        <DateTimeField
          label={draft.allDay ? "End date" : "Ends"}
          fieldId="event-end"
          date={draft.endDate}
          time={draft.endTime}
          allDay={draft.allDay}
          disabled={disabled}
          onDateChange={(date) => {
            onChange({ endDate: date });
            onEndTimingTouch?.();
          }}
          onTimeChange={(time) => {
            onChange({ endTime: time });
            onEndTimingTouch?.();
          }}
        />
        {draft.allDay ? (
          <Alert>
            <AlertDescription>
              {allDayPreview
                ? `Creates one all-day event covering ${allDayPreview}. Crew, coverage, and bookings stay attached to this event.`
                : "Choose inclusive start and end dates for one all-day event."}
            </AlertDescription>
          </Alert>
        ) : null}
        {imported ? (
          <p className="text-xs text-muted-foreground">
            Saving a new window keeps UWBadgers.com as the source and locks this time until you restore the calendar value.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label>Event type</Label>
          {imported && locks?.type && onRevert?.type ? (
            <RestoreButton onClick={onRevert.type} disabled={disabled} />
          ) : null}
        </div>
        <ToggleGroup
          type="single"
          value={draft.eventType}
          onValueChange={(value) => {
            if (!value) return;
            const nextType = value as EventTypeDraft;
            onChange({
              eventType: nextType,
              opponent: nextType === "non-game" ? "" : draft.opponent,
            });
          }}
          disabled={disabled}
          className="h-9 w-full gap-0 rounded-md border border-input bg-background p-0.5"
        >
          {(["home", "away", "neutral", "non-game"] as EventTypeDraft[]).map((type) => (
            <ToggleGroupItem
              key={type}
              value={type}
              className="h-8 flex-1 rounded-sm px-2 text-sm data-[state=on]:bg-muted data-[state=on]:text-foreground"
            >
              {eventTypeLabel(type)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">
          {draft.eventType === "non-game"
            ? "Use for media days, practices, meetings, travel, and other schedule work without an opponent."
            : "Game events require a sport and opponent so Home, Away, and Neutral stay distinct."}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="event-sport">
          Sport
          {draft.eventType === "non-game" && (
            <span className="font-normal text-muted-foreground"> (optional)</span>
          )}
        </Label>
        <Select
          value={draft.sportCode || NONE_SPORT_VALUE}
          onValueChange={(value) => onChange({ sportCode: value })}
          disabled={disabled}
        >
          <SelectTrigger id="event-sport">
            <SelectValue placeholder="None" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_SPORT_VALUE}>No sport</SelectItem>
            {SPORT_CODES.map((sport) => (
              <SelectItem key={sport.code} value={sport.code}>{sport.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {draft.eventType !== "non-game" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="event-opponent">Opponent</Label>
          <Input
            id="event-opponent"
            placeholder="e.g. Duke"
            value={draft.opponent}
            onChange={(event) => onChange({ opponent: event.target.value })}
            maxLength={120}
            disabled={disabled}
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="event-location">Pickup location</Label>
          {imported && locks?.location && onRevert?.location ? (
            <RestoreButton onClick={onRevert.location} disabled={disabled} />
          ) : null}
        </div>
        <Select
          value={draft.locationId || NONE_LOCATION_VALUE}
          onValueChange={(value) => onChange({ locationId: value })}
          disabled={disabled || locationsLoading}
        >
          <SelectTrigger id="event-location">
            <SelectValue placeholder={locationsLoading ? "Loading…" : "No pickup location"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_LOCATION_VALUE}>No pickup location</SelectItem>
            {locations.map((location) => (
              <SelectItem key={location.id} value={location.id}>{location.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {locationsError ? (
          <p className="text-xs text-muted-foreground">{locationsError}</p>
        ) : null}
        {venueHint ? (
          <p className="text-[11px] text-muted-foreground">Event venue from calendar: {venueHint}</p>
        ) : null}
      </div>
    </div>
  );
}

export function eventEditorIsComplete(draft: EventEditorDraft) {
  if (!draft.title.trim() || !draft.startDate || !draft.endDate) return false;
  if (draft.eventType !== "non-game" && (draft.sportCode === NONE_SPORT_VALUE || !draft.opponent.trim())) {
    return false;
  }
  return true;
}
