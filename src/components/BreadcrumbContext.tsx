"use client";

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";

type BreadcrumbContextValue = {
  label: string | null;
  setBreadcrumbLabel: (label: string | null) => void;
};

const BreadcrumbContext = createContext<BreadcrumbContextValue>({
  label: null,
  setBreadcrumbLabel: () => {},
});

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // The label belongs to the path it was set on, so it drops on navigation without a reset
  // effect. A reset effect would run after a new page's own effects (parents run last) and wipe
  // a label the page set on mount.
  const [entry, setEntry] = useState<{ path: string; label: string | null } | null>(null);
  const setBreadcrumbLabel = useCallback((l: string | null) => setEntry({ path: pathname, label: l }), [pathname]);
  const label = entry?.path === pathname ? entry.label : null;

  return (
    <BreadcrumbContext.Provider value={{ label, setBreadcrumbLabel }}>
      {children}
    </BreadcrumbContext.Provider>
  );
}

export function useBreadcrumbLabel() {
  return useContext(BreadcrumbContext);
}

/**
 * Names the current page in the top bar trail from data a page already has, for routes whose URL
 * is an id or slug. Server pages can render it directly: `<BreadcrumbLabel label={guide.title} />`.
 */
export function BreadcrumbLabel({ label }: { label: string | null | undefined }) {
  const { setBreadcrumbLabel } = useBreadcrumbLabel();
  useEffect(() => {
    if (label) setBreadcrumbLabel(label);
  }, [label, setBreadcrumbLabel]);
  return null;
}
