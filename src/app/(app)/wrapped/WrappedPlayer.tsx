"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { ChevronLeft, ChevronRight, Download, LayoutGrid, Pause, Play, RotateCcw, Share, X } from "lucide-react";
import type { WrappedCard } from "@/lib/wrapped/recap";
import { cn } from "@/lib/utils";
import { WRAPPED_TONES, WrappedCardView } from "./WrappedCardView";

export type WrappedSlide = { card: WrappedCard; section: "you" | "team" };

const CARD_MS = 6500;
/** A press longer than this pauses instead of navigating, like stories. */
const HOLD_MS = 220;

function StageButton({
  label,
  onClick,
  children,
  className,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      className={cn(
        "inline-flex size-10 items-center justify-center rounded-full bg-black/25 text-white backdrop-blur transition-colors hover:bg-black/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
        className,
      )}
    >
      {children}
    </button>
  );
}

async function saveOrShare(url: string, mode: "save" | "share") {
  const blob = await (await fetch(url)).blob();
  const file = new File([blob], "creative-wrapped-fall-2026.png", { type: "image/png" });
  if (mode === "share" && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: "My fall in Creative" }).catch(() => undefined);
    return;
  }
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = file.name;
  link.click();
  URL.revokeObjectURL(link.href);
}

function PillButton({
  onClick,
  children,
  variant = "light",
  disabled,
}: {
  onClick: () => void;
  children: React.ReactNode;
  variant?: "light" | "glass";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      className={cn(
        "inline-flex h-11 items-center gap-2 rounded-full px-5 text-sm font-black shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:opacity-60",
        variant === "light" ? "bg-white text-[#111318]" : "bg-white/15 text-white backdrop-blur hover:bg-white/25",
      )}
    >
      {children}
    </button>
  );
}

export function WrappedPlayer({
  slides,
  person,
  onClose,
  footer,
  initialIndex = 0,
  shareUrl,
}: {
  /** The summary card as a PNG; when set, the summary card offers save and share. */
  shareUrl?: string;
  slides: WrappedSlide[];
  initialIndex?: number;
  person: { name: string; avatarUrl: string | null };
  onClose: () => void;
  footer?: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(() => Math.max(0, Math.min(slides.length - 1, initialIndex)));
  const [direction, setDirection] = useState(1);
  const [paused, setPaused] = useState(false);
  const [holding, setHolding] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const holdTimer = useRef<number | null>(null);
  const heldRef = useRef(false);
  const last = slides.length - 1;
  const finished = index === last && elapsed >= CARD_MS;
  // Auto-advance is motion; reduced motion lets the reader set the pace. It is
  // settled after mount so the server and first client render agree.
  const [autoPlay, setAutoPlay] = useState(true);
  useEffect(() => setAutoPlay(!reduced), [reduced]);
  const running = autoPlay && !paused && !holding && !showGrid && !finished;

  const go = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(last, next));
    setDirection(clamped >= index ? 1 : -1);
    setIndex(clamped);
    setElapsed(0);
  }, [index, last]);

  useEffect(() => {
    if (!running) return;
    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const delta = now - previous;
      previous = now;
      setElapsed((value) => value + delta);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, index]);

  useEffect(() => {
    if (elapsed < CARD_MS || index >= last) return;
    go(index + 1);
  }, [elapsed, go, index, last]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") go(index + 1);
      else if (event.key === "ArrowLeft") go(index - 1);
      else if (event.key === " ") {
        event.preventDefault();
        setPaused((value) => !value);
      } else if (event.key === "Escape") {
        if (showGrid) setShowGrid(false);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, index, onClose, showGrid]);

  const onPointerDown = () => {
    heldRef.current = false;
    holdTimer.current = window.setTimeout(() => {
      heldRef.current = true;
      setHolding(true);
    }, HOLD_MS);
  };
  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    setHolding(false);
    if (heldRef.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX - bounds.left < bounds.width * 0.3) go(index - 1);
    else go(index + 1);
  };

  const slide = slides[index]!;
  const progressFor = (position: number) => {
    if (position < index) return 1;
    if (position > index) return 0;
    return autoPlay ? Math.min(1, elapsed / CARD_MS) : 1;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0b0c10] sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Creative Wrapped"
    >
      <div className="relative h-full w-full overflow-hidden sm:aspect-[9/16] sm:h-[min(88vh,820px)] sm:w-auto sm:rounded-[28px] sm:shadow-2xl">
        <div
          className="absolute inset-0 cursor-pointer select-none"
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerLeave={() => {
            if (holdTimer.current) window.clearTimeout(holdTimer.current);
            setHolding(false);
          }}
          role="group"
          aria-roledescription="slide"
          aria-label={`Card ${index + 1} of ${slides.length}`}
        >
          <AnimatePresence initial={false} custom={direction} mode="popLayout">
            <m.div
              key={`${slide.section}-${slide.card.id}`}
              className="absolute inset-0"
              custom={direction}
              initial={reduced ? { opacity: 0 } : { x: `${direction * 18}%`, opacity: 0, scale: 0.98 }}
              animate={{ x: 0, opacity: 1, scale: 1 }}
              exit={reduced ? { opacity: 0 } : { x: `${direction * -12}%`, opacity: 0, scale: 0.98 }}
              transition={{ duration: reduced ? 0.12 : 0.42, ease: [0.22, 1, 0.36, 1] }}
            >
              <WrappedCardView card={slide.card} section={slide.section} person={person} />
            </m.div>
          </AnimatePresence>
        </div>

        {/* Story chrome: progress segments, then controls. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="flex gap-1" aria-hidden="true">
            {slides.map((item, position) => (
              <div key={`${item.section}-${item.card.id}`} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/30">
                <div className="h-full rounded-full bg-white" style={{ width: `${progressFor(position) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="pointer-events-auto mt-2 flex items-center justify-between gap-2">
            <span className="rounded-full bg-black/25 px-2.5 py-1 text-xs font-bold tabular-nums text-white backdrop-blur">
              {index + 1} / {slides.length}
            </span>
            <div className="flex gap-1.5">
              {autoPlay ? (
                <StageButton label={paused ? "Play" : "Pause"} onClick={() => setPaused((value) => !value)}>
                  {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
                </StageButton>
              ) : null}
              <StageButton label="All cards" onClick={() => setShowGrid(true)}>
                <LayoutGrid className="size-4" />
              </StageButton>
              <StageButton label="Close" onClick={onClose}>
                <X className="size-4" />
              </StageButton>
            </div>
          </div>
        </div>

        {index === last || (shareUrl && slide.card.layout === "summary") ? (
          <div className="absolute inset-x-0 bottom-0 z-10 flex justify-center gap-2 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            {shareUrl && slide.card.layout === "summary" ? (
              <>
                <PillButton
                  variant="glass"
                  disabled={sharing}
                  onClick={() => {
                    setPaused(true);
                    setSharing(true);
                    void saveOrShare(shareUrl, "save").finally(() => setSharing(false));
                  }}
                >
                  <Download className="size-4" aria-hidden="true" />
                  Save image
                </PillButton>
                <PillButton
                  disabled={sharing}
                  onClick={() => {
                    setPaused(true);
                    setSharing(true);
                    void saveOrShare(shareUrl, "share").finally(() => setSharing(false));
                  }}
                >
                  <Share className="size-4" aria-hidden="true" />
                  Share
                </PillButton>
              </>
            ) : (
              <PillButton onClick={() => go(0)}>
                <RotateCcw className="size-4" aria-hidden="true" />
                Replay
              </PillButton>
            )}
          </div>
        ) : null}

        <AnimatePresence>
          {showGrid ? (
            <m.div
              className="absolute inset-0 z-20 overflow-y-auto bg-[#0b0c10]/95 p-5 pt-6 backdrop-blur"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0 : 0.2 }}
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-black text-white">All cards</h2>
                <StageButton label="Back to the story" onClick={() => setShowGrid(false)}>
                  <X className="size-4" />
                </StageButton>
              </div>
              <ul className="grid grid-cols-2 gap-3">
                {slides.map((item, position) => {
                  const tone = WRAPPED_TONES[item.card.tone];
                  return (
                    <li key={`${item.section}-${item.card.id}`}>
                      <button
                        type="button"
                        onClick={() => {
                          go(position);
                          setShowGrid(false);
                        }}
                        className={cn(
                          "flex aspect-[4/5] w-full flex-col justify-end rounded-2xl p-3.5 text-left transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none",
                          position === index && "ring-2 ring-white",
                        )}
                        style={{ background: tone.bg, color: tone.fg }}
                      >
                        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: tone.soft }}>
                          {item.section === "team" ? "Team · " : ""}{item.card.eyebrow}
                        </span>
                        <span className="mt-0.5 line-clamp-2 text-lg font-black leading-tight">{item.card.value}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </m.div>
          ) : null}
        </AnimatePresence>
      </div>

      {/* Desktop arrows sit beside the stage; phones tap the card. */}
      <div className="pointer-events-none absolute inset-y-0 left-0 right-0 hidden items-center justify-between px-6 lg:flex">
        <StageButton label="Previous card" onClick={() => go(index - 1)} className={cn("pointer-events-auto", index === 0 && "invisible")}>
          <ChevronLeft className="size-5" />
        </StageButton>
        <StageButton label="Next card" onClick={() => go(index + 1)} className={cn("pointer-events-auto", index === last && "invisible")}>
          <ChevronRight className="size-5" />
        </StageButton>
      </div>

      {footer ? <div className="absolute inset-x-0 bottom-0 hidden justify-center pb-3 sm:flex">{footer}</div> : null}

      <p className="sr-only" aria-live="polite">
        {`${slide.card.eyebrow}: ${slide.card.value}. ${slide.card.sentence}`}
      </p>
    </div>
  );
}
