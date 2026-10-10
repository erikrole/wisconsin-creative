"use client";

import { ArrowUpRight, Check, Circle, FileText, Link2, MessageSquare, Video } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { STANDING_LABELS, TERM_LABELS } from "@/lib/hiring/contract";
import { AREA_LABEL, type BoardApplication } from "./types";

type Props = {
  application: BoardApplication;
  reviewPending: boolean;
  onOpen: () => void;
  onReview: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
};

export default function ApplicantCard({ application: a, reviewPending, onOpen, onReview, onDragStart, onDragEnd }: Props) {
  const specialty = a.primaryArea ? AREA_LABEL[a.primaryArea] ?? a.primaryArea : a.rawAreas[0];
  const otherAreas = [...new Set(a.rawAreas)].filter((area) => area.toLowerCase() !== specialty?.toLowerCase());
  const linkedResume = a.sourceLinks?.some(link => link.label === "PageUp resume");
  const education = [
    a.standing ? STANDING_LABELS[a.standing] : null,
    a.gradTerm && a.gradYear ? `Graduates ${TERM_LABELS[a.gradTerm]} ${a.gradYear}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <article aria-label={a.name} className="group min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md">
      <button
        type="button"
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onClick={onOpen}
        aria-label={`Review application: ${a.name}`}
        className="block w-full p-4 text-left outline-offset-[-3px] transition-colors hover:bg-accent/30 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block break-words text-lg font-semibold leading-snug tracking-tight text-card-foreground">{a.name}</span>
            {education && <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{education}</span>}
          </span>
          <ArrowUpRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" aria-hidden />
        </span>

        {specialty && (
          <span className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <Badge variant="gray" className="max-w-full whitespace-normal text-left">{specialty}</Badge>
            {otherAreas.length > 0 && <span className="text-xs text-muted-foreground" title={otherAreas.join(", ")}>{otherAreas.slice(0, 2).join(" · ")}{otherAreas.length > 2 ? ` +${otherAreas.length - 2}` : ""}</span>}
          </span>
        )}
        {a.experienceSummary && <span className="mt-3 line-clamp-3 text-sm leading-relaxed text-card-foreground/85">{a.experienceSummary}</span>}
        <span className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
          {a.hasResume && !linkedResume && <span className="inline-flex items-center gap-1.5"><FileText className="size-3.5" aria-hidden />Resume</span>}
          {a.hasPortfolio && <span className="inline-flex items-center gap-1.5"><Link2 className="size-3.5" aria-hidden />Portfolio</span>}
          {a.hasInterview && <span className="inline-flex items-center gap-1.5"><Video className="size-3.5" aria-hidden />Interview</span>}
          {a.ratingAverage != null && <span className="inline-flex items-center gap-1.5" aria-label={`${a.ratingAverage.toFixed(1)} average rating from ${a.ratingCount} reviews`}><MessageSquare className="size-3.5" aria-hidden />{a.ratingAverage.toFixed(1)} <span>({a.ratingCount})</span></span>}
        </span>
      </button>
      <div className="flex flex-wrap items-center justify-between gap-x-2 border-t bg-muted/20 px-3 py-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-10 px-2 text-xs"
          aria-pressed={a.reviewed}
          aria-label={`${a.reviewed ? "Mark not reviewed" : "Mark reviewed"}: ${a.name}`}
          disabled={reviewPending}
          onClick={onReview}
        >
          {a.reviewed ? <Check className="size-4" aria-hidden /> : <Circle className="size-4" aria-hidden />}
          {reviewPending ? "Saving…" : a.reviewed ? "Reviewed" : "Mark reviewed"}
        </Button>
        {a.sourceLinks && a.sourceLinks.length > 0 && (
          <div className="flex flex-wrap gap-x-3 px-2">
            {a.sourceLinks.map((link) => (
              <a key={link.label} className="inline-flex min-h-10 items-center gap-1 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring" href={link.url} target="_blank" rel="noopener noreferrer" aria-label={`${link.label}: ${a.name} (opens in a new tab)`}>
                {link.label.replace(/^PageUp /, "").replace(/^./, (letter) => letter.toUpperCase())}<ArrowUpRight className="size-3" aria-hidden />
              </a>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
