"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { CommandPalette } from "@/components/CommandPalette";
import { PageHeader } from "@/components/PageHeader";
import type { CurrentUser } from "@/hooks/use-current-user";
import LabShell, { type LabRoute } from "@/app/dev-lab/LabShell";

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

const ASSETS = [
  { id: "dev-fx6-a", assetTag: "FX6-A", name: null, brand: "Sony", model: "FX6 Cinema Line", imageUrl: null, computedStatus: "CHECKED_OUT", activeBooking: { requesterName: "Maddy Pehler", requesterAvatarUrl: null, isOverdue: false, endsAt: inDays(1) } },
  { id: "dev-fx6-b", assetTag: "FX6-B", name: null, brand: "Sony", model: "FX6 Cinema Line", imageUrl: null, computedStatus: "AVAILABLE", activeBooking: null },
  { id: "dev-fx3-1", assetTag: "FX3-1", name: null, brand: "Sony", model: "FX3", imageUrl: null, computedStatus: "CHECKED_OUT", activeBooking: { requesterName: "Tess Olson", requesterAvatarUrl: null, isOverdue: true, endsAt: inDays(-1) } },
  { id: "dev-fx30", assetTag: "SLOW1", name: null, brand: "Sony", model: "FX30 slow-motion kit", imageUrl: null, computedStatus: "RESERVED", activeBooking: { requesterName: "Jordan Ruiz", requesterAvatarUrl: null, isOverdue: false, endsAt: inDays(3) } },
];
const CHECKOUTS = [{ id: "co-1", title: "Football vs. Iowa", requester: { name: "Maddy Pehler" } }];
const RESERVATIONS = [{ id: "rs-1", title: "Hockey vs. Minnesota", requester: { name: "Jordan Ruiz" } }];
const USERS = [{ id: "u-fx", name: "Felix Xiong", email: "fxiong@wisc.edu" }];

const matches = (q: string, ...fields: Array<string | null | undefined>) => fields.join(" ").toLowerCase().includes(q.toLowerCase());

const route: LabRoute = (url) => {
  const q = url.searchParams.get("q") ?? "";
  if (url.pathname === "/api/assets") return { data: ASSETS.filter((a) => matches(q, a.assetTag, a.brand, a.model)) };
  if (url.pathname === "/api/checkouts") return { data: CHECKOUTS.filter((b) => matches(q, b.title, b.requester.name)) };
  if (url.pathname === "/api/reservations") return { data: RESERVATIONS.filter((b) => matches(q, b.title, b.requester.name)) };
  if (url.pathname === "/api/users") return { data: USERS.filter((u) => matches(q, u.name, u.email)) };
  if (url.pathname === "/api/resources") return { data: [] };
  return undefined;
};

function Palette() {
  const pathname = usePathname();
  const [open, setOpen] = useState(true);
  const user = { id: "dev", name: "Erik Role", email: "dev@example.com", role: "ADMIN" } as CurrentUser;
  return (
    <>
      <PageHeader title="Home" />
      <CommandPalette open={open} onOpenChange={setOpen} user={user} pathname={pathname} />
    </>
  );
}

export default function SearchLab({ fontClass }: { fontClass: string }) {
  return (
    <LabShell fontClass={fontClass} route={route}>
      <Palette />
    </LabShell>
  );
}
