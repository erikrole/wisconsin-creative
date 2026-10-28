import { cn } from "@/lib/utils";

/* ══════════════════════════════════════════════
   Entrance animations for consistent motion.
   Pure CSS (see "Entrance animations" in globals.css), so they play at first
   paint instead of waiting for JavaScript, and reduced-motion users get the
   global reduced-motion rule.
   ══════════════════════════════════════════════ */

// ── Fade Up: default page content entrance ──
export function FadeUp({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <div
      className={cn("wc-enter-rise", className)}
      style={delay ? { animationDelay: `${delay}s` } : undefined}
    >
      {children}
    </div>
  );
}

// ── Stagger Container: wrap list items ──
export function StaggerList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("wc-enter-stagger", className)}>{children}</div>;
}

export function StaggerItem({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={className}>{children}</div>;
}

// ── Page Wrapper: fade-up for entire page content ──
export function PageTransition({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("wc-enter-rise wc-enter-rise-page flex flex-col flex-1", className)}>
      {children}
    </div>
  );
}

// ── Scale In: for cards, modals appearing ──
export function ScaleIn({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <div
      className={cn("wc-enter-scale", className)}
      style={delay ? { animationDelay: `${delay}s` } : undefined}
    >
      {children}
    </div>
  );
}
