"use client";

import { Suspense } from "react";
import { MotionProvider } from "@/components/MotionProvider";
import { useSearchParams } from "next/navigation";
import { WrappedPlayer, type WrappedSlide } from "../(app)/wrapped/WrappedPlayer";
import { WRAPPED_SCENARIOS, wrappedScenario, type WrappedScenario } from "@/lib/wrapped/stress-fixtures";

function Lab() {
  const params = useSearchParams();
  const requested = params.get("s");
  const scenario: WrappedScenario = WRAPPED_SCENARIOS.find((name) => name === requested) ?? "huge";
  const recap = wrappedScenario(scenario);
  const slides: WrappedSlide[] = [
    ...recap.cards.map((card) => ({ card, section: "you" as const })),
    ...recap.team.map((card) => ({ card, section: "team" as const })),
  ];
  if (slides.length === 0) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-[#0b0c10] p-6 text-center text-white">
        <h1 className="text-3xl font-black tracking-tight">Nothing to wrap yet</h1>
        <p className="mt-2 max-w-xs text-white/70">Once you work an event or check out gear, your story starts here.</p>
      </div>
    );
  }
  return (
    <MotionProvider>
      <WrappedPlayer key={scenario} slides={slides} person={{ name: recap.person.name, avatarUrl: null }} onClose={() => undefined} />
    </MotionProvider>
  );
}

export default function WrappedLab() {
  return (
    <Suspense fallback={null}>
      <Lab />
    </Suspense>
  );
}
