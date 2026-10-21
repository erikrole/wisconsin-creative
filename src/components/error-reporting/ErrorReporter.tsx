"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { addBreadcrumb, installErrorReporting } from "@/lib/error-reporting/client";
import { routeTemplate } from "@/lib/error-reporting/grouping";

/** Starts browser error reporting and records each page change as a recent action. */
export function ErrorReporter() {
  const pathname = usePathname();

  useEffect(() => {
    installErrorReporting();
  }, []);

  useEffect(() => {
    if (pathname) addBreadcrumb("nav", routeTemplate(pathname) ?? pathname);
  }, [pathname]);

  return null;
}
