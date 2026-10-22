"use client";

import { Suspense, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import LabelsHelper from "@/app/(app)/labels/LabelsHelper";

const asset = (id: string, assetTag: string, brand: string, model: string, category: string, location = "Camp Randall") => ({
  id, assetTag, name: null, brand, model, category: { name: category }, location: { name: location },
  qrCodeValue: id.replace("a-", "").padEnd(8, "0"), primaryScanCode: undefined,
});

const ASSETS = [
  asset("a-6d6623d4", "FB A7 IV 1", "Sony", "A7 IV", "Camera Bodies"),
  asset("a-6d6623d5", "FB A7 IV 2", "Sony", "A7 IV", "Camera Bodies"),
  asset("a-7a01fx31", "FX3 1", "Sony", "FX3", "Camera Bodies", "Kohl Center"),
  asset("a-7a01fx32", "FX3 2", "Sony", "FX3", "Camera Bodies", "Kohl Center"),
  asset("a-1bc3ee46", "100-400 1", "Sony", "FE 100-400mm GM", "Lenses"),
  asset("a-1bc3ee47", "24-70 2", "Sony", "FE 24-70mm GM II", "Lenses"),
  asset("a-9f00aa11", "MBB Z9 1", "Nikon", "Z9", "Camera Bodies", "Kohl Center"),
];

const FAMILIES = [
  { id: "f-batt", name: "Sony NP-FZ100 Battery", category: "Batteries", trackByNumber: true, onHandQuantity: 48, availableQuantity: 41, binQrCodeValue: "BATT-FZ100", locationName: "Cage" },
  { id: "f-npf", name: "Sony NP-F970 Battery", category: "Batteries", trackByNumber: true, onHandQuantity: 24, availableQuantity: 20, binQrCodeValue: "BATT-F970", locationName: "Cage" },
  { id: "f-xlr", name: "XLR Cable 25 ft", category: "Audio", trackByNumber: false, onHandQuantity: 36, availableQuantity: 30, binQrCodeValue: "XLR25", locationName: "Cage" },
  { id: "f-gaff", name: "Gaff Tape", category: "Expendables", trackByNumber: false, onHandQuantity: 12, availableQuantity: 12, binQrCodeValue: "GAFF", locationName: "Cage" },
];

const UNITS: Record<string, { unitNumber: number; status: string; labelPrintedAt: string | null }[]> = {
  "f-batt": Array.from({ length: 52 }, (_, i) => ({
    unitNumber: i + 1,
    status: i >= 49 ? "RETIRED" : "AVAILABLE",
    labelPrintedAt: i < 36 ? "2026-09-01T00:00:00Z" : null,
  })),
  "f-npf": Array.from({ length: 24 }, (_, i) => ({ unitNumber: i + 1, status: "AVAILABLE", labelPrintedAt: null })),
};

function installFetchMock() {
  const w = window as typeof window & { __labelsMock?: boolean };
  if (w.__labelsMock) return;
  w.__labelsMock = true;
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
    const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
    if (url.pathname === "/api/me") {
      return json({ user: { id: "dev", name: "Dev Staff", email: "staff@creative.local", role: "STAFF" } });
    }
    if (url.pathname === "/api/assets") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const data = ASSETS.filter((a) => !q || `${a.assetTag} ${a.brand} ${a.model}`.toLowerCase().includes(q));
      const bulkItems = FAMILIES.filter((f) => !q || f.name.toLowerCase().includes(q));
      return json({ data, bulkItems, total: data.length + bulkItems.length });
    }
    const units = /^\/api\/bulk-skus\/([^/]+)\/units(\/labels)?$/.exec(url.pathname);
    if (units) {
      const list = UNITS[units[1] ?? ""] ?? [];
      if (units[2] && init?.method === "POST") {
        const numbers: number[] = JSON.parse(String(init.body)).unitNumbers;
        list.forEach((u) => { if (numbers.includes(u.unitNumber)) u.labelPrintedAt = new Date().toISOString(); });
        return json({ data: { updated: numbers.length } });
      }
      return json({ data: list });
    }
    return real(input, init);
  };
}

export default function LabelsLab() {
  const [client] = useState(() => {
    if (typeof window !== "undefined") installFetchMock();
    return new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  return (
    <QueryClientProvider client={client}>
      <div className="min-h-screen bg-background px-4 py-6 sm:px-8">
        <div className="mx-auto max-w-6xl">
          <Suspense>
            <LabelsHelper />
          </Suspense>
        </div>
      </div>
      <Toaster position="bottom-center" />
    </QueryClientProvider>
  );
}
