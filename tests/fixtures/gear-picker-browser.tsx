import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { GearPicker } from "@/app/(app)/gear/GearPicker";

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
Object.assign(window, { refreshGear: () => client.refetchQueries({ queryKey: ["gear-picks", "me"] }) });
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}><GearPicker /><Toaster /></QueryClientProvider>,
);
