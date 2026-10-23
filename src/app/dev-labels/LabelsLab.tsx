"use client";

import { installUsbSimulation, UsbSimulationControls } from "./UsbSimulation";
import { applyPrintCommand, newPrintJob, remainingLabels, type PrintJob } from "@/lib/label-print-job";
import { Button } from "@/components/ui/button";
import { Suspense, useEffect, useState } from "react";
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
    const demoUser = JSON.parse(localStorage.getItem("dev-labels-actor") ?? "null") ?? { id: "dev", name: "Dev Staff", email: "staff@creative.local", role: "STAFF" };
    if (url.pathname === "/api/me") return json({ user: demoUser });
    if (url.pathname.startsWith("/api/labels/print-jobs")) {
      const key = "dev-labels-print-history-v1";
      const jobs = JSON.parse(localStorage.getItem(key) ?? "[]") as PrintJob[];
      const actor = { id: demoUser.id as string, name: demoUser.name as string };
      const now = new Date().toISOString();
      const save = (job: PrintJob) => { const i = jobs.findIndex((entry) => entry.id === job.id); if (i < 0) jobs.unshift(job); else jobs[i] = job; localStorage.setItem(key, JSON.stringify(jobs)); return json({ data: job }); };
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        const existing = jobs.find((job) => job.id === body.id); if (existing) return json({ data: existing });
        if (body.parentId) { const parent = jobs.find((job) => job.id === body.parentId)!; if (!parent || parent.activeIndex !== null || parent.revision !== body.parentRevision || JSON.stringify(remainingLabels(parent)) !== JSON.stringify(body.labels)) return new Response("Conflict", { status: 409 }); jobs[jobs.indexOf(parent)] = applyPrintCommand(parent, { type: "review" }, actor, now); }
        if (jobs.some((job) => job.browserId === body.browserId && job.state !== "reviewed")) return new Response("Conflict", { status: 409 });
        return save(newPrintJob(body, actor, now));
      }
      if (!init?.method && /^\/api\/labels\/print-jobs\/[a-f0-9-]+$/.test(url.pathname)) { const job = jobs.find((job) => job.id === url.pathname.split("/").pop()); return job ? json({ data: job }) : new Response(JSON.stringify({ error: "Print batch not found" }), { status: 404, headers: { "Content-Type": "application/json" } }); }
      if (init?.method === "PATCH") {
        const job = jobs.find((entry) => entry.id === url.pathname.split("/").pop()), body = JSON.parse(String(init.body));
        const requests = JSON.parse(localStorage.getItem("dev-labels-print-requests-v1") ?? "{}") as Record<string, string>;
        if (requests[body.requestId] === JSON.stringify(body)) return json({ data: job });
        if (!job || job.revision !== body.revision) return new Response("Conflict", { status: 409 });
        requests[body.requestId] = JSON.stringify(body); localStorage.setItem("dev-labels-print-requests-v1", JSON.stringify(requests));
        return save(applyPrintCommand(job, body.command, actor, now));
      }
      const active = jobs.find((job) => job.browserId === url.searchParams.get("browserId") && job.state !== "reviewed");
      const staff = ["STAFF", "ADMIN"].includes(demoUser.role);
      return json({ data: { jobs: jobs.filter((job) => staff || job.actor.id === actor.id), nextCursor: null, active: active && (staff || active.actor.id === actor.id) ? active : null, blockedByOtherOperator: Boolean(active && !staff && active.actor.id !== actor.id) } });
    }
    if (url.pathname === "/api/assets") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      // Opt-in real identity for a bounded physical printer check; all APIs remain mocked.
      const deviceProof = new URLSearchParams(window.location.search).get("device-proof") === "1"
        ? [asset("a-c62a82d7", "FB FX3 1", "Sony", "FX3", "Camera Bodies")] : [];
      const data = [...ASSETS, ...deviceProof].filter((a) => !q || `${a.assetTag} ${a.brand} ${a.model}`.toLowerCase().includes(q));
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
  const [deviceCheck, setDeviceCheck] = useState(false), [checkMessage, setCheckMessage] = useState("");
  useEffect(() => { setDeviceCheck(new URLSearchParams(location.search).get("device-proof") === "1"); }, []);
  const loadDeviceCheck = (restore = false, letters = false) => {
    if (localStorage.getItem("wc-qr-usb-journal-v2") || localStorage.getItem("wc-qr-usb-last-batch-v1")) { setCheckMessage("Review and finish the current printer batch first."); return; }
    const actor = JSON.parse(localStorage.getItem("dev-labels-actor") ?? "null") ?? { id: "dev" };
    const key = `labels.cart.v3:${actor.id}`, backup = "dev-labels-device-check-previous-sheet";
    if (restore) { const previous = localStorage.getItem(backup); if (previous !== null) localStorage.setItem(key, previous); }
    else {
      if (localStorage.getItem(backup) === null) localStorage.setItem(backup, localStorage.getItem(key) ?? "[]");
      const rows = (letters ? ["A", "B", "C"].map(letter => ["body", "TEST", "CHAIN", letter, "c62a82d7"]) : [
        ["body", "TEST", "FX3", "1", "c62a82d7"], ["lens", "TEST", "100-400", "1", "c62a82d7"],
        ["sd", "TEST", "FX3", "1A", ""], ["text", "", "USB TEST", "", ""],
        ["numberTag", "", "", "1", "c62a82d7"], ["battery", "", "", "1", "c62a82d7"],
      ]).map(([kind, dept, model, number, qrCodeValue], i) => ({ id: `device-check-${i}`, name: kind, title: `Device check · ${kind}`, kind, dept, model, number, qrCodeValue, copies: 1 }));
      localStorage.setItem(key, JSON.stringify(rows));
    }
    location.reload();
  };
  const [client] = useState(() => {
    if (typeof window !== "undefined") { installFetchMock(); installUsbSimulation(); }
    return new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  return (
    <QueryClientProvider client={client}>
      <div className="min-h-screen bg-background px-4 py-6 sm:px-8">
        <div className="mx-auto max-w-6xl">
          {deviceCheck && <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-xs"><span className="mr-auto">Local printer check · Four QR samples open FB FX3 1 · SD and text have no QR</span><Button variant="outline" size="sm" className="h-10" onClick={() => loadDeviceCheck()}>Load six-layout device check</Button><Button variant="outline" size="sm" className="h-10" onClick={() => loadDeviceCheck(false, true)}>Load A/B/C Stop check</Button><Button variant="outline" size="sm" className="h-10" onClick={() => loadDeviceCheck(true)}>Restore previous sheet</Button>{checkMessage && <p role="alert" className="w-full text-destructive">{checkMessage}</p>}</div>}
          <UsbSimulationControls />
          <Suspense>
            <LabelsHelper />
          </Suspense>
        </div>
      </div>
      <Toaster position="bottom-center" />
    </QueryClientProvider>
  );
}
