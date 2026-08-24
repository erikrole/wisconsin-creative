"use client";

import { useEffect } from "react";
import { KeyRound, Monitor } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { FadeUp } from "@/components/ui/motion";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFetch } from "@/hooks/use-fetch";
import { useUrlState } from "@/hooks/use-url-state";
import { PhotoMechanicLicenses } from "./PhotoMechanicLicenses";
import { SoftwareVault } from "./SoftwareVault";

type SoftwareSection = "shared-logins" | "photo-mechanic";

function parseSoftwareSection(value: string | null): SoftwareSection {
  return value === "shared-logins" ? "shared-logins" : "photo-mechanic";
}

function serializeSoftwareSection(value: SoftwareSection) {
  return value === "photo-mechanic" ? null : value;
}

export default function LicensesPage() {
  const [activeSection, setActiveSection] = useUrlState<SoftwareSection>(
    "tab",
    parseSoftwareSection,
    serializeSoftwareSection,
  );

  const {
    data: meData,
    loading: accessLoading,
    error: accessError,
    reload: reloadAccess,
  } = useFetch<{ id: string; role: string }>({
    url: "/api/me",
    transform: (json) => (json as Record<string, unknown>).user as { id: string; role: string },
    refetchOnFocus: false,
  });
  const currentUserId = meData?.id ?? null;
  const isAdmin = meData?.role === "ADMIN" || meData?.role === "STAFF";
  const isCollaborator = meData?.role === "COLLABORATOR";
  const licenseSurfaceReady = meData !== null;

  useEffect(() => {
    if (licenseSurfaceReady && isCollaborator && activeSection === "photo-mechanic") {
      setActiveSection("shared-logins");
    }
  }, [activeSection, isCollaborator, licenseSurfaceReady, setActiveSection]);

  const showPhotoMechanicTab = !licenseSurfaceReady || !isCollaborator;
  const photoMechanicDescription = "Two-device Photo Mechanic activation. Claim one slot and copy your code.";
  const sharedLoginsDescription = "Department logins for tools the team shares.";

  return (
    <FadeUp>
      <PageHeader
        title="Software"
        description={activeSection === "photo-mechanic" ? photoMechanicDescription : sharedLoginsDescription}
      />

      <Tabs value={activeSection} onValueChange={(value) => setActiveSection(value as SoftwareSection)}>
        <TabsList className="sticky top-0 z-10 overflow-x-auto bg-background/95 backdrop-blur-sm scrollbar-hide" aria-label="Software access type">
          {showPhotoMechanicTab && (
            <TabsTrigger
              value="photo-mechanic"
              className="relative shrink-0 gap-2 border-b-transparent data-[state=active]:border-b-transparent after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[var(--wi-red)] after:opacity-0 after:transition-opacity data-[state=active]:after:opacity-100"
            >
              <Monitor className="size-4" aria-hidden="true" />
              <span style={{ fontFamily: "var(--font-heading)", fontWeight: 500 }}>Photo Mechanic</span>
            </TabsTrigger>
          )}
          <TabsTrigger
            value="shared-logins"
            className="relative shrink-0 gap-2 border-b-transparent data-[state=active]:border-b-transparent after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[var(--wi-red)] after:opacity-0 after:transition-opacity data-[state=active]:after:opacity-100"
          >
            <KeyRound className="size-4" aria-hidden="true" />
            <span style={{ fontFamily: "var(--font-heading)", fontWeight: 500 }}>Shared logins</span>
          </TabsTrigger>
        </TabsList>

        {showPhotoMechanicTab && (
          <TabsContent value="photo-mechanic" className="pt-4">
            {!licenseSurfaceReady ? (
              accessError ? (
                <EmptyState
                  icon="wifi-off"
                  title="Couldn't load your Software access"
                  description="Retry to confirm which Photo Mechanic tools are available to your account."
                  actionLabel="Retry"
                  onAction={reloadAccess}
                />
              ) : (
                <div className="space-y-4" aria-label="Loading Photo Mechanic access" aria-busy={accessLoading || undefined}>
                  <Skeleton className="h-28 w-full rounded-lg" />
                  <Skeleton className="h-16 w-full rounded-lg" />
                  <Skeleton className="h-56 w-full rounded-lg" />
                </div>
              )
            ) : (
              <PhotoMechanicLicenses isAdmin={isAdmin} currentUserId={currentUserId} />
            )}
          </TabsContent>
        )}

        <TabsContent value="shared-logins" className="pt-4">
          <SoftwareVault isAdmin={isAdmin} />
        </TabsContent>
      </Tabs>
    </FadeUp>
  );
}
