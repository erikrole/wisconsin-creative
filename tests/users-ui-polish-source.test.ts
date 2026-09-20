import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("Users interaction-detail contracts", () => {
  it("keeps directory commands, sort controls, recovery, and pagination on the 40px baseline", () => {
    const page = source("src/app/(app)/users/page.tsx");

    expect(page).toContain('className="group -ml-3 h-10');
    expect(page).not.toContain('className="group -ml-3 h-8"');
    expect(page).toContain('className="h-10 shrink-0 active:scale-[0.96]');
    expect(page.match(/className="h-10 active:scale-\[0\.96\]/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("uses full 40px labeled targets for roster visibility filters", () => {
    const filters = source("src/app/(app)/users/UserFilters.tsx");

    expect(filters).toContain('<Label htmlFor="show-inactive" className="flex h-10 cursor-pointer');
    expect(filters).toContain('<Label htmlFor="show-hidden-users" className="flex h-10 cursor-pointer');
  });

  it("animates sort-state icons without replaying them on initial render", () => {
    const page = source("src/app/(app)/users/page.tsx");

    expect(page).toContain('<AnimatePresence initial={false} mode="popLayout">');
    expect(page).toContain('initial={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}');
    expect(page).toContain('transition={{ type: "spring", duration: 0.3, bounce: 0 }}');
  });

  it("gives roster avatars neutral outlines and mobile cards tactile keyboard feedback", () => {
    const row = source("src/app/(app)/users/UserRow.tsx");

    expect(row).toContain("outline-black/10 dark:outline-white/10");
    expect(row).not.toContain('className="ring-1 ring-border"');
    expect(row).toContain("transition-[scale] active:scale-[0.96]");
    expect(row).toContain("focus-visible:ring-[3px] focus-visible:ring-ring/50");
    expect(row).toContain('className="transition-[box-shadow] duration-150 hover:shadow-sm"');
  });
});
