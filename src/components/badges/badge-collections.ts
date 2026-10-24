import type { ComponentType } from "react";
import { AlarmClockCheck, Handshake, PackageCheck, ScanLine, Sparkles } from "lucide-react";
import { isManualBadge } from "./badge-artwork";

/**
 * The five shelves a badge sits on, shared by a person's Badges tab and the
 * team gallery on /badges so a badge never changes shelf between the two.
 */
export type AwardCollectionKey = "gear_flow" | "reliability" | "scans" | "teamwork" | "staff_picks";

export type AwardCollectionDefinition = {
  key: AwardCollectionKey;
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  countsTowardCompletion: boolean;
};

type CollectionRoutingInput = {
  key: string;
  category: string;
  kind: string;
  trigger: string;
  source?: string | null;
};

export const awardCollectionDefinitions: AwardCollectionDefinition[] = [
  {
    key: "gear_flow",
    title: "Gear Flow",
    description: "Checkout, pickup, full-kit, and clean handoff awards.",
    icon: PackageCheck,
    countsTowardCompletion: true,
  },
  {
    key: "reliability",
    title: "Reliability",
    description: "On-time returns, clean streaks, and no-drama follow-through.",
    icon: AlarmClockCheck,
    countsTowardCompletion: true,
  },
  {
    key: "scans",
    title: "Legacy Scan Awards",
    description: "Previously earned scan awards, preserved as history.",
    icon: ScanLine,
    countsTowardCompletion: false,
  },
  {
    key: "teamwork",
    title: "Teamwork",
    description: "Trades, coverage, and event help.",
    icon: Handshake,
    countsTowardCompletion: true,
  },
  {
    key: "staff_picks",
    title: "Staff Picks",
    description: "Manual awards, inside jokes, and custom recognition.",
    icon: Sparkles,
    countsTowardCompletion: false,
  },
];

/// Every badge lives on exactly one shelf so the flat layout never repeats a
/// medallion. Staff recognition wins over thematic hints; automatic milestone
/// badges follow the checkout or shift workflow that actually earned them.
export function primaryCollectionKey(badge: CollectionRoutingInput): AwardCollectionKey {
  if (isManualBadge(badge)) return "staff_picks";
  if (badge.category === "SCAN") return "scans";

  // Route by the workflow that earns it, before falling back to category. The
  // v8 expansion filed every return and trade rule under `MILESTONE`, and the
  // old `MILESTONE` catch-all swept them onto Staff Picks -- a shelf whose own
  // description reads "manual awards, inside jokes, and custom recognition",
  // and which is excluded from the earned/total count. Eleven automatic return
  // rules and two trade rules were sitting on the staff shelf.
  if (badge.trigger === "checkout:returned") return "reliability";
  if (badge.trigger === "checkout:opened") return "gear_flow";
  if (badge.trigger === "trade:completed" || badge.trigger === "shift:completed") return "teamwork";

  if (badge.category === "CHECKOUT") return "gear_flow";
  if (badge.category === "ON_TIME" || badge.category === "STREAK") return "reliability";
  if (badge.category === "TRADE" || badge.category === "SHIFT") return "teamwork";
  if (badge.key.includes("streak") || badge.key.includes("reliable") || badge.key.includes("zero_errors")) return "reliability";
  // Whatever is left is a rule with no workflow behind it -- an app-open
  // surprise or a one-off. Those belong with the inside jokes.
  return badge.category === "MILESTONE" ? "staff_picks" : "gear_flow";
}
