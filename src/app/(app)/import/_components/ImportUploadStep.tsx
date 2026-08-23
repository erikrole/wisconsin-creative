"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { UploadIcon, Download } from "lucide-react";

interface ImportUploadStepProps {
  file: File | null;
  loading: boolean;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDrop: (e: React.DragEvent) => void;
  onParseHeaders: () => void;
}

export function ImportUploadStep({
  file,
  loading,
  fileRef,
  onFileSelect,
  onDrop,
  onParseHeaders,
}: ImportUploadStepProps) {
  return (
    <Card>
      <CardHeader><CardTitle>Upload CSV file</CardTitle></CardHeader>
      <CardContent>
        <div
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileRef.current?.click()}
          className={`border-2 border-dashed rounded-xl py-12 px-6 text-center cursor-pointer transition-colors ${
            file
              ? "border-[var(--green)]/50 bg-[var(--green-bg)]"
              : "border-border bg-muted/50 hover:bg-muted"
          }`}
        >
          <input
            ref={fileRef}
            id="import-csv-file"
            name="importCsvFile"
            type="file"
            accept=".csv,.CSV"
            onChange={onFileSelect} className="hidden"
          />
          {file ? (
            <>
              <div className="text-xl font-semibold mb-1">{file.name}</div>
              <div className="text-muted-foreground text-sm">
                {(file.size / 1024).toFixed(1)} KB — Click or drop to replace
              </div>
            </>
          ) : (
            <>
              <UploadIcon className="size-12 text-muted-foreground mx-auto mb-2" />
              <div className="font-semibold mb-1">Drop your CSV here</div>
              <div className="text-muted-foreground text-sm">
                Supports semicolon and comma delimited CSV
              </div>
            </>
          )}
        </div>

        <div className="flex items-center mt-4">
          <Button variant="ghost" className="h-10" asChild>
            <a href="/import-template.csv" download="import-template.csv">
              <Download className="mr-1.5 size-3.5" />
              Download template
            </a>
          </Button>
          <div className="flex-1" />
          <Button
            disabled={!file || loading}
            onClick={onParseHeaders}
          >
            {loading ? "Reading..." : "Next: Map columns"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
