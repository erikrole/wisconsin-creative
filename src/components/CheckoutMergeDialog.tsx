"use client";

import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { dateTimeLocalToIso, toDateTimeLocalValue } from "@/lib/shift-call-windows";
import { formatDateTime } from "@/lib/format";

const DIRECT_SOURCE_VALUE = "__direct_event_checkout__";

export type CheckoutMergePreview = {
  targetCheckoutId: string;
  sourceCheckoutIds: string[];
  title: string;
  requesterUserId: string;
  custodyScope: "PERSON" | "SHARED";
  eventIds: string[];
  serializedItemCount: number;
  bulkQuantity: number;
  targetCheckout: {
    id: string;
    refNumber: string | null;
    startsAt: string;
    latestPickupAt: string;
    endsAt: string;
    sourceReservationId: string | null;
  };
  returnWindowOptions: Array<{
    endsAt: string;
    checkoutIds: string[];
    checkoutRefs: Array<string | null>;
  }>;
  sourceReservationOptions: Array<{
    sourceReservationId: string | null;
    checkoutIds: string[];
    checkoutRefs: Array<string | null>;
  }>;
  conflicts: {
    returnWindow: boolean;
    sourceReservation: boolean;
  };
};

export type CheckoutMergeDecision = {
  endsAt: string;
  sourceReservationId: string | null;
  allowContextOverrides: true;
};

type CheckoutMergeDialogProps = {
  open: boolean;
  preview: CheckoutMergePreview | null;
  requesterName: string;
  totalItems: number;
  onCancel: () => void;
  onConfirm: (decision: CheckoutMergeDecision) => void;
};

function sourceOptionValue(sourceReservationId: string | null) {
  return sourceReservationId ?? DIRECT_SOURCE_VALUE;
}

function checkoutLabel(id: string, refNumber: string | null) {
  return refNumber ?? `Checkout ${id.slice(-6)}`;
}

function optionCheckoutLabels(
  ids: string[],
  refs: Array<string | null>,
) {
  return ids.map((id, index) => checkoutLabel(id, refs[index] ?? null)).join(", ");
}

export function CheckoutMergeDialog({
  open,
  preview,
  requesterName,
  totalItems,
  onCancel,
  onConfirm,
}: CheckoutMergeDialogProps) {
  const [returnChoice, setReturnChoice] = useState("");
  const [endsAtInput, setEndsAtInput] = useState("");
  const [sourceChoice, setSourceChoice] = useState("");
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !preview) return;
    const defaultEndsAt = preview.targetCheckout.endsAt;
    setReturnChoice(defaultEndsAt);
    setEndsAtInput(toDateTimeLocalValue(defaultEndsAt));
    setSourceChoice(sourceOptionValue(preview.targetCheckout.sourceReservationId));
    setValidationMessage(null);
  }, [open, preview]);

  const selectedSource = preview?.sourceReservationOptions.find(
    (option) => sourceOptionValue(option.sourceReservationId) === sourceChoice,
  );
  const hasInvalidReturnTime = !preview || !dateTimeLocalToIso(endsAtInput);

  function handleConfirm() {
    if (!preview) return;
    const endsAt = dateTimeLocalToIso(endsAtInput);
    if (!endsAt) {
      setValidationMessage("Enter a valid return date and time.");
      return;
    }
    if (new Date(endsAt) <= new Date(preview.targetCheckout.latestPickupAt)) {
      setValidationMessage("The return time must be after every selected pickup time.");
      return;
    }
    if (!selectedSource) {
      setValidationMessage("Choose which reservation link should stay on the merged checkout.");
      return;
    }
    onConfirm({
      endsAt,
      sourceReservationId: selectedSource.sourceReservationId,
      allowContextOverrides: true,
    });
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onCancel(); }}>
      <DialogContent className="grid max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-xl">
        <DialogHeader className="pr-16">
          <div>
            <DialogTitle>Merge checkouts</DialogTitle>
            <DialogDescription className="mt-1">
              Review the surviving return time and reservation link before combining these open checkouts.
            </DialogDescription>
          </div>
        </DialogHeader>

        <DialogBody className="min-h-0 space-y-5 overflow-y-auto py-5">
          <div className="rounded-lg border border-border/70 bg-muted/25 px-4 py-3 text-sm">
            <div className="font-medium">{preview?.title ?? "Selected checkouts"}</div>
            <div className="mt-1 text-muted-foreground">
              {requesterName} · {totalItems} total {totalItems === 1 ? "item" : "items"} · surviving checkout {preview?.targetCheckout.refNumber ?? "—"}
            </div>
          </div>

          {preview && (preview.conflicts.returnWindow || preview.conflicts.sourceReservation) && (
            <Alert>
              <AlertTitle>Review the differences before merging</AlertTitle>
              <AlertDescription className="space-y-1">
                {preview.conflicts.returnWindow && (
                  <p>Return times differ. Choose the time the merged checkout should use, or adjust it below.</p>
                )}
                {preview.conflicts.sourceReservation && (
                  <p>These checkouts came from different reservation records. Choose which reservation link should remain on the surviving checkout.</p>
                )}
              </AlertDescription>
            </Alert>
          )}

          {preview && (
            <section className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold">Return time</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  The active checkout and return reminders will use this time.
                </p>
              </div>
              <RadioGroup
                value={returnChoice}
                onValueChange={(value) => {
                  setReturnChoice(value);
                  const option = preview.returnWindowOptions.find((candidate) => candidate.endsAt === value);
                  if (option) setEndsAtInput(toDateTimeLocalValue(option.endsAt));
                  setValidationMessage(null);
                }}
                aria-label="Return time options"
              >
                {preview.returnWindowOptions.map((option) => {
                  const id = `checkout-merge-return-${option.endsAt}`;
                  return (
                    <Label
                      key={option.endsAt}
                      htmlFor={id}
                      className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 px-3 py-3 font-normal transition-colors hover:bg-muted/45"
                    >
                      <RadioGroupItem id={id} value={option.endsAt} className="mt-0.5" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{formatDateTime(option.endsAt)}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          From {optionCheckoutLabels(option.checkoutIds, option.checkoutRefs)}
                        </span>
                      </span>
                    </Label>
                  );
                })}
                <Label
                  htmlFor="checkout-merge-return-custom"
                  className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 px-3 py-3 font-normal transition-colors hover:bg-muted/45"
                >
                  <RadioGroupItem id="checkout-merge-return-custom" value="custom" className="mt-0.5" />
                  <span className="text-sm font-medium">Adjust return time</span>
                </Label>
              </RadioGroup>
              <div className="space-y-2">
                <Label htmlFor="checkout-merge-return-time">Merged checkout returns by</Label>
                <Input
                  id="checkout-merge-return-time"
                  type="datetime-local"
                  value={endsAtInput}
                  onChange={(event) => {
                    setEndsAtInput(event.target.value);
                    setReturnChoice("custom");
                    setValidationMessage(null);
                  }}
                  aria-invalid={hasInvalidReturnTime || undefined}
                />
              </div>
            </section>
          )}

          {preview && preview.sourceReservationOptions.length > 1 && (
            <section className="space-y-3 border-t border-border/70 pt-5">
              <div>
                <h3 className="text-sm font-semibold">Keep reservation link from</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  The cancelled source checkout records keep their original links in history.
                </p>
              </div>
              <RadioGroup
                value={sourceChoice}
                onValueChange={(value) => {
                  setSourceChoice(value);
                  setValidationMessage(null);
                }}
                aria-label="Reservation link to keep"
              >
                {preview.sourceReservationOptions.map((option) => {
                  const value = sourceOptionValue(option.sourceReservationId);
                  const id = `checkout-merge-source-${value}`;
                  return (
                    <Label
                      key={value}
                      htmlFor={id}
                      className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 px-3 py-3 font-normal transition-colors hover:bg-muted/45"
                    >
                      <RadioGroupItem id={id} value={value} className="mt-0.5" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">
                          {option.sourceReservationId ? "Reservation-linked checkout" : "Direct event checkout"}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          From {optionCheckoutLabels(option.checkoutIds, option.checkoutRefs)}
                        </span>
                      </span>
                    </Label>
                  );
                })}
              </RadioGroup>
            </section>
          )}

          {validationMessage && (
            <p className="text-sm text-destructive" role="alert">{validationMessage}</p>
          )}
        </DialogBody>

        <DialogFooter className="border-t border-border/70 px-6 py-4">
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button type="button" onClick={handleConfirm} disabled={!preview || hasInvalidReturnTime}>
            Merge checkouts
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
