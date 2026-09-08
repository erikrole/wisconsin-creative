"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { SearchIcon, XIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DebouncedSearchInputProps = Omit<
  ComponentProps<typeof Input>,
  "value" | "onChange" | "type" | "defaultValue"
> & {
  /** The committed (debounced) search value owned by the parent. */
  value: string;
  /**
   * Called with the committed value: after the debounce delay while typing,
   * immediately on clear/Escape, and immediately on Enter.
   */
  onValueChange: (value: string) => void;
  /** Debounce delay in ms. Default 250. */
  delay?: number;
  /** Class for the relative wrapper that hosts the icon and clear button. */
  containerClassName?: string;
};

/**
 * Search input that keeps keystrokes local and only commits to the parent on
 * a debounce. The parent never re-renders per keystroke, and because the
 * parent's committed value only changes on commit, downstream lists/tables
 * re-render once per settled query instead of once per character.
 *
 * External changes to `value` (clear-all filters, browser navigation, URL
 * rehydration) are adopted into the field and cancel any pending commit.
 */
export const DebouncedSearchInput = forwardRef<HTMLInputElement, DebouncedSearchInputProps>(
  function DebouncedSearchInput(
    { value, onValueChange, delay = 250, className, containerClassName, ...inputProps },
    forwardedRef,
  ) {
    const [text, setText] = useState(value);
    const inputRef = useRef<HTMLInputElement>(null);
    useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement);

    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastCommittedRef = useRef(value);
    const onValueChangeRef = useRef(onValueChange);
    onValueChangeRef.current = onValueChange;

    const cancelPending = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const commit = (next: string) => {
      cancelPending();
      if (lastCommittedRef.current === next) return;
      lastCommittedRef.current = next;
      onValueChangeRef.current(next);
    };

    // Adopt external value changes (clear-all, back/forward nav, URL load).
    // A value the parent echoes back from our own commit is a no-op.
    useEffect(() => {
      if (value === lastCommittedRef.current) return;
      lastCommittedRef.current = value;
      cancelPending();
      setText(value);
    }, [value]);

    useEffect(() => cancelPending, []);

    const handleChange = (next: string) => {
      setText(next);
      cancelPending();
      if (next === "") {
        // Clearing should feel instant, not debounced.
        commit(next);
        return;
      }
      timerRef.current = setTimeout(() => commit(next), delay);
    };

    const handleClear = () => {
      setText("");
      commit("");
      inputRef.current?.focus();
    };

    return (
      <div className={cn("relative", containerClassName)}>
        <Input
          {...inputProps}
          ref={inputRef}
          type="text"
          className={cn("peer h-10 pl-9 pr-9", className)}
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commit(text);
            } else if (e.key === "Escape" && text) {
              // Clear before any page-level Escape handler blurs the field so
              // the committed state can never lag behind what the user sees.
              e.stopPropagation();
              handleClear();
            }
            inputProps.onKeyDown?.(e);
          }}
        />
        <div className="text-muted-foreground/80 pointer-events-none absolute inset-y-0 left-0 flex items-center justify-center pl-3 peer-disabled:opacity-50">
          <SearchIcon size={16} />
        </div>
        {text && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute inset-y-0 right-0 my-auto size-10 text-muted-foreground/80 hover:text-foreground"
            onClick={handleClear}
            aria-label="Clear search"
          >
            <XIcon size={14} />
          </Button>
        )}
      </div>
    );
  },
);
