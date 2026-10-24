"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TRANSFER_DIALOG_CLASS, TRANSFER_HEADER_CLASS, TransferPicker, type TransferPerson } from "@/components/booking-details/TransferPicker";

const people: TransferPerson[] = ["Ava Jensen", "Ben Okafor", "Chloe Martin", "Diego Alvarez", "Emma Larson", "Finn Hughes", "Grace Kim"]
  .map((name, i) => ({ id: `u${i}`, name, email: `${name.split(" ")[0]!.toLowerCase()}@athletics.wisc.edu`, role: "STUDENT", active: true }));

export default function TransferLab() {
  const params = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const [value, setValue] = useState(params.get("pick") === "1" ? "u2" : "");
  const [reason, setReason] = useState("");
  const item = params.get("item") === "1";
  return (
    <Dialog open>
      <DialogContent className={TRANSFER_DIALOG_CLASS}>
        <DialogHeader className={TRANSFER_HEADER_CLASS}>
          <DialogTitle>{item ? "Transfer CAM-104" : "Transfer owner"}</DialogTitle>
          <DialogDescription>
            {item
              ? "It moves to the receiving person's matching checkout, or a new one with the same event and due time. Scan history stays on the original."
              : "The new owner takes over this checkout. The original creator and history stay as they were."}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <TransferPicker
            from={{ name: "Bucky Badger" }} fromCaption={item ? "Has it now" : "Current owner"}
            users={people} loading={false} error={false} value={value} onChange={setValue}
            reason={reason} onReasonChange={setReason}
            consequence="They get a notification with the due time, and it comes off the current owner's record."
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="outline">Cancel</Button>
          <Button disabled={!value}>{item ? "Transfer item" : "Transfer"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
