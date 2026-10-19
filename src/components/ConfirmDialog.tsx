"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { restoreDialogFocus } from "@/lib/a11y-resilience";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "default";
};

type ConfirmContextType = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
};

const ConfirmContext = createContext<ConfirmContextType>({
  confirm: () => Promise.resolve(false),
});

export function useConfirm() {
  return useContext(ConfirmContext).confirm;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [open, setOpen] = useState(false);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const requestRef = useRef(0);

  const confirm = useCallback((next: ConfirmOptions): Promise<boolean> => {
    const request = ++requestRef.current;
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      // Wait until a menu that opened this confirm has returned focus to its
      // trigger. Capturing the menu item itself loses focus when that item unmounts.
      requestAnimationFrame(() => {
        if (request !== requestRef.current) return;
        const active = document.activeElement;
        openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
        setOptions(next);
        setOpen(true);
      });
    });
  }, []);

  function finish(result: boolean) {
    setOpen(false);
    const resolve = resolveRef.current;
    resolveRef.current = null;
    resolve?.(result);
  }

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!next) finish(false);
        }}
      >
        {options && (
          <AlertDialogContent
            onCloseAutoFocus={(event) => {
              restoreDialogFocus(openerRef.current, event);
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>{options.title}</AlertDialogTitle>
              <AlertDialogDescription>{options.message}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => finish(false)}>
                {options.cancelLabel || "Cancel"}
              </AlertDialogCancel>
              <AlertDialogAction
                className={cn(
                  options.variant === "danger"
                    ? buttonVariants({ variant: "destructive" })
                    : buttonVariants({ variant: "default" }),
                )}
                onClick={() => finish(true)}
              >
                {options.confirmLabel || "Confirm"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}
