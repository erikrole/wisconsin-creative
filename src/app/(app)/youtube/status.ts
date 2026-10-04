import type { ReviewStatus } from "@/lib/youtube/review";

export const STATUS_BADGE: Record<ReviewStatus, "orange" | "blue" | "red" | "green" | "gray"> = {
  "Needs review": "blue",
  "Needs source": "orange",
  "Needs attention": "red",
  Published: "green",
  Protected: "gray",
};
