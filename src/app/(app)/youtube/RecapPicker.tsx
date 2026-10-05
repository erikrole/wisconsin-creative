"use client";

import { CheckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EXCERPT_WORDS, initialSelection, removeOpeningDateline } from "@/lib/youtube/rules";
import type { RecapDocument } from "@/lib/youtube/types";

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** Picks the sentences that become the description. Rows toggle on click; order always follows the recap. */
export function RecapPicker({ recap, selectedIds, onChange }: { recap: RecapDocument; selectedIds: string[]; onChange: (ids: string[]) => void }) {
  const selected = new Set(selectedIds);
  const openingId = recap.sentences[0]?.id;
  const chosen = recap.sentences.filter((sentence) => selected.has(sentence.id) && !sentence.isTimeSensitive);
  const words = chosen.reduce((total, sentence) => total + wordCount(sentence.id === openingId ? removeOpeningDateline(sentence.text) : sentence.text), 0);
  const toggle = (id: string) => onChange(selected.has(id) ? selectedIds.filter((other) => other !== id) : [...selectedIds, id]);
  const suggested = initialSelection(recap);
  const isSuggested = suggested.length === selectedIds.length && suggested.every((id) => selected.has(id));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="yt-mono text-xs text-muted-foreground">
          {chosen.length} {chosen.length === 1 ? "sentence" : "sentences"} · {words} words
          <span className="ml-2 inline-block h-1.5 w-20 overflow-hidden rounded-full bg-muted align-middle" aria-hidden="true">
            <span className={cn("block h-full rounded-full", words > EXCERPT_WORDS ? "bg-[var(--orange-text)]" : "bg-[var(--green-text)]")} style={{ width: `${Math.min(100, (words / EXCERPT_WORDS) * 100)}%` }} />
          </span>
        </p>
        <div className="flex gap-1">
          <Button variant="ghost" disabled={isSuggested} onClick={() => onChange(suggested)}>
            Suggested lead
          </Button>
          <Button variant="ghost" disabled={selectedIds.length === 0} onClick={() => onChange([])}>
            Clear
          </Button>
        </div>
      </div>
      <div className="flex max-h-[28rem] flex-col overflow-y-auto rounded-lg border bg-muted/20 p-1.5" role="group" aria-label="Recap sentences">
        {recap.sentences.map((sentence, index) => {
          const on = selected.has(sentence.id) && !sentence.isTimeSensitive;
          const text = sentence.id === openingId ? removeOpeningDateline(sentence.text) : sentence.text;
          const newParagraph = index > 0 && recap.sentences[index - 1]?.paragraph !== sentence.paragraph;
          return (
            <button
              key={sentence.id}
              type="button"
              role="checkbox"
              aria-checked={on}
              disabled={sentence.isTimeSensitive}
              onClick={() => toggle(sentence.id)}
              className={cn(
                "flex items-start gap-3 rounded-md px-2.5 py-2 text-left text-sm leading-relaxed transition-colors",
                newParagraph && "mt-2",
                on ? "bg-card shadow-sm ring-1 ring-border" : "text-muted-foreground hover:bg-card/60",
                sentence.isTimeSensitive && "cursor-not-allowed opacity-60",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border transition-colors",
                  on ? "border-transparent bg-[#a00000] text-white" : "border-border bg-card",
                )}
                aria-hidden="true"
              >
                {on && <CheckIcon className="size-3" />}
              </span>
              <span className={cn("min-w-0 flex-1", sentence.isTimeSensitive && "line-through")}>
                {text}
                {sentence.isTimeSensitive && <span className="yt-mono ml-2 text-[11px] tracking-wide uppercase no-underline">Time-sensitive</span>}
              </span>
              <span className="yt-mono shrink-0 pt-0.5 text-[11px] text-muted-foreground">{wordCount(text)}w</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
