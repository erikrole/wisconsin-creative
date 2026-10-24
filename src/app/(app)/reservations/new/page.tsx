"use client";

import { Suspense } from "react";
import { BookingWizard } from "@/components/booking-wizard/BookingWizard";
import { useHydrated } from "@/hooks/use-hydrated";
import { Skeleton } from "@/components/ui/skeleton";

function WizardSkeleton() {
  return (
    <div className="mx-auto max-w-4xl flex flex-col gap-6 px-4 py-8 md:py-12">
      <div className="flex flex-col items-center gap-3">
        <Skeleton className="h-5 w-24 rounded-full" />
        <Skeleton className="h-9 w-72" />
      </div>
      <div className="flex justify-center gap-2">
        <Skeleton className="h-8 w-24 rounded-full" />
        <Skeleton className="h-8 w-24 rounded-full" />
        <Skeleton className="h-8 w-24 rounded-full" />
      </div>
      <div className="mt-8 flex flex-col gap-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  );
}

export default function NewReservationPage() {
  // The wizard seeds start and end from the device clock, which differs from the server (UTC).
  const hydrated = useHydrated();
  return (
    <Suspense fallback={<WizardSkeleton />}>
      {hydrated ? <BookingWizard /> : <WizardSkeleton />}
    </Suspense>
  );
}
