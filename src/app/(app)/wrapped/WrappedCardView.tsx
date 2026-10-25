"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { UserAvatar } from "@/components/UserAvatar";
import type { WrappedCard, WrappedTone } from "@/lib/wrapped/recap";
import { formatCount } from "@/lib/wrapped/format";
import { cn } from "@/lib/utils";

/** Each tone is one bold field with one readable ink, so every card is an event. */
export const WRAPPED_TONES: Record<WrappedTone, { bg: string; fg: string; soft: string; glow: string }> = {
  red: { bg: "#c5050c", fg: "#ffffff", soft: "rgba(255,255,255,0.72)", glow: "#ff6b5e" },
  blue: { bg: "#3e63dd", fg: "#ffffff", soft: "rgba(255,255,255,0.74)", glow: "#8fb0ff" },
  green: { bg: "#17784b", fg: "#ffffff", soft: "rgba(255,255,255,0.74)", glow: "#5fd49a" },
  gold: { bg: "#f6c945", fg: "#2b1d00", soft: "rgba(43,29,0,0.7)", glow: "#fff1b8" },
  violet: { bg: "#6e56cf", fg: "#ffffff", soft: "rgba(255,255,255,0.74)", glow: "#b9a8ff" },
  ink: { bg: "#111318", fg: "#ffffff", soft: "rgba(255,255,255,0.66)", glow: "#3e63dd" },
};

/** Counts from zero each time a card appears; reduced motion shows the number. */
function useRollIn(target: number | undefined, durationMs = 900): number | undefined {
  const reduced = useReducedMotion();
  // Start from zero on server and client alike; the effect settles it.
  const [value, setValue] = useState(() => (target === undefined ? undefined : 0));
  useEffect(() => {
    if (target === undefined || reduced) {
      setValue(target);
      return;
    }
    let frame = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / durationMs);
      setValue(Math.round(target * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs, reduced]);
  return value;
}

function Rise({ delay = 0, children, className }: { delay?: number; children: React.ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduced ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduced ? 0 : 0.45, delay: reduced ? 0 : delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

function BigValue({ card }: { card: WrappedCard }) {
  const rolled = useRollIn(card.countTo);
  const text = card.countTo !== undefined && rolled !== undefined
    ? card.value.replace(formatCount(card.countTo), formatCount(rolled))
    : card.value;
  // A bare number gets the poster size; words step down so they wrap less.
  const numeric = /^[\d–.,%]+$/.test(card.value);
  const size = numeric
    ? "text-[5.5rem] sm:text-[6.5rem]"
    : card.value.length <= 12 ? "text-[3.5rem] sm:text-6xl" : "text-[2.5rem] sm:text-5xl";
  return (
    <p
      // Size first: tailwind-merge drops a leading that comes before a font size.
      className={cn("font-black tracking-tight tabular-nums", size, "leading-[0.95]")}
      aria-label={card.value}
    >
      {text}
    </p>
  );
}

export function WrappedCardView({
  card,
  section,
  person,
  className,
}: {
  card: WrappedCard;
  /** "you" for the personal story, "team" for the shared recap. */
  section: "you" | "team";
  person: { name: string; avatarUrl: string | null };
  className?: string;
}) {
  const tone = WRAPPED_TONES[card.tone];
  const reduced = useReducedMotion();

  return (
    <div
      className={cn("relative flex h-full w-full flex-col overflow-hidden p-7 sm:p-9", className)}
      style={{ background: tone.bg, color: tone.fg }}
      data-wrapped-card={card.id}
    >
      {/* One soft shape per card: enough to feel like a moment, not a poster. */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full opacity-40 blur-2xl"
        style={{ background: tone.glow }}
        initial={reduced ? false : { scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 0.4 }}
        transition={{ duration: reduced ? 0 : 1.1, ease: [0.22, 1, 0.36, 1] }}
      />
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 -left-20 size-80 rounded-full opacity-25 blur-3xl"
        style={{ background: tone.glow }}
        initial={reduced ? false : { scale: 0.7 }}
        animate={{ scale: 1 }}
        transition={{ duration: reduced ? 0 : 1.4, ease: [0.22, 1, 0.36, 1] }}
      />

      <div className="relative mt-8 flex flex-1 flex-col">
        <Rise>
          <p className="text-sm font-bold uppercase tracking-[0.14em]" style={{ color: tone.soft }}>
            {section === "team" && card.layout !== "summary" ? "The team · " : ""}{card.eyebrow}
          </p>
        </Rise>

        {card.layout === "cover" ? (
          <div className="flex flex-1 flex-col justify-center gap-6">
            <Rise delay={0.08}>
              <UserAvatar name={person.name} avatarUrl={person.avatarUrl} size="lg" className="size-24 text-2xl ring-4 ring-white/30" />
            </Rise>
            <Rise delay={0.16}>
              <p className="text-[3.5rem] font-black leading-[0.95] tracking-tight sm:text-6xl" role="heading" aria-level={1}>{card.value}</p>
            </Rise>
            <Rise delay={0.28}>
              <p className="max-w-xs text-xl font-bold leading-snug" style={{ color: tone.soft }}>{card.sentence}</p>
            </Rise>
          </div>
        ) : card.layout === "summary" ? (
          <div className="flex flex-1 flex-col justify-center">
            <Rise delay={0.08} className="rounded-3xl bg-white p-6 text-[#111318] shadow-2xl">
              <div className="flex items-center gap-3">
                <UserAvatar name={person.name} avatarUrl={person.avatarUrl} size="md" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-black">{person.name}</p>
                  <p className="text-xs text-[#5b616e]">Creative Wrapped · Fall 2026</p>
                </div>
              </div>
              <p className="mt-5 text-xs font-bold uppercase tracking-[0.14em] text-[#5b616e]">My style</p>
              <p className="text-3xl font-black tracking-tight text-[#c5050c]">{card.value}</p>
              <dl className="mt-5 grid grid-cols-2 gap-2.5">
                {(card.items ?? []).map((item) => (
                  <div key={item.label} className="rounded-2xl bg-[#f3f4f6] px-3.5 py-3">
                    <dd className="line-clamp-2 break-words text-xl font-black leading-tight tabular-nums tracking-tight">{item.value}</dd>
                    <dt className="text-xs text-[#5b616e]">{item.label}</dt>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-center text-[11px] text-[#5b616e]">{card.sentence}</p>
            </Rise>
          </div>
        ) : (
          <div className="flex flex-1 flex-col justify-center gap-5">
            <Rise delay={0.1}>
              <BigValue card={card} />
            </Rise>
            <Rise delay={0.22}>
              <p className="max-w-sm text-xl font-bold leading-snug">{card.sentence}</p>
            </Rise>
            {card.items && card.items.length > 0 ? (
              <Rise delay={0.34}>
                {card.layout === "people" ? (
                  <ul className="flex flex-col gap-3">
                    {card.items.map((item) => (
                      <li key={item.label} className="flex items-center gap-3">
                        <UserAvatar name={item.label} avatarUrl={item.avatarUrl ?? null} size="md" className="ring-2 ring-white/40" />
                        <span className="min-w-0 flex-1 truncate font-bold">{item.label}</span>
                        <span className="shrink-0 text-sm tabular-nums" style={{ color: tone.soft }}>{item.value}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <ul className="flex flex-col gap-2.5">
                    {card.items.map((item, index) => (
                      <li key={item.label}>
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span style={{ color: tone.soft }}>{item.label}</span>
                          <span className="truncate text-right font-black tabular-nums">{item.value}</span>
                        </div>
                        {item.share !== undefined ? (
                          <div className="mt-1.5 h-2 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.22)" }} aria-hidden="true">
                            <motion.div
                              className="h-full rounded-full"
                              style={{ background: tone.fg }}
                              initial={reduced ? false : { width: 0 }}
                              animate={{ width: `${Math.max(item.share * 100, 6)}%` }}
                              transition={{ duration: reduced ? 0 : 0.7, delay: reduced ? 0 : 0.4 + index * 0.08, ease: [0.22, 1, 0.36, 1] }}
                            />
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Rise>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
