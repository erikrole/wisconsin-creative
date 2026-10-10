"use client";

import { motion, type Variants } from "motion/react";
import { cn } from "@/lib/utils";

/* ══════════════════════════════════════════════
   Motion primitives for consistent animations.
   Import these instead of raw motion components.
   ══════════════════════════════════════════════ */

// ── Spring tokens: shared timing for movement that follows the user ──
// Pass through `springTransition(reduced)` so reduced-motion users get an
// instant move instead of a spring.
export const springs = {
  fast: { type: "spring", stiffness: 600, damping: 40, mass: 0.8 },
  moderate: { type: "spring", stiffness: 400, damping: 36, mass: 1 },
  slow: { type: "spring", stiffness: 250, damping: 32, mass: 1 },
} as const;

export function springTransition(
  reduced: boolean | null,
  spring: keyof typeof springs = "fast",
) {
  return reduced ? ({ duration: 0 } as const) : springs[spring];
}

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
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ── Stagger Container: wrap list items ──
const staggerContainer: Variants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.05,
    },
  },
};

const staggerItem: Variants = {
  hidden: { opacity: 0, y: 4 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.15, ease: [0.16, 1, 0.3, 1] },
  },
};

export function StaggerList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="show"
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div variants={staggerItem} className={className}>
      {children}
    </motion.div>
  );
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
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className={cn("flex flex-col flex-1", className)}
    >
      {children}
    </motion.div>
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
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{
        duration: 0.2,
        delay,
        ease: [0.16, 1, 0.3, 1],
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

