"use client";

import type { ReactNode } from "react";
import { FadeUp } from "@/components/ui/motion";
import { findSettingsSection } from "@/lib/nav-sections";
import { cn } from "@/lib/utils";
import { SettingsRelatedLinks } from "./_components/SettingsRelatedLinks";

type SettingsPageShellProps = {
  href?: string;
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  related?: boolean;
  children: ReactNode;
  mainClassName?: string;
};

export function SettingsPageShell({
  href,
  title,
  description,
  actions,
  related = true,
  children,
  mainClassName,
}: SettingsPageShellProps) {
  const section = href ? findSettingsSection(href) : null;
  const resolvedTitle = title ?? section?.label ?? "";
  const resolvedDescription = description ?? section?.description;

  return (
    <FadeUp>
      <div className="flex min-w-0 flex-col gap-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 max-w-3xl">
            <h2 className="mb-1 text-balance">{resolvedTitle}</h2>
            {resolvedDescription ? (
              <p className="m-0 text-sm leading-relaxed text-muted-foreground">
                {resolvedDescription}
              </p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
        <div className={cn("min-w-0 [&_[id]]:scroll-mt-24", mainClassName)}>{children}</div>
        {related && href ? <SettingsRelatedLinks href={href} /> : null}
      </div>
    </FadeUp>
  );
}
