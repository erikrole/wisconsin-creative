const THEME_STORAGE_KEY = "theme";
const THEME_CHANGE_EVENT = "gear-tracker:theme-change";

export const THEME_CHOICES = ["light", "dark", "system"] as const;

export type ThemeChoice = (typeof THEME_CHOICES)[number];
type ResolvedTheme = "light" | "dark";

type ThemeTransition = {
  finished?: Promise<void>;
};

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => ThemeTransition;
};

type ApplyThemeOptions = {
  animate?: boolean;
};

let fallbackTransitionTimer: number | null = null;

function isThemeChoice(value: string | null): value is ThemeChoice {
  return value === "system" || value === "light" || value === "dark";
}

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function setRootTheme(choice: ThemeChoice) {
  document.documentElement.setAttribute(
    "data-theme",
    choice === "system" ? getSystemTheme() : choice
  );
}

function clearTransitionClasses() {
  const root = document.documentElement;
  root.classList.remove("theme-transitioning", "theme-view-transitioning");
  if (fallbackTransitionTimer) {
    window.clearTimeout(fallbackTransitionTimer);
    fallbackTransitionTimer = null;
  }
}

function applyWithFallbackTransition(choice: ThemeChoice) {
  const root = document.documentElement;
  clearTransitionClasses();
  root.classList.add("theme-transitioning");
  root.getBoundingClientRect();
  setRootTheme(choice);
  fallbackTransitionTimer = window.setTimeout(clearTransitionClasses, 240);
}

function applyWithViewTransition(
  choice: ThemeChoice,
  startViewTransition: NonNullable<ViewTransitionDocument["startViewTransition"]>
) {
  const root = document.documentElement;
  clearTransitionClasses();
  root.classList.add("theme-view-transitioning");

  const transition = startViewTransition(() => {
    setRootTheme(choice);
  });

  transition.finished?.finally(clearTransitionClasses).catch(clearTransitionClasses);
}

export function readStoredThemeChoice(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeChoice(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

function writeStoredThemeChoice(choice: ThemeChoice) {
  try {
    if (choice === "system") {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, choice);
    }
  } catch {
    /* localStorage can be unavailable in private browsing or locked contexts. */
  }
}

export function applyThemeChoice(choice: ThemeChoice, options: ApplyThemeOptions = {}) {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const doc = document as ViewTransitionDocument;
  const shouldAnimate = options.animate && !prefersReducedMotion();

  if (!shouldAnimate) {
    clearTransitionClasses();
    setRootTheme(choice);
    return;
  }

  if (doc.startViewTransition) {
    applyWithViewTransition(choice, doc.startViewTransition.bind(doc));
    return;
  }

  applyWithFallbackTransition(choice);
}

export function setThemeChoice(choice: ThemeChoice, options: ApplyThemeOptions = {}) {
  writeStoredThemeChoice(choice);
  applyThemeChoice(choice, options);
  window.dispatchEvent(new CustomEvent<ThemeChoice>(THEME_CHANGE_EVENT, { detail: choice }));
}

export function subscribeToSystemTheme(callback: () => void) {
  if (typeof window === "undefined") return () => {};

  const mediaQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
  if (!mediaQuery) return () => {};

  mediaQuery.addEventListener?.("change", callback);
  return () => mediaQuery.removeEventListener?.("change", callback);
}

export function subscribeToThemeChoice(callback: (choice: ThemeChoice) => void) {
  if (typeof window === "undefined") return () => {};

  const handler = (event: Event) => {
    const choice = (event as CustomEvent<ThemeChoice>).detail;
    if (isThemeChoice(choice)) {
      callback(choice);
    }
  };

  window.addEventListener(THEME_CHANGE_EVENT, handler);
  return () => window.removeEventListener(THEME_CHANGE_EVENT, handler);
}
