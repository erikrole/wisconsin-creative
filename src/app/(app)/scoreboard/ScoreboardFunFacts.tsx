"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { funFactWindow, type ScoreboardFunFact } from "@/lib/scoreboard-fun-facts";

const FACTS_PER_PAGE = 4;

export function ScoreboardFunFacts({
  facts,
  onExplore,
}: {
  facts: ScoreboardFunFact[];
  onExplore: (fact: ScoreboardFunFact) => void;
}) {
  const reduced = useReducedMotion();
  const [page, setPage] = useState(0);
  if (facts.length === 0) return null;
  const visible = funFactWindow(facts, page, FACTS_PER_PAGE);
  const canShuffle = facts.length > FACTS_PER_PAGE;

  return (
    <section aria-labelledby="scoreboard-facts-title">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="scoreboard-facts-title" className="text-base font-black tracking-tight">Did you know</h2>
        {canShuffle ? (
          <Button variant="ghost" size="sm" className="h-10" onClick={() => setPage((current) => current + 1)}>
            <Shuffle className="size-3.5" aria-hidden="true" />
            More facts
          </Button>
        ) : null}
      </div>
      <ul className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-4">
        <AnimatePresence mode="popLayout" initial={false}>
          {visible.map((fact, index) => (
            <motion.li
              key={`${fact.id}-${page}`}
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
              transition={{ duration: reduced ? 0 : 0.25, delay: reduced ? 0 : index * 0.04 }}
              className="w-[70%] shrink-0 snap-start sm:w-auto"
            >
              <button
                type="button"
                disabled={!fact.action}
                onClick={() => onExplore(fact)}
                className="group flex h-full w-full flex-col rounded-xl border bg-card p-4 text-left shadow-xs transition-[border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:hover:translate-y-0 disabled:hover:border-border motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                <span className="text-xs font-bold text-[var(--accent)]">{fact.label}</span>
                <span className="brand-identity mt-1 truncate text-xl font-black tracking-tight tabular-nums">{fact.value}</span>
                <span className="mt-1 text-xs leading-relaxed text-muted-foreground">{fact.sentence}</span>
                {fact.action ? (
                  <span className="mt-auto pt-2 text-[11px] font-bold text-muted-foreground transition-colors group-hover:text-[var(--accent)]">
                    {fact.action.type === "person" ? "See them →" : "Zoom in →"}
                  </span>
                ) : null}
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </section>
  );
}
