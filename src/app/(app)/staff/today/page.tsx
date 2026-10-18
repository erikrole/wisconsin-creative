"use client";

import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/UserAvatar";
import { useFetch } from "@/hooks/use-fetch";
import { formatTimeShort } from "@/lib/format";
import { AREA_COLORS, AREA_LABELS } from "../types";

type TodayPerson = { id: string; name: string; avatarUrl: string | null; area: string };
type TodayEvent = {
  id: string;
  summary: string;
  startsAt: string;
  endsAt: string;
  when: "now" | "later" | "tomorrow";
  people: TodayPerson[];
};
type TodayData = { onNowCount: number; events: TodayEvent[] };

const SECTIONS: { when: TodayEvent["when"]; title: string }[] = [
  { when: "now", title: "Happening now" },
  { when: "later", title: "Later today" },
  { when: "tomorrow", title: "Tomorrow" },
];

function EventCard({ event }: { event: TodayEvent }) {
  return (
    <li className="rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-base font-bold">{event.summary}</h3>
        <p className="text-sm tabular-nums text-muted-foreground">
          {formatTimeShort(event.startsAt)} – {formatTimeShort(event.endsAt)}
        </p>
      </div>
      <ul className="mt-3 flex flex-wrap gap-2">
        {event.people.map((person) => (
          <li key={person.id}>
            <Link
              href={`/staff/${person.id}`}
              className="flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm text-foreground no-underline transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <UserAvatar name={person.name} avatarUrl={person.avatarUrl} size="sm" />
              <span className="font-bold">{person.name}</span>
              <span aria-hidden="true" className="size-1.5 rounded-full" style={{ background: AREA_COLORS[person.area] ?? "#b9bbc6" }} />
              <span className="text-xs text-muted-foreground">{AREA_LABELS[person.area] ?? person.area}</span>
            </Link>
          </li>
        ))}
      </ul>
    </li>
  );
}

export default function StaffTodayPage() {
  const { data, loading, error, reload } = useFetch<TodayData>({
    url: "/api/users/today",
    refetchOnFocus: true,
    transform: (json) => json.data as TodayData,
  });

  const events = data?.events ?? [];
  const count = (when: TodayEvent["when"]) => events.filter((event) => event.when === when).length;
  const todayLabel = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <>
      <PageHeader title="Today" description={`${todayLabel}. Who is working what, from published schedules.`} />

      {loading && !data && (
        <div className="grid gap-3">
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
      )}

      {error && !data && (
        <EmptyState
          icon="users"
          title="Couldn't load today"
          description="Check your connection and try again."
          actionLabel="Retry"
          onAction={reload}
        />
      )}

      {data && (
        <>
          <dl className="mb-6 grid grid-cols-3 gap-3">
            {[
              ["On shift now", data.onNowCount],
              ["Events today", count("now") + count("later")],
              ["Events tomorrow", count("tomorrow")],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border bg-card p-4 shadow-xs">
                <dt className="text-sm text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-2xl font-black tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>

          {events.length === 0 ? (
            <EmptyState
              icon="calendar"
              title="Nothing scheduled"
              description="No published shifts for today or tomorrow."
              actionLabel="Open schedule"
              actionHref="/schedule"
            />
          ) : (
            <div className="flex flex-col gap-6">
              {SECTIONS.filter((section) => count(section.when) > 0).map((section) => (
                <section key={section.when} aria-label={section.title}>
                  <h2 className="mb-2 flex items-center gap-2 text-sm font-bold">
                    {section.when === "now" && <span aria-hidden="true" className="size-2 rounded-full bg-[var(--green-text)]" />}
                    {section.title}
                  </h2>
                  <ul className="grid gap-3">
                    {events
                      .filter((event) => event.when === section.when)
                      .map((event) => (
                        <EventCard key={event.id} event={event} />
                      ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
