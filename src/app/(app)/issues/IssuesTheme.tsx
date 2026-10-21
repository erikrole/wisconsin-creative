"use client";

import { useEffect } from "react";

/** Mirrors the page theme onto <body> so dialogs and menus in portals match it. */
export default function IssuesTheme({ classNames }: { classNames: string }) {
  useEffect(() => {
    const list = classNames.split(" ").filter(Boolean);
    document.body.classList.add(...list);
    return () => document.body.classList.remove(...list);
  }, [classNames]);
  return null;
}
