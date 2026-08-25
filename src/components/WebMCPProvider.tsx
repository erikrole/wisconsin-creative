"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { type CurrentUser, useCurrentUser } from "@/hooks/use-current-user";
import {
  createWebMcpTools,
  getWebMcpContext,
  registerWebMcpTools,
} from "@/lib/webmcp-tools";

export default function WebMCPProvider({ initialUser }: { initialUser: CurrentUser }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: user } = useCurrentUser(initialUser);
  const pathnameRef = useRef(pathname);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (!user) return;
    const context = getWebMcpContext();
    if (!context) return;

    const controller = new AbortController();
    const tools = createWebMcpTools({
      user,
      getPathname: () => pathnameRef.current,
      getTitle: () => document.title,
      navigate: (href) => router.push(href),
    });

    void registerWebMcpTools(context, tools, controller.signal);
    return () => controller.abort();
  }, [router, user]);

  return null;
}
