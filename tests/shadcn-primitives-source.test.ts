import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(path, "utf8");
}

describe("High-use shadcn primitive contracts", () => {
  const styles = read("src/components/ui/control-styles.ts");
  const button = read("src/components/ui/button.tsx");
  const input = read("src/components/ui/input.tsx");
  const textarea = read("src/components/ui/textarea.tsx");
  const nativeSelect = read("src/components/ui/native-select.tsx");
  const select = read("src/components/ui/select.tsx");
  const checkbox = read("src/components/ui/checkbox.tsx");
  const radio = read("src/components/ui/radio-group.tsx");
  const sw = read("src/components/ui/switch.tsx");
  const dialog = read("src/components/ui/dialog.tsx");
  const alertDialog = read("src/components/ui/alert-dialog.tsx");
  const sheet = read("src/components/ui/sheet.tsx");
  const drawer = read("src/components/ui/drawer.tsx");
  const dropdown = read("src/components/ui/dropdown-menu.tsx");
  const popover = read("src/components/ui/popover.tsx");
  const tooltip = read("src/components/ui/tooltip.tsx");
  const table = read("src/components/ui/table.tsx");
  const badge = read("src/components/ui/badge.tsx");
  const toggle = read("src/components/ui/toggle-group.tsx");
  const tabs = read("src/components/ui/tabs.tsx");
  const command = read("src/components/ui/command.tsx");
  const alert = read("src/components/ui/alert.tsx");

  it("keeps shared field chrome identical across text and select controls", () => {
    expect(styles).toContain("export const fieldChrome");
    expect(styles).toContain("hover:border-ring/50");
    expect(styles).toContain("disabled:cursor-not-allowed");
    expect(input).toContain("fieldChrome");
    expect(textarea).toContain("fieldChrome");
    expect(nativeSelect).toContain("fieldChrome");
    expect(select).toContain("fieldChrome");
    expect(input).toContain("h-10");
    expect(nativeSelect).toContain("h-10");
    expect(select).toContain('size === "default" && "h-10"');
    expect(select).toContain('size === "sm" && "h-8 text-sm"');
    expect(button).toContain('default: "h-10 px-4 py-2');
    expect(button).toContain('lg: "h-11 rounded-md px-6');
  });

  it("gives buttons press feedback, visible focus, and reduced-motion safety", () => {
    expect(button).toContain("cursor-pointer");
    expect(button).toContain("active:scale-[0.96]");
    expect(button).toContain("motion-reduce:active:scale-100");
    expect(button).toContain("duration-150");
    expect(button).toContain("focus-visible:ring-[3px]");
    expect(button).toContain('icon: "size-10"');
  });

  it("expands checkbox, radio, and switch hit areas without growing layout boxes", () => {
    expect(styles).toContain("after:size-10");
    expect(checkbox).toContain("compactHitArea");
    expect(checkbox).toContain("size-4");
    expect(radio).toContain("compactHitArea");
    expect(sw).toContain("compactHitArea");
    expect(sw).toContain("h-6 w-11");
  });

  it("keeps overlay close controls on the 40px baseline and caps dialog height", () => {
    expect(styles).toContain("flex size-10 items-center justify-center");
    expect(dialog).toContain("overlayCloseButtonAbsolute");
    expect(dialog).toContain("showCloseButton = true");
    expect(dialog).toContain("max-h-[min(90dvh,40rem)]");
    expect(dialog).toContain("pr-14");
    expect(alertDialog).toContain("overlayScrim");
    expect(sheet).toContain("overlayCloseButtonAbsolute");
    expect(sheet).toContain("data-[state=open]:duration-300");
    expect(drawer).toContain("overlayCloseButtonAbsolute");
    expect(command).toContain("showCloseButton={false}");
  });

  it("makes menus origin-aware and keeps menu rows at least 36px", () => {
    expect(styles).toContain("origin-(--radix-popover-content-transform-origin)");
    expect(styles).toContain("min-h-9");
    expect(select).toContain("popoverMotion");
    expect(select).toContain("min-h-9");
    expect(dropdown).toContain("popoverMotion");
    expect(dropdown).toContain("menuItem");
    expect(popover).toContain("popoverMotion");
  });

  it("skips tooltip delay after the first open tooltip", () => {
    expect(tooltip).toContain("skipDelayDuration = 300");
    expect(tooltip).toContain("delayDuration = 200");
  });

  it("uses sentence-case table headers instead of forced uppercase", () => {
    expect(table).not.toContain("uppercase tracking-wider");
    expect(table).toContain("text-xs font-medium");
  });

  it("keeps badges and tabs operational rather than decorative", () => {
    expect(badge).not.toContain("hover:scale-[1.03]");
    expect(toggle).toContain("min-h-10");
    expect(tabs).toContain("min-h-10");
    expect(alert).toContain("has-[>svg]:grid-cols-[1rem_1fr]");
  });
});
