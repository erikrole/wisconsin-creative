import { Fragment } from "react";
import { cn } from "@/lib/utils";

function valuePillClass(kind: "old" | "new") {
  return cn(
    "max-w-[14rem] truncate rounded-md px-1.5 py-0.5 tabular-nums",
    kind === "old" && "bg-[var(--red-bg)] text-[var(--red-text)] line-through",
    kind === "new" && "bg-[var(--green-bg)] font-medium text-[var(--green-text)]",
  );
}

function DiffPart({ part }: { part: string }) {
  const arrow = part.indexOf(" → ");
  if (arrow < 0) {
    return <span className="truncate">{part}</span>;
  }

  const labelEnd = part.indexOf(": ");
  const hasLabel = labelEnd > 0 && labelEnd < arrow;
  const label = hasLabel ? part.slice(0, labelEnd) : null;
  const from = hasLabel ? part.slice(labelEnd + 2, arrow) : part.slice(0, arrow);
  const to = part.slice(arrow + 3);

  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1">
      {label ? <span className="shrink-0 text-muted-foreground">{label}</span> : null}
      <span className={valuePillClass("old")} title={from}>{from}</span>
      <span className="shrink-0 text-muted-foreground/60" aria-hidden="true">→</span>
      <span className={valuePillClass("new")} title={to}>{to}</span>
    </span>
  );
}

export function ScheduleSyncDiff({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const parts = text.split(" · ").map((part) => part.trim()).filter(Boolean);
  return (
    <span className={cn("inline-flex min-w-0 max-w-full flex-wrap items-center gap-x-1.5 gap-y-1", className)}>
      {parts.map((part, index) => (
        <Fragment key={`${index}:${part}`}>
          {index > 0 ? <span className="text-muted-foreground/50" aria-hidden="true">·</span> : null}
          <DiffPart part={part} />
        </Fragment>
      ))}
    </span>
  );
}
