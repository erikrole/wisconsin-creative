import type { ReactNode } from "react";

export type ToastType = "default" | "success" | "error" | "info" | "warning";

export type ToastOptions = {
  description?: string;
  /** Milliseconds on screen; the Toaster default applies when omitted. */
  duration?: number;
  action?: { label: string; onClick: () => void | Promise<void> };
};

export type ToastItem = ToastOptions & { id: number; type: ToastType; message: ReactNode };

const MAX_VISIBLE = 3;
let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function add(type: ToastType, message: ReactNode, options: ToastOptions = {}) {
  const id = nextId++;
  items = [...items, { ...options, id, type, message }].slice(-MAX_VISIBLE);
  emit();
  return id;
}

/** Same call shape as the sonner API this replaced: toast.success("Saved", { description }). */
export const toast = Object.assign((message: ReactNode, options?: ToastOptions) => add("default", message, options), {
  success: (message: ReactNode, options?: ToastOptions) => add("success", message, options),
  error: (message: ReactNode, options?: ToastOptions) => add("error", message, options),
  info: (message: ReactNode, options?: ToastOptions) => add("info", message, options),
  warning: (message: ReactNode, options?: ToastOptions) => add("warning", message, options),
  message: (message: ReactNode, options?: ToastOptions) => add("default", message, options),
  dismiss: (id?: number) => {
    items = id === undefined ? [] : items.filter((item) => item.id !== id);
    emit();
  },
});

export function subscribeToasts(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getToasts() {
  return items;
}
