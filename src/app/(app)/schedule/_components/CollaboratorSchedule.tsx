"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BellIcon, BellOffIcon, CalendarDaysIcon, MapPinIcon } from "lucide-react";
import { toast } from "sonner";
import EmptyState from "@/components/EmptyState";
import { OperationalLoadingState } from "@/components/OperationalLoadingState";
import { PageHeader } from "@/components/PageHeader";
import { UserAvatar } from "@/components/UserAvatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";

type PublishedCrewMember = {
  assignmentId: string;
  person: { id: string; name: string; avatarUrl: string | null };
  area: string;
  role: string;
  // Null for an all-day event, which has no call time.
  callStartsAt: string | null;
  callEndsAt: string | null;
};

type PublishedEvent = {
  id: string;
  event: {
    summary: string;
    subtitle: string | null;
    startsAt: string;
    endsAt: string;
    sportCode: string | null;
    opponent: string | null;
    isHome: boolean | null;
    venue: { id: string; name: string } | null;
  };
  crew: PublishedCrewMember[];
  isFollowing: boolean;
};

function formatWindow(startsAt: string, endsAt: string) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const date = start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const startTime = start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const endTime = end.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${date}, ${startTime} - ${endTime}`;
}

function crewRole(role: string) {
  return role.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function CollaboratorSchedule({ canFollow }: { canFollow: boolean }) {
  const [events, setEvents] = useState<PublishedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [pendingFollowId, setPendingFollowId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await fetch("/api/schedule/published?limit=100");
      if (handleAuthRedirect(response) || !response.ok) {
        setError(true);
        return;
      }
      const json = await parseJsonSafely<{ data?: PublishedEvent[] }>(response);
      setEvents(json?.data ?? []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function setFollowing(event: PublishedEvent, following: boolean) {
    if (!canFollow) return;
    setPendingFollowId(event.id);
    try {
      const response = await fetch(`/api/schedule/published/${event.id}/follow`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ following }),
      });
      if (handleAuthRedirect(response)) return;
      if (!response.ok) {
        toast.error(await parseErrorMessage(response, "Could not update event notifications"));
        return;
      }
      setEvents((current) => current.map((item) => item.id === event.id ? { ...item, isFollowing: following } : item));
      toast.success(following ? "Event updates enabled" : "Event updates muted");
    } catch {
      toast.error("Could not reach the server. Your event notification setting was not changed.");
    } finally {
      setPendingFollowId(null);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Schedule"
        description="Upcoming events and crew assignments."
      />

      {loading ? (
        <OperationalLoadingState variant="page" title="Loading schedule" rows={4} />
      ) : error ? (
        <EmptyState icon="wifi-off" title="Could not load the schedule" description="Retry before relying on this event list." actionLabel="Retry" onAction={() => void load()} />
      ) : events.length === 0 ? (
        <EmptyState icon="calendar" title="No scheduled events" description="Events will appear here when crew assignments are ready." />
      ) : (
        <div className="space-y-3">
          {events.map((item) => (
            <Card key={item.id} className="shadow-xs">
              <CardHeader className="gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1.5">
                  <CardTitle className="text-base! text-balance">{item.event.summary}</CardTitle>
                  {item.event.subtitle && <p className="text-sm text-muted-foreground text-pretty">{item.event.subtitle}</p>}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5 tabular-nums"><CalendarDaysIcon className="size-4" />{formatWindow(item.event.startsAt, item.event.endsAt)}</span>
                    {item.event.venue && <span className="inline-flex items-center gap-1.5"><MapPinIcon className="size-4" />{item.event.venue.name}</span>}
                  </div>
                </div>
                {canFollow && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-10 shrink-0 active:scale-[0.96] transition-transform"
                    loading={pendingFollowId === item.id}
                    onClick={() => void setFollowing(item, !item.isFollowing)}
                  >
                    <AnimatePresence initial={false} mode="popLayout">
                      <motion.span
                        key={item.isFollowing ? "mute" : "follow"}
                        initial={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
                        animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                        exit={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
                        transition={{ type: "spring", duration: 0.3, bounce: 0 }}
                        className="inline-flex items-center justify-center"
                      >
                        {item.isFollowing ? <BellOffIcon data-icon="inline-start" /> : <BellIcon data-icon="inline-start" />}
                      </motion.span>
                    </AnimatePresence>
                    {item.isFollowing ? "Mute updates" : "Follow event"}
                  </Button>
                )}
              </CardHeader>
              <CardContent className="p-0">
                {item.crew.length === 0 ? (
                  <EmptyState inline compact icon="users" title="No scheduled crew" description="This event has no crew assignments yet." />
                ) : (
                  <div className="divide-y">
                    {item.crew.map((member) => (
                      <div key={member.assignmentId} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
                        <UserAvatar name={member.person.name} avatarUrl={member.person.avatarUrl} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{member.person.name}</p>
                          {member.role === "Student" && member.callStartsAt && member.callEndsAt ? (
                            <p className="text-xs text-muted-foreground tabular-nums">Call {formatWindow(member.callStartsAt, member.callEndsAt)}</p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                          <Badge variant="secondary" size="sm">{crewRole(member.area)}</Badge>
                          <Badge variant="outline" size="sm">{crewRole(member.role)}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
