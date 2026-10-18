"use client";

import Link from "next/link";
import { UserAvatar } from "@/components/UserAvatar";
import { useFetch } from "@/hooks/use-fetch";
import { formatTimeShort } from "@/lib/format";
import { AREA_COLORS, AREA_LABELS } from "../types";

type OnShiftPerson = {
  id: string;
  name: string;
  avatarUrl: string | null;
  area: string;
  event: string;
  endsAt: string;
};

/**
 * "On shift now": people working a published shift this minute. Renders nothing when nobody is,
 * so the roster stays quiet outside game days.
 */
export default function OnShiftNow({ enabled }: { enabled: boolean }) {
  const { data } = useFetch<OnShiftPerson[]>({
    url: "/api/users/on-shift",
    enabled,
    refetchOnFocus: true,
    transform: (json) => (Array.isArray(json.data) ? (json.data as OnShiftPerson[]) : []),
  });
  if (!data || data.length === 0) return null;

  return (
    <section aria-label="On shift now" className="rounded-xl border bg-card p-4 shadow-xs">
      <div className="mb-3 flex items-center gap-2">
        <span aria-hidden="true" className="size-2 rounded-full bg-[var(--green-text)]" />
        <h2 className="text-sm font-bold">On shift now</h2>
        <span className="text-xs tabular-nums text-muted-foreground">{data.length}</span>
      </div>
      <ul className="flex gap-3 overflow-x-auto pb-1">
        {data.map((person) => (
          <li key={person.id} className="shrink-0">
            <Link
              href={`/staff/${person.id}`}
              className="flex w-56 items-center gap-2.5 rounded-lg border px-3 py-2 text-foreground no-underline transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <UserAvatar name={person.name} avatarUrl={person.avatarUrl} size="default" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold">{person.name}</span>
                <span className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                  <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ background: AREA_COLORS[person.area] ?? "#b9bbc6" }} />
                  <span className="truncate">
                    {AREA_LABELS[person.area] ?? person.area} · until {formatTimeShort(person.endsAt)}
                  </span>
                </span>
                <span className="block truncate text-[11px] text-muted-foreground/80">{person.event}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
