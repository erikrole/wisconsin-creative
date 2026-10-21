"use client";

import { AlertTriangleIcon, HomeIcon, LifeBuoyIcon, LogInIcon, RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

type ErrorRecoveryPanelProps = {
  title: string;
  description: string;
  reset: () => void;
  retryLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  secondaryIcon?: "home" | "login";
  digest?: string;
  /** Opens "Report a problem"; the failure itself is already reported automatically. */
  onReport?: () => void;
};

export function ErrorRecoveryPanel({
  title,
  description,
  reset,
  retryLabel = "Retry",
  secondaryHref,
  secondaryLabel,
  secondaryIcon = "home",
  digest,
  onReport,
}: ErrorRecoveryPanelProps) {
  const SecondaryIcon = secondaryIcon === "login" ? LogInIcon : HomeIcon;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 py-12 text-foreground">
      <Empty className="max-w-[520px] border-0 text-center" role="alert">
        <EmptyHeader>
          <EmptyMedia variant="icon" className="size-12 rounded-md">
            <AlertTriangleIcon className="size-6 text-destructive" aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
          {digest ? (
            <p className="text-xs text-muted-foreground">
              Error ID: <span className="font-mono">{digest}</span>
            </p>
          ) : null}
        </EmptyHeader>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" onClick={reset}>
            <RotateCcwIcon data-icon="inline-start" />
            {retryLabel}
          </Button>
          {secondaryHref && secondaryLabel ? (
            <Button asChild variant="outline">
              <a href={secondaryHref}>
                <SecondaryIcon data-icon="inline-start" />
                {secondaryLabel}
              </a>
            </Button>
          ) : null}
        </div>
        {onReport ? (
          <Button type="button" variant="link" className="text-muted-foreground" onClick={onReport}>
            <LifeBuoyIcon data-icon="inline-start" />
            Tell us what you were doing
          </Button>
        ) : null}
      </Empty>
    </main>
  );
}
