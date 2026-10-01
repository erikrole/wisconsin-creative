"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import CsvImportDialog from "./CsvImportDialog";

/** Backfills start terms and per-term sport placements from a roster sheet export. */
export default function RosterImportButton({ defaultYear }: { defaultYear: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(String(defaultYear));

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Import roster
      </Button>
      <CsvImportDialog
        open={open}
        onOpenChange={setOpen}
        title="Import student roster"
        description="Matches people by campus or athletics email. Adds a start term only where none is set, and term placements only for terms that have none. Existing values are never overwritten."
        endpoint="/api/workforce/import"
        extraPayload={{ academicYearStart: Number(year) }}
        extraControls={
          <div className="grid gap-1.5">
            <Label htmlFor="roster-year">Fall term year</Label>
            <Input id="roster-year" className="w-28" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} />
            <p className="text-xs text-muted-foreground">Use 2025 for the 2025-26 sheet. Its Winter and Spring columns land in 2026.</p>
          </div>
        }
        onApplied={() => router.refresh()}
      />
    </>
  );
}
