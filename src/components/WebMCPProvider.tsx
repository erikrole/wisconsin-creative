"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { type CurrentUser, useCurrentUser } from "@/hooks/use-current-user";

export default function WebMCPProvider({ initialUser }: { initialUser: CurrentUser }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: user } = useCurrentUser(initialUser);
  const pathnameRef = useRef(pathname);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (!user || !("modelContext" in document || "modelContext" in navigator)) return;

    // Only browsers that expose WebMCP download the tool definitions.
    const controller = new AbortController();
    void import("@/lib/webmcp-tools").then(({ createWebMcpTools, getWebMcpContext, registerWebMcpTools }) => {
      const context = getWebMcpContext();
      if (!context || controller.signal.aborted) return;
      const tools = createWebMcpTools({
        user,
        getPathname: () => pathnameRef.current,
        getTitle: () => document.title,
        navigate: (href) => router.push(href),
      });
      return registerWebMcpTools(context, tools, controller.signal);
    });
    return () => controller.abort();
  }, [router, user]);

  return null;
}
