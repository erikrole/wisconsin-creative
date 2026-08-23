"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ImportResult } from "../_types";
import { VARIANT_COLORS } from "../_types";

function SummaryCard({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant?: string;
}) {
  return (
    <Card className="p-4 text-center">
      <div className={`text-3xl font-bold ${variant ? VARIANT_COLORS[variant] || "" : "text-foreground"}`}>
        {value}
      </div>
      <div className="text-sm text-muted-foreground mt-1">{label}</div>
    </Card>
  );
}

interface ImportResultStepProps {
  result: ImportResult;
  onDownloadErrors: () => void;
  onReset: () => void;
}

export function ImportResultStep({
  result,
  onDownloadErrors,
  onReset,
}: ImportResultStepProps) {
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <SummaryCard label="Created" value={result.created} variant="green" />
        <SummaryCard label="Updated" value={result.updated} variant="blue" />
        <SummaryCard label="Item families" value={result.bulkCreated} variant="purple" />
        <SummaryCard label="Images queued" value={result.imagesQueued} variant={result.imagesQueued > 0 ? "blue" : undefined} />
        <SummaryCard label="Kits created" value={result.kitsCreated} variant="purple" />
        <SummaryCard label="Skipped" value={result.skipped} variant={result.skipped > 0 ? "red" : undefined} />
      </div>

      {result.errors.length > 0 && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Errors ({result.errors.length})</CardTitle>
            <Button variant="outline" className="h-10" onClick={onDownloadErrors}>
              Download error CSV
            </Button>
          </CardHeader>
          <div className="overflow-x-auto max-h-[300px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Line</TableHead>
                  <TableHead>Asset Tag</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.errors.slice(0, 50).map((e, i) => (
                  <TableRow key={i}>
                    <TableCell>{e.line}</TableCell>
                    <TableCell className="font-semibold">{e.assetTag}</TableCell>
                    <TableCell className="text-sm text-destructive">{e.error}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      <Card>
        <CardContent className="py-8 text-center">
          <div className="text-2xl font-bold mb-2">
            {result.created + result.updated > 0 ? "Import complete" : "No items imported"}
          </div>
          <div className="text-muted-foreground mb-4">
            {result.created} created, {result.updated} updated, {result.bulkCreated} item families, {result.skipped} skipped
          </div>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={onReset}>Import another file</Button>
            <Button asChild><Link href="/items">View items</Link></Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
