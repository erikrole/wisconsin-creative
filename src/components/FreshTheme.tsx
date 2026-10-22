"use client";

import { useEffect } from "react";

/** Mirrors the wc-fresh theme onto <body> so dialogs and menus in portals match the page. */
export default function FreshTheme({ classNames }: { classNames: string }) {
  useEffect(() => {
    const list = classNames.split(" ").filter(Boolean);
    document.body.classList.add(...list);
    return () => document.body.classList.remove(...list);
  }, [classNames]);
  return null;
}
