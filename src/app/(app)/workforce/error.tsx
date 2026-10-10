"use client";
import EmptyState from "@/components/EmptyState";

export default function WorkforceError({ reset }: { reset: () => void }) {
  return <EmptyState title="Could not load Workforce" description="Your saved team records are unchanged. Try loading the page again." actionLabel="Try again" onAction={reset} />;
}
