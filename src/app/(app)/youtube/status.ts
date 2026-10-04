import type { ReviewStatus } from "@/lib/youtube/review";

export const STATUS_BADGE: Record<ReviewStatus, "orange" | "blue" | "red" | "green" | "gray"> = {
  "Needs review": "blue",
  "Needs source": "orange",
  "Needs attention": "red",
  Published: "green",
  Protected: "gray",
};

/** The colour of the left rail on a queue row, so the list scans like a film strip. */
export const STATUS_RAIL: Record<ReviewStatus, string> = {
  "Needs review": "var(--blue-text)",
  "Needs source": "var(--orange-text)",
  "Needs attention": "var(--red-text)",
  Published: "var(--green-text)",
  Protected: "var(--muted-foreground)",
};
