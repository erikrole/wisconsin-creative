"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { useFormSubmit } from "@/hooks/use-form-submit";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";

type Location = { id: string; name: string };

interface NewKitSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locations: Location[];
  locationsError?: boolean;
  locationsLoading?: boolean;
  onRetryLocations?: () => void;
  onCreated: (kitId: string) => void;
}

const createKitSchema = z.object({
  name: z.string().min(1, "Kit name is required"),
  description: z.string(),
  locationId: z.string().min(1, "Location is required"),
});

type CreateKitInput = z.infer<typeof createKitSchema>;
type CreatedKit = { id: string; name: string };

export function NewKitSheet({
  open,
  onOpenChange,
  locations,
  locationsError = false,
  locationsLoading = false,
  onRetryLocations,
  onCreated,
}: NewKitSheetProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [createdKit, setCreatedKit] = useState<CreatedKit | null>(null);
  const defaultLocationId = locations[0]?.id ?? "";
  const hasLocations = locations.length > 0;
  const locationsUnavailable = locationsLoading || locationsError || !hasLocations;

  useEffect(() => {
    if (open && !locationId && defaultLocationId) {
      setLocationId(defaultLocationId);
    }
  }, [defaultLocationId, locationId, open]);

  function reset() {
    setName("");
    setDescription("");
    setLocationId(defaultLocationId);
  }

  function finishCreatedKit(mode: "another" | "open" | "list") {
    const kitId = createdKit?.id;
    if (mode === "another") {
      setCreatedKit(null);
      reset();
      clearErrors();
      return;
    }
    setCreatedKit(null);
    reset();
    clearErrors();
    onOpenChange(false);
    if (mode === "open" && kitId) {
      router.push(`/kits/${kitId}`);
    }
  }

  const { submit, submitting, fieldErrors, formError, clearErrors } = useFormSubmit<CreateKitInput, { id: string }>({
    schema: createKitSchema,
    url: "/api/kits",
    onSuccess: (data) => {
      setCreatedKit({ id: data.id, name: name.trim() });
      reset();
      onCreated(data.id);
    },
  });

  function handleOpenChange(nextOpen: boolean) {
    if (submitting) return;
    onOpenChange(nextOpen);
    if (!nextOpen) {
      reset();
      setCreatedKit(null);
      clearErrors();
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    await submit({
      name: name.trim(),
      description: description.trim(),
      locationId,
    });
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>New Kit</SheetTitle>
          <SheetDescription>
            Create a named collection of gear items for quick checkout.
          </SheetDescription>
        </SheetHeader>

        {createdKit ? (
          <div className="flex flex-col gap-4 py-4">
            <Alert>
              <AlertDescription>
                Kit {createdKit.name} was created. Open it to add serialized items and item families, or create another kit.
              </AlertDescription>
            </Alert>
            <div className="rounded-md border bg-muted/30 px-4 py-3 text-sm">
              <p className="font-medium">Next step</p>
              <p className="mt-1 text-muted-foreground">
                Kit contents are managed on the kit detail page.
              </p>
            </div>
          </div>
        ) : (
        <form id="new-kit-form" onSubmit={handleSubmit} className="flex flex-col gap-4 py-4">
          {formError && (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          {locationsError ? (
            <Alert variant="destructive">
              <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span>Locations could not load, so new kits cannot be assigned yet.</span>
                {onRetryLocations && (
                  <Button className="h-10" type="button" variant="outline" onClick={onRetryLocations}>
                    Retry locations
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          ) : locationsLoading ? (
            <Alert>
              <AlertDescription>
                Loading locations before kit creation is available.
              </AlertDescription>
            </Alert>
          ) : !hasLocations && (
            <Alert>
              <AlertDescription>
                Add a location before creating kits. Kits are location-scoped so checkout availability stays accurate.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="kit-name">Name</Label>
            <Input
              id="kit-name"
              name="kitName"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (fieldErrors.name || formError) clearErrors();
              }}
              placeholder="e.g., Interview Kit"
              disabled={submitting}
              aria-invalid={!!fieldErrors.name}
              aria-describedby={fieldErrors.name ? "kit-name-error" : undefined}
              autoFocus
            />
            {fieldErrors.name && (
              <p id="kit-name-error" className="text-sm text-destructive">
                {fieldErrors.name}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="kit-description">Description</Label>
            <Textarea
              id="kit-description"
              name="kitDescription"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                if (fieldErrors.description || formError) clearErrors();
              }}
              placeholder="Optional notes about this kit"
              disabled={submitting}
              aria-invalid={!!fieldErrors.description}
              aria-describedby={fieldErrors.description ? "kit-description-error" : undefined}
              rows={3}
            />
            {fieldErrors.description && (
              <p id="kit-description-error" className="text-sm text-destructive">
                {fieldErrors.description}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="kit-location">Location</Label>
            <Select
              name="kitLocationId"
              value={locationId}
              onValueChange={(value) => {
                setLocationId(value);
                if (fieldErrors.locationId || formError) clearErrors();
              }}
              disabled={submitting || locationsUnavailable}
            >
              <SelectTrigger
                id="kit-location"
                aria-invalid={!!fieldErrors.locationId}
                aria-describedby={fieldErrors.locationId ? "kit-location-error" : undefined}
              >
                <SelectValue placeholder="Select location" />
              </SelectTrigger>
              <SelectContent>
                {locations.map((loc) => (
                  <SelectItem key={loc.id} value={loc.id}>
                    {loc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldErrors.locationId && (
              <p id="kit-location-error" className="text-sm text-destructive">
                {fieldErrors.locationId}
              </p>
            )}
          </div>

        </form>
        )}

        <SheetFooter className="mt-2">
          {createdKit ? (
            <>
              <Button type="button" variant="outline" onClick={() => finishCreatedKit("another")}>
                Create another kit
              </Button>
              <Button type="button" variant="outline" onClick={() => finishCreatedKit("list")}>
                Return to kits
              </Button>
              <Button type="button" onClick={() => finishCreatedKit("open")}>
                Open kit
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" form="new-kit-form" loading={submitting} disabled={locationsUnavailable || submitting}>
                Create kit
              </Button>
            </>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
