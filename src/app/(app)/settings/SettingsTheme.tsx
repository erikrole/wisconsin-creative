"use client";

import { useEffect } from "react";

/**
 * Dialogs, selects and menus render in a portal on <body>, outside the layout wrapper.
 * Mirroring the theme classes onto <body> while Settings is mounted keeps them in the same look.
 */
export default function SettingsTheme({ classNames }: { classNames: string }) {
  useEffect(() => {
    const list = classNames.split(" ").filter(Boolean);
    document.body.classList.add(...list);
    return () => document.body.classList.remove(...list);
  }, [classNames]);
  return null;
}
