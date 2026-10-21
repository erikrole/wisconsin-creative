"use client";

import { useEffect } from "react";

/**
 * Sheets, dialogs and menus render in a portal on <body>, outside the page wrapper.
 * Mirroring the theme classes onto <body> while Home is mounted keeps them in the same look.
 */
export default function HomeTheme({ classNames }: { classNames: string }) {
  useEffect(() => {
    const list = classNames.split(" ").filter(Boolean);
    document.body.classList.add(...list);
    return () => document.body.classList.remove(...list);
  }, [classNames]);
  return null;
}
