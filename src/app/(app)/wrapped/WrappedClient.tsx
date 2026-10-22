"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Gift, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useFetch } from "@/hooks/use-fetch";
import type { WrappedResponse } from "@/lib/services/wrapped";
import type { TeamScoreboard } from "@/lib/services/team-scoreboard";
import { WrappedPlayer, type WrappedSlide } from "./WrappedPlayer";

const ME = "__me__";

function Backdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0b0c10] p-6 text-center text-white">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute right-4 top-4 inline-flex size-10 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <X className="size-4" />
      </button>
      {children}
    </div>
  );
}

function countdownLabel(unlockAt: string, now: Date): string {
  const days = Math.ceil((new Date(unlockAt).getTime() - now.getTime()) / 86_400_000);
  if (days <= 1) return "Tomorrow";
  return `${days} days to go`;
}

function AdminBar({
  people,
  targetId,
  onTarget,
  response,
  onRegenerate,
  regenerating,
}: {
  people: { userId: string; name: string }[];
  targetId: string | null;
  onTarget: (userId: string | null) => void;
  response: Extract<WrappedResponse, { status: "ready" }> | null;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  return (
    <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-white/10 px-2 py-1.5 text-xs text-white backdrop-blur">
      <span className="pl-2 font-bold">{response?.preview ? "Preview" : "Frozen"}</span>
      <Select value={targetId ?? ME} onValueChange={(value) => onTarget(value === ME ? null : value)}>
        <SelectTrigger className="h-10 w-48 border-white/20 bg-transparent text-xs text-white" aria-label="Preview Wrapped as">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-[320px]">
          <SelectItem value={ME}>Me</SelectItem>
          {people.map((person) => (
            <SelectItem key={person.userId} value={person.userId}>{person.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {response?.frozen ? (
        <Button size="sm" variant="ghost" className="h-10 rounded-full text-white hover:bg-white/15 hover:text-white" onClick={onRegenerate} disabled={regenerating}>
          <RefreshCw className="size-3.5" aria-hidden="true" />
          Regenerate
        </Button>
      ) : null}
    </div>
  );
}

function WrappedExperience() {
  const router = useRouter();
  const params = useSearchParams();
  const targetId = params.get("userId");
  const { data: currentUser } = useCurrentUser();
  const isAdmin = currentUser?.role === "ADMIN";
  const [regenerating, setRegenerating] = useState(false);

  const url = useMemo(() => {
    const query = new URLSearchParams();
    if (targetId) query.set("userId", targetId);
    // Admins see live numbers before unlock; everyone else sees the countdown.
    if (isAdmin) query.set("preview", "1");
    const text = query.toString();
    return `/api/wrapped${text ? `?${text}` : ""}`;
  }, [isAdmin, targetId]);

  const { data, loading, error, reload } = useFetch<WrappedResponse>({
    url,
    returnTo: "/wrapped",
    refetchOnFocus: false,
    enabled: currentUser !== undefined,
  });
  const { data: scoreboard } = useFetch<TeamScoreboard>({
    url: "/api/scoreboard",
    returnTo: "/wrapped",
    refetchOnFocus: false,
    enabled: isAdmin,
  });

  const close = useCallback(() => router.push("/scoreboard"), [router]);
  const setTarget = (userId: string | null) => {
    router.replace(userId ? `/wrapped?userId=${encodeURIComponent(userId)}` : "/wrapped");
  };
  const regenerate = async () => {
    setRegenerating(true);
    try {
      const target = targetId ?? currentUser?.id;
      if (target) await fetch(`/api/wrapped?userId=${encodeURIComponent(target)}`, { method: "DELETE" });
      await reload();
    } finally {
      setRegenerating(false);
    }
  };

  if (loading || !data) {
    if (error) {
      return (
        <Backdrop onClose={close}>
          <p className="text-lg font-black">Wrapped didn&apos;t load</p>
          <p className="mt-1 text-sm text-white/70">Check your connection and try again.</p>
          <Button className="mt-5 h-10" variant="secondary" onClick={() => reload()}>Try again</Button>
        </Backdrop>
      );
    }
    return (
      <Backdrop onClose={close}>
        <Spinner className="size-6" />
        <p className="mt-3 text-sm text-white/70">Looking back at your fall…</p>
      </Backdrop>
    );
  }

  if (data.status === "locked") {
    return (
      <Backdrop onClose={close}>
        <span className="inline-flex size-16 items-center justify-center rounded-3xl bg-[#c5050c]">
          <Gift className="size-8" aria-hidden="true" />
        </span>
        <p className="mt-6 text-sm font-bold uppercase tracking-[0.14em] text-white/60">Creative Wrapped</p>
        <h1 className="mt-1 text-4xl font-black tracking-tight">Opens December 1</h1>
        <p className="mt-3 max-w-xs text-white/70">Your fall in Creative, told in cards. {countdownLabel(data.unlockAt, new Date())}.</p>
      </Backdrop>
    );
  }

  const { recap } = data;
  const slides: WrappedSlide[] = [
    ...recap.cards.map((card) => ({ card, section: "you" as const })),
    ...recap.team.map((card) => ({ card, section: "team" as const })),
  ];
  const footer = isAdmin ? (
    <AdminBar
      people={(scoreboard?.leaderboard ?? []).map((person) => ({ userId: person.userId, name: person.name }))}
      targetId={targetId}
      onTarget={setTarget}
      response={data}
      onRegenerate={regenerate}
      regenerating={regenerating}
    />
  ) : null;

  if (slides.length === 0) {
    return (
      <Backdrop onClose={close}>
        <h1 className="text-3xl font-black tracking-tight">Nothing to wrap yet</h1>
        <p className="mt-2 max-w-xs text-white/70">Once you work an event or check out gear, your story starts here.</p>
        {footer ? <div className="mt-6">{footer}</div> : null}
      </Backdrop>
    );
  }

  return (
    <WrappedPlayer
      key={`${recap.person.userId}-${recap.generatedAt}`}
      slides={slides}
      person={{ name: recap.person.name, avatarUrl: recap.person.avatarUrl }}
      onClose={close}
      footer={footer}
      shareUrl={recap.cards.some((card) => card.layout === "summary")
        ? `/api/wrapped/card${targetId ? `?userId=${encodeURIComponent(targetId)}` : ""}`
        : undefined}
    />
  );
}

export default function WrappedClient() {
  return (
    <Suspense fallback={null}>
      <WrappedExperience />
    </Suspense>
  );
}
