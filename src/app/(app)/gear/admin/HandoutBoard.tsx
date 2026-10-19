"use client";

import { useMemo, useState } from "react";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GEAR_CATALOG } from "@/lib/gear-picks/catalog";
import { buildHandoutBoard, type HandoutPerson } from "@/lib/gear-picks/handout";
import type { GearPickAdminParticipant, GearPickAdminStudent, GearPickHandoutDto } from "@/lib/gear-picks/types";
import { SOURCE } from "./OrderPlan";

type Change = {
  action: "setHandout";
  userId: string;
  handed: boolean;
  pieces: { sku: string; size: string; source: GearPickHandoutDto["source"]; quantity: number }[];
};

type Props = {
  participants: GearPickAdminParticipant[];
  students: GearPickAdminStudent[];
  handouts: GearPickHandoutDto[];
  pending: boolean;
  onApply: (change: Change, success: string) => Promise<boolean>;
};

const CARD = "overflow-hidden rounded-[14px] border border-[#E8E8EC] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:border-white/10 dark:bg-card";
const STATUS = {
  NONE: { label: "Not started", className: "text-[#60646C] dark:text-muted-foreground" },
  PARTIAL: { label: "In progress", className: "text-[#AB6400]" },
  DONE: { label: "Done", className: "text-[#218358]" },
} as const;

/** Who is owed what and what has been handed over. Tap a person, then tap a piece as it leaves the room. */
export function HandoutBoard({ participants, students, handouts, pending, onApply }: Props) {
  const people = useMemo(() => buildHandoutBoard(participants, students, handouts, GEAR_CATALOG.kits), [participants, students, handouts]);
  const [filter, setFilter] = useState<"all" | "outstanding" | "done">("outstanding");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const total = people.reduce((sum, person) => sum + person.totalCount, 0);
  const handed = people.reduce((sum, person) => sum + person.handedCount, 0);
  const doneCount = people.filter((person) => person.status === "DONE").length;
  const needle = query.trim().toLowerCase();
  const shown = people.filter(
    (person) =>
      (filter === "all" || (filter === "done" ? person.status === "DONE" : person.status !== "DONE")) &&
      (!needle || person.name.toLowerCase().includes(needle)),
  );
  const percent = total === 0 ? 0 : Math.round((handed / total) * 100);

  return (
    <section aria-labelledby="gear-admin-handout" className="mb-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 id="gear-admin-handout" className="text-[22px] font-extrabold tracking-[-0.03em]">Handout</h2>
        <span className="text-sm text-[#60646C] dark:text-muted-foreground">
          {handed} of {total} pieces · {doneCount} of {people.length} people done
        </span>
      </div>
      <div className="mb-3 h-2 overflow-hidden rounded-full bg-[#F0F1F3] dark:bg-white/10" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Pieces handed out">
        <div className="h-full rounded-full bg-[#12A594]" style={{ width: `${percent}%` }} />
      </div>
      {people.length === 0 ? (
        <div className={`${CARD} px-5 py-8 text-center text-sm text-[#60646C] dark:text-muted-foreground`}>
          Nobody to hand gear to yet. Add staff and students on the People tab.
        </div>
      ) : (
        <>
          <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Input
              type="search"
              aria-label="Search people"
              placeholder="Search people"
              className="min-h-10 sm:max-w-xs"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="flex gap-0.5 rounded-[10px] bg-[#F0F1F3] p-[3px] dark:bg-white/10" role="group" aria-label="Filter people">
              {([["outstanding", `Outstanding ${people.length - doneCount}`], ["done", `Done ${doneCount}`], ["all", `All ${people.length}`]] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={filter === key}
                  onClick={() => setFilter(key)}
                  className={`min-h-9 rounded-lg px-3 py-1.5 text-[13px] font-bold ${filter === key ? "bg-white shadow-[0_1px_2px_rgba(0,0,0,0.08)] dark:bg-card" : "text-[#60646C] dark:text-muted-foreground"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <ul className={CARD}>
            {shown.length === 0 && (
              <li className="px-5 py-6 text-center text-sm text-[#60646C] dark:text-muted-foreground">
                {needle ? "Nobody matches that search." : filter === "done" ? "Nobody is done yet." : "Everyone has their gear."}
              </li>
            )}
            {shown.map((person) => (
              <PersonRow key={person.userId} person={person} open={openId === person.userId} pending={pending} onToggle={() => setOpenId(openId === person.userId ? null : person.userId)} onApply={onApply} />
            ))}
          </ul>
        </>
      )}
      <p className="mt-2 text-xs text-[#8B8D98]">Pieces are listed from each person’s kit and picks. A piece with no size on file can’t be handed out until the size is added.</p>
    </section>
  );
}

function PersonRow({ person, open, pending, onToggle, onApply }: { person: HandoutPerson; open: boolean; pending: boolean; onToggle: () => void; onApply: Props["onApply"] }) {
  const status = STATUS[person.status];
  const remaining = person.pieces.filter((piece) => !piece.handed && !piece.blocked);
  const toChange = (pieces: HandoutPerson["pieces"], handedFlag: boolean): Change => ({
    action: "setHandout",
    userId: person.userId,
    handed: handedFlag,
    pieces: pieces.map((piece) => ({ sku: piece.sku, size: piece.size, source: piece.source, quantity: piece.quantity })),
  });

  return (
    <li className="border-b border-[#F0F1F3] last:border-b-0 dark:border-white/10">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex min-h-14 w-full items-center gap-3 px-5 py-3 text-left hover:bg-[#FAFAFC] dark:hover:bg-white/5"
      >
        <span className="min-w-0 flex-1">
          <span className="font-bold">{person.name}</span>
          <span className="ml-2 text-xs text-[#8B8D98]">{person.group}</span>
        </span>
        <span className="font-mono text-xs text-[#60646C] dark:text-muted-foreground">{person.handedCount} / {person.totalCount}</span>
        <span className={`w-24 text-right text-xs font-bold ${status.className}`}>{status.label}</span>
        <ChevronDownIcon aria-hidden className={`size-4 shrink-0 text-[#8B8D98] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-[#F0F1F3] bg-[#FAFAFB] px-5 py-3 dark:border-white/10 dark:bg-white/5">
          <ul className="space-y-1.5">
            {person.pieces.map((piece) => (
              <li key={piece.key} className="flex items-center gap-3 text-sm">
                <Button
                  type="button"
                  variant={piece.handed ? "default" : "outline"}
                  className="min-h-10 min-w-10 px-0"
                  disabled={pending || piece.blocked}
                  aria-pressed={piece.handed}
                  aria-label={`${piece.handed ? "Undo hand out of" : "Hand out"} ${piece.itemName} ${piece.size}`}
                  onClick={() => void onApply(toChange([piece], !piece.handed), piece.handed ? `${piece.itemName} marked not handed out.` : `${piece.itemName} handed to ${person.name}.`)}
                >
                  {piece.handed && <CheckIcon className="size-4" />}
                </Button>
                <span className="min-w-0 flex-1">
                  <span className={`font-medium ${piece.handed ? "text-[#8B8D98] line-through" : ""}`}>{piece.itemName}</span>
                  {piece.colorLabel && <span className="ml-2 text-xs text-[#8B8D98]">{piece.colorLabel}</span>}
                  {piece.quantity > 1 && <span className="ml-2 font-mono text-xs">× {piece.quantity}</span>}
                </span>
                <span className={`rounded-md px-1.5 py-0.5 font-mono text-xs ${piece.blocked ? "border border-dashed border-[#E5B84A] bg-[#FFFBEA] text-[#AB6400]" : "bg-[#F0F1F3] dark:bg-white/10"}`}>{piece.size}</span>
                <span className={`hidden rounded-md px-2 py-0.5 text-xs font-bold sm:inline ${SOURCE[piece.source].className}`}>{SOURCE[piece.source].label}</span>
              </li>
            ))}
          </ul>
          {remaining.length > 0 && (
            <div className="mt-3 flex justify-end">
              <Button className="min-h-10" disabled={pending} onClick={() => void onApply(toChange(remaining, true), `Everything handed to ${person.name}.`)}>
                Hand out everything left ({remaining.length})
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
