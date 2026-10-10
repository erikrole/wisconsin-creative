import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import HiringClient from "./HiringClient";

export const metadata = { title: "Hiring" };

/** Admin-only via the Workforce layout (D-065). */
export default function HiringPage() {
  return <Suspense fallback={<Skeleton className="h-64 w-full" />}><HiringClient /></Suspense>;
}
