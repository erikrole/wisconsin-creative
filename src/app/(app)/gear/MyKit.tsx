"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { handleAuthRedirect, parseJsonSafely } from "@/lib/errors";
import { formatDateShort } from "@/lib/format";
import { SIZE_NEEDED } from "@/lib/gear-picks/order";
import type { GearMyKitDto, GearMyKitPieceDto } from "@/lib/gear-picks/types";

export const GEAR_MY_KIT_QUERY_KEY = ["gear-picks", "me", "kit"] as const;

const CARD = "overflow-hidden rounded-[14px] border border-[#E8E8EC] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:border-white/10 dark:bg-card";
const SOURCE_LABEL: Record<GearMyKitPieceDto["source"], string> = {
  STANDARD_ISSUE: "Standard issue",
  CORE_KIT: "Core kit",
  STUDENT_KIT: "Student kit",
  PICK: "Your pick",
};

/** The signed-in person's own kit, null when they are not on this year's list. */
export function useMyGearKit() {
  return useQuery<GearMyKitDto | null>({
    queryKey: GEAR_MY_KIT_QUERY_KEY,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/gear-picks/me/kit", { signal });
      if (handleAuthRedirect(response)) return null;
      if (response.status === 403) return null;
      if (!response.ok) throw new Error("Could not load your kit");
      const json = await parseJsonSafely<{ data?: { kit?: GearMyKitDto | null } }>(response);
      if (!json?.data) throw new Error("Kit response was incomplete");
      return json.data.kit ?? null;
    },
    staleTime: 30_000,
  });
}

function pieceStatus(piece: GearMyKitPieceDto, kit: GearMyKitDto): { label: string; tone: "green" | "amber" | "red" | "gray" } {
  if (piece.handed) return { label: piece.handedOutAt ? `In hand · ${formatDateShort(piece.handedOutAt)}` : "In hand", tone: "green" };
  if (piece.size === SIZE_NEEDED) return { label: "Add your size", tone: "red" };
  if (kit.order.placedAt) return { label: kit.order.expectedAt ? `On order · due ${formatDateShort(kit.order.expectedAt)}` : "On order", tone: "amber" };
  return { label: "Planned", tone: "gray" };
}

const TONE = {
  green: "bg-[#E6F6EB] text-[#18794E]",
  amber: "bg-[#FFF3D6] text-[#9A6700]",
  red: "bg-[#FFE9E9] text-[#C2282F]",
  gray: "bg-[#F0F1F3] text-[#60646C] dark:bg-white/10 dark:text-muted-foreground",
} as const;

/** One headline sentence: where the whole kit stands. */
function headline(kit: GearMyKitDto, handed: number, total: number) {
  if (total > 0 && handed >= total) return "Everything is in your hands.";
  if (handed > 0) return `${handed} of ${total} pieces are in your hands.`;
  if (kit.order.placedAt) return kit.order.expectedAt ? `Ordered ${formatDateShort(kit.order.placedAt)}. Gear is expected around ${formatDateShort(kit.order.expectedAt)}.` : `Ordered ${formatDateShort(kit.order.placedAt)}. We'll tell you when it arrives.`;
  return "Your kit is planned. The order is placed in October.";
}

function KitCard({ kit }: { kit: GearMyKitDto }) {
  const total = kit.pieces.reduce((sum, piece) => sum + piece.quantity, 0);
  const handed = kit.pieces.filter((piece) => piece.handed).reduce((sum, piece) => sum + piece.quantity, 0);
  const needsSize = kit.pieces.some((piece) => piece.size === SIZE_NEEDED);
  return (
    <section aria-labelledby="gear-my-kit" className={`${CARD} mb-6`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#F0F1F3] px-5 py-4 dark:border-white/10">
        <div>
          <h2 id="gear-my-kit" className="text-lg font-extrabold tracking-[-0.02em]">My kit</h2>
          <p className="text-sm text-[#60646C] dark:text-muted-foreground">{headline(kit, handed, total)}</p>
        </div>
        <span className="font-mono text-sm font-bold" aria-label={`${handed} of ${total} in hand`}>{handed}/{total}</span>
      </div>
      {needsSize && (
        <p className="border-b border-[#F0F1F3] bg-[#FFF8F8] px-5 py-2.5 text-sm text-[#C2282F] dark:border-white/10 dark:bg-white/5" role="status">
          We need your size before your kit can be ordered. <Link href="/profile?tab=gear" className="font-bold underline underline-offset-2">Add it on your profile</Link>.
        </p>
      )}
      <ul>
        {kit.pieces.map((piece) => {
          const status = pieceStatus(piece, kit);
          return (
            <li key={`${piece.source}|${piece.sku}|${piece.size}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-[#F0F1F3] px-5 py-3 text-sm last:border-b-0 dark:border-white/10">
              <span className="min-w-0">
                <span className="font-bold">{piece.itemName}</span>
                {piece.colorLabel && <span className="ml-2 text-xs text-[#6B6F7A] dark:text-muted-foreground">{piece.colorLabel}</span>}
                <span className="block text-xs text-[#6B6F7A] dark:text-muted-foreground">
                  {SOURCE_LABEL[piece.source]} · {piece.size === SIZE_NEEDED ? "No size yet" : `Size ${piece.size}`}{piece.quantity > 1 ? ` · ×${piece.quantity}` : ""}
                </span>
              </span>
              <span className={`inline-flex min-h-7 items-center gap-1 rounded-full px-2.5 text-xs font-bold ${TONE[status.tone]}`}>
                {status.tone === "green" && <CheckIcon className="size-3.5" aria-hidden="true" />}
                {status.label}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** My kit card for the top of /gear. Renders nothing while loading, on error, or when there is no kit. */
export function MyKit() {
  const { data } = useMyGearKit();
  return data ? <KitCard kit={data} /> : null;
}

/** For people with a kit but no pick list (students): their kit, else the fallback. */
export function MyKitPage({ fallback }: { fallback: ReactNode }) {
  const { data, isLoading } = useMyGearKit();
  if (isLoading) return <Skeleton className="h-64 w-full rounded-lg" aria-label="Loading your kit" />;
  if (!data) return <>{fallback}</>;
  return <KitCard kit={data} />;
}
