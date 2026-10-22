"use client";

import { useEffect } from "react";

/**
 * Dialogs, sheets and menus render in a portal on <body>, outside the layout wrapper.
 * Mirroring the wc-fresh classes onto <body> while a page is mounted keeps them in the same look.
 */
export default function FreshTheme({ classNames }: { classNames: string }) {
  useEffect(() => {
    const list = classNames.split(" ").filter(Boolean);
    document.body.classList.add(...list);
    return () => document.body.classList.remove(...list);
  }, [classNames]);
  return null;
}
