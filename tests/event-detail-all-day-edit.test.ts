import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("Event detail all-day editing", () => {
  it("keeps timing mode in the draft and sends a complete conversion window", () => {
    const detail = source("src/app/(app)/events/[id]/page.tsx");
    const route = source("src/app/api/calendar-events/[id]/route.ts");

    expect(detail).toContain("const [allDayDraft, setAllDayDraft] = useState(false);");
    expect(detail).toContain('id="edit-all-day"');
    expect(detail).toContain("checked={allDayDraft}");
    expect(detail).toContain("allDay={allDayDraft}");
    expect(detail).toContain("body.allDay = allDayDraft;");
    expect(detail).toContain("buildEventDraftDateTime(startDateDraft, startTimeDraft, allDayDraft, false)");
    expect(detail).toContain("Uses inclusive dates with no call time.");
    expect(detail).toContain("Existing gear reservation windows stay unchanged");

    expect(route).toContain("allDay: z.boolean().optional(),");
    expect(route).toContain("Start and end are required when changing event timing mode");
    expect(route).toContain("const nextAllDay = body.allDay ?? existing.allDay;");
    expect(route).toContain("patch.allDay = nextAllDay;");
    expect(route).toContain("Imported event times are controlled by their calendar source");
  });
});
