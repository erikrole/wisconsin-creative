// Keyboard-shortcut detection for guide Markdown.
//
// Authors write ordinary inline code (`⌘K`, `Cmd+S`, `3`). When the text looks
// like a key combo, both readers render it as a keyboard chip instead of a
// path/code sample. This is a house convention on top of CommonMark, documented
// in docs/GUIDE_MARKDOWN.md.

const MODIFIER_NAMES = new Set([
  "ctrl",
  "control",
  "cmd",
  "command",
  "alt",
  "option",
  "opt",
  "shift",
  "win",
  "windows",
  "meta",
  "super",
]);

const KEY_NAMES = new Set([
  "tab",
  "enter",
  "return",
  "escape",
  "esc",
  "space",
  "spacebar",
  "delete",
  "del",
  "backspace",
  "home",
  "end",
  "insert",
  "ins",
  "pageup",
  "pagedown",
  "pgup",
  "pgdn",
  "up",
  "down",
  "left",
  "right",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "plus",
  "minus",
]);

const MODIFIER_SYMBOLS = /[⌘⌥⇧⌃⎈]/;
const SPECIAL_SYMBOL_KEYS = /[↑↓←→⎋⏎↩⌫⌦]/;
const FUNCTION_KEY = /^F(?:[1-9]|1[0-2])$/i;

const SYMBOL_WORDS: Record<string, string> = {
  "⌘": "Command",
  "⌥": "Option",
  "⇧": "Shift",
  "⌃": "Control",
  "⎈": "Control",
  "↑": "Up arrow",
  "↓": "Down arrow",
  "←": "Left arrow",
  "→": "Right arrow",
  "⎋": "Escape",
  "⏎": "Return",
  "↩": "Return",
  "⌫": "Delete",
  "⌦": "Forward delete",
};

export function isKeyboardShortcut(raw: string): boolean {
  const text = raw.trim();
  if (!text || text.length > 48 || /\s/.test(text)) return false;
  if (text.includes("://") || text.includes("\\") || text.includes("/")) return false;

  if (MODIFIER_SYMBOLS.test(text) || SPECIAL_SYMBOL_KEYS.test(text)) return true;
  if (/^\d$/.test(text) || /^[A-Za-z]$/.test(text)) return true;
  if (FUNCTION_KEY.test(text) || KEY_NAMES.has(text.toLowerCase())) return true;

  const plusParts = splitOn(text, "+");
  if (plusParts.length >= 2 && plusParts.every(isShortcutToken) && plusParts.some(isModifierToken)) {
    return true;
  }

  const hyphenParts = splitOn(text, "-");
  if (
    hyphenParts.length >= 2 &&
    isModifierToken(hyphenParts[0] ?? "") &&
    hyphenParts.every(isShortcutToken)
  ) {
    return true;
  }

  return false;
}

export function splitShortcutKeys(raw: string): string[] {
  const text = raw.trim();
  if (!text) return [];

  const plusParts = splitOn(text, "+");
  if (plusParts.length >= 2) return plusParts;

  const hyphenParts = splitOn(text, "-");
  if (hyphenParts.length >= 2 && isModifierToken(hyphenParts[0] ?? "")) return hyphenParts;

  const glued = text.match(/^([⌘⌥⇧⌃⎈]+)(.+)$/u);
  if (glued?.[1] && glued[2]) return [...glued[1], glued[2]];

  return [text];
}

export function spokenShortcut(raw: string): string {
  return splitShortcutKeys(raw)
    .map((key) => SYMBOL_WORDS[key] ?? key)
    .join(" ");
}

function splitOn(text: string, separator: "+" | "-"): string[] {
  return text.split(separator).map((part) => part.trim()).filter(Boolean);
}

function isModifierToken(part: string): boolean {
  return MODIFIER_NAMES.has(part.toLowerCase()) || MODIFIER_SYMBOLS.test(part);
}

function isShortcutToken(part: string): boolean {
  if (!part) return false;
  if (isModifierToken(part)) return true;
  if (/^\d$/.test(part) || /^[A-Za-z]$/.test(part)) return true;
  if (FUNCTION_KEY.test(part) || KEY_NAMES.has(part.toLowerCase())) return true;
  if (SPECIAL_SYMBOL_KEYS.test(part)) return true;
  return false;
}
