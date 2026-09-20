import { describe, expect, it } from "vitest";
import {
  isKeyboardShortcut,
  splitShortcutKeys,
  spokenShortcut,
} from "@/lib/guide-keyboard";

describe("isKeyboardShortcut", () => {
  it.each([
    "⌘K",
    "⇧⌘G",
    "⌘↑",
    "⌘[",
    "Cmd+S",
    "Ctrl+Shift+K",
    "Command-Option-S",
    "F5",
    "Esc",
    "3",
    "I",
  ])("treats %s as a shortcut", (value) => {
    expect(isKeyboardShortcut(value)).toBe(true);
  });

  it.each([
    "smb://ath01-nas.uwia.wisc.edu/users/",
    "SPORT-YYYYMMDD",
    "Q2",
    "Caption_16x9",
    "001",
    "ACCOUNT-OR-REFERENCE",
    "/PHOTO",
    "555-555-5555",
  ])("does not treat %s as a shortcut", (value) => {
    expect(isKeyboardShortcut(value)).toBe(false);
  });
});

describe("splitShortcutKeys", () => {
  it("splits glued modifier symbols from the key", () => {
    expect(splitShortcutKeys("⇧⌘G")).toEqual(["⇧", "⌘", "G"]);
    expect(splitShortcutKeys("⌘K")).toEqual(["⌘", "K"]);
    expect(splitShortcutKeys("⌘[")).toEqual(["⌘", "["]);
  });

  it("splits plus-separated named keys", () => {
    expect(splitShortcutKeys("Cmd+Shift+S")).toEqual(["Cmd", "Shift", "S"]);
  });

  it("keeps a single key intact", () => {
    expect(splitShortcutKeys("3")).toEqual(["3"]);
  });
});

describe("spokenShortcut", () => {
  it("names modifier symbols for assistive text", () => {
    expect(spokenShortcut("⌘K")).toBe("Command K");
    expect(spokenShortcut("⇧⌘G")).toBe("Shift Command G");
  });
});
