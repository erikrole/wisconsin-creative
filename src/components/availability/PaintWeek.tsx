"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { WEEK_DAYS, formatClockTime } from "@/lib/unavailable-times";

const FIRST_MINUTE = 7 * 60;
const SLOTS = 30; // 7 AM to 10 PM in half hours

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const toMinutes = (value: string) => {
  const [h = 0, m = 0] = value.split(":").map(Number);
  return h * 60 + m;
};

// A little paint roller, hot spot on the roller itself.
const ROLLER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#c5050c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="6" x="2" y="2" rx="2" fill="#fff"/><path d="M10 16v-2a2 2 0 0 1 2-2h8a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect width="4" height="6" x="8" y="16" rx="1" fill="#fff"/></svg>',
)}") 4 6, crosshair`;

type Props = {
  days: number[];
  startsAt: string;
  endsAt: string;
  onPaint: (next: { days: number[]; startsAt: string; endsAt: string }) => void;
};

/**
 * Drag across the week to paint the days and hours, like the old WhenToWork
 * roller. It only fills in the form's days and times; the form still saves them.
 */
export function PaintWeek({ days, startsAt, endsAt, onPaint }: Props) {
  const anchor = useRef<{ col: number; slot: number } | null>(null);
  const [painting, setPainting] = useState(false);
  const from = Math.floor((toMinutes(startsAt) - FIRST_MINUTE) / 30);
  const to = Math.ceil((toMinutes(endsAt) - FIRST_MINUTE) / 30);

  function paintTo(col: number, slot: number) {
    const a = anchor.current;
    if (!a) return;
    const [c1, c2] = [Math.min(a.col, col), Math.max(a.col, col)];
    const [s1, s2] = [Math.min(a.slot, slot), Math.max(a.slot, slot)];
    onPaint({
      days: WEEK_DAYS.slice(c1, c2 + 1).map((d) => d.day),
      startsAt: hhmm(FIRST_MINUTE + s1 * 30),
      endsAt: hhmm(FIRST_MINUTE + (s2 + 1) * 30),
    });
  }

  function cellAt(e: React.PointerEvent) {
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const cell = el?.closest<HTMLElement>("[data-col]");
    return cell ? { col: Number(cell.dataset.col), slot: Number(cell.dataset.slot) } : null;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[2.5rem_repeat(7,1fr)] gap-x-0.5 text-center text-xs font-bold text-[var(--text-secondary)]" aria-hidden="true">
        <span />
        {WEEK_DAYS.map((d) => (
          <span key={d.day}>{d.short}</span>
        ))}
      </div>
      <div
        aria-hidden="true"
        className="max-h-64 touch-none select-none overflow-y-auto rounded-xl border border-[var(--border)] bg-card p-1"
        style={{ cursor: ROLLER_CURSOR }}
        onPointerDown={(e) => {
          const cell = cellAt(e);
          if (!cell) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          anchor.current = cell;
          setPainting(true);
          paintTo(cell.col, cell.slot);
        }}
        onPointerMove={(e) => {
          if (!painting) return;
          const cell = cellAt(e);
          if (cell) paintTo(cell.col, cell.slot);
        }}
        onPointerUp={() => {
          anchor.current = null;
          setPainting(false);
        }}
        onPointerCancel={() => {
          anchor.current = null;
          setPainting(false);
        }}
      >
        <div className="grid grid-cols-[2.5rem_repeat(7,1fr)] gap-x-0.5">
          {Array.from({ length: SLOTS }, (_, slot) => (
            <div key={slot} className="contents">
              <span className="-mt-1.5 pr-1.5 text-right text-[10px] leading-4 text-[var(--text-muted)] tabular-nums">
                {slot % 2 === 0 ? formatClockTime(hhmm(FIRST_MINUTE + slot * 30)).replace(":00", "") : ""}
              </span>
              {WEEK_DAYS.map((d, col) => {
                const on = days.includes(d.day) && slot >= from && slot < to;
                return (
                  <span
                    key={d.day}
                    data-col={col}
                    data-slot={slot}
                    className={cn(
                      "h-4 border-t transition-colors duration-150",
                      slot % 2 === 0 ? "border-[var(--border)]" : "border-transparent",
                      on ? "bg-[var(--accent)]/80" : "hover:bg-[var(--bg-surface)]",
                    )}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
