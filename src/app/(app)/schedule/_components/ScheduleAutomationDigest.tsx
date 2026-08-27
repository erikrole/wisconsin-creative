import { CheckCircle2Icon, ListChecksIcon } from "lucide-react";
import { OperationalMetricCard } from "@/components/OperationalFeedback";
import type {
  ScheduleAutomationCard,
  ScheduleAutomationDigest as ScheduleAutomationDigestType,
} from "@/lib/schedule-automation-types";
import type { ScheduleQueue } from "@/lib/schedule-queues";

type ScheduleAutomationCardsProps = {
  digest: ScheduleAutomationDigestType;
  canReviewClaims: boolean;
  onShowQueue: (queue: ScheduleQueue) => void;
  onOpenTradeBoard: () => void;
  className?: string;
};

const CARD_TONE: Record<ScheduleAutomationCard["tone"], "red" | "orange" | "green" | "muted"> = {
  critical: "red",
  attention: "orange",
  good: "green",
  neutral: "muted",
};

/**
 * Presentational automation-review grid. Rendered inside the Schedule details
 * panel (staff/admin only) so review-first suggestions live in the same
 * expandable surface as the readiness metrics rather than a second banner.
 * Suggestions only - nothing here mutates staffing, publishing, trades, or
 * notifications by itself.
 */
export function ScheduleAutomationCards({
  digest,
  canReviewClaims,
  onShowQueue,
  onOpenTradeBoard,
  className,
}: ScheduleAutomationCardsProps) {
  const updatedAt = new Date(digest.generatedAt).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  const cards: ScheduleAutomationCard[] = canReviewClaims
    ? digest.cards
    : digest.cards.map((card) => {
      if (card.id !== "risk") return card;
      const { conflicts, gearGaps } = digest.metrics;
      return {
        ...card,
        value: conflicts + gearGaps,
        detail: `${conflicts} conflicts, ${gearGaps} gear gaps`,
        tone: conflicts > 0 ? "critical" : gearGaps > 0 ? "attention" : "good",
        action: conflicts > 0
          ? { label: "Review conflicts", queue: "conflicts" }
          : gearGaps > 0
            ? { label: "Review gear", queue: "gear-gaps" }
            : undefined,
        eventIds: undefined,
      };
    });

  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <ListChecksIcon className="size-4 shrink-0 text-primary" />
        <h2 className="text-sm! font-semibold!">Automation review</h2>
        <span className="text-xs text-muted-foreground">
          Suggestions only. Nothing here changes staffing, publishing, trades, or notifications by itself.
        </span>
        <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
          <CheckCircle2Icon className="size-3.5" />
          Updated {updatedAt}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((card) => {
          const action = card.action;
          const onClick = action?.queue || action?.openTradeBoard
            ? () => {
                if (action.queue) onShowQueue(action.queue);
                if (action.openTradeBoard) onOpenTradeBoard();
              }
            : undefined;
          return (
            <OperationalMetricCard
              key={card.id}
              label={card.label}
              value={card.value}
              tone={CARD_TONE[card.tone]}
              helper={card.detail}
              href={action?.href}
              onClick={onClick}
            />
          );
        })}
      </div>
    </div>
  );
}
