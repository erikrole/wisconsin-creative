import { useState } from "react";

/** True from the first time `open` is true on, so a lazy dialog loads when first needed and then stays mounted for its exit animation. */
export function useEverOpen(open: boolean) {
  const [everOpen, setEverOpen] = useState(open);
  if (open && !everOpen) setEverOpen(true);
  return everOpen;
}
