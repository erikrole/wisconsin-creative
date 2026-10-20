"use client";

import { createContext, useContext, useState } from "react";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { getQueryClient, getQueryPersistOptions } from "@/lib/query-client";

const AuthenticatedQueryUserContext = createContext<string | null>(null);

export function useAuthenticatedQueryUserId() {
  return useContext(AuthenticatedQueryUserContext);
}

export function QueryProvider({
  children,
  userId,
}: {
  children: React.ReactNode;
  userId: string;
}) {
  const [queryClient] = useState(() => getQueryClient());
  const [queryPersistOptions] = useState(getQueryPersistOptions);

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={queryPersistOptions}>
      <AuthenticatedQueryUserContext.Provider value={userId}>
        {children}
      </AuthenticatedQueryUserContext.Provider>
    </PersistQueryClientProvider>
  );
}
