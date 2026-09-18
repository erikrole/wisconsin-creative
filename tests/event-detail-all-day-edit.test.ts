import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function source(relativeFile: string) {
  return readFileSync(path.join(process.cwd(), relativeFile), "utf8");
}

describe("Event detail all-day editing", () => {
  it("keeps timing mode in the draft and sends a complete conversion window", () => {
    const detail = source("src/app/(app)/events/[id]/page.tsx");
    const fields = source("src/components/event-editor/EventEditorFields.tsx");
    const route = source("src/app/api/calendar-events/[id]/route.ts");

    expect(detail).toContain("const [editDraft, setEditDraft] = useState<EventEditorDraft>(emptyEventEditorDraft);");
    expect(fields).toContain('id="event-all-day"');
    expect(fields).toContain("checked={draft.allDay}");
    expect(fields).toContain("allDay={draft.allDay}");
    expect(detail).toContain("body.allDay = editDraft.allDay;");
    expect(detail).toContain("buildEventDraftDateTime(editDraft.startDate, editDraft.startTime, editDraft.allDay, false)");
    expect(fields).toContain("Uses inclusive dates with no call time.");
    expect(fields).toContain("Existing gear reservation windows stay unchanged");

    expect(route).toContain("allDay: z.boolean().optional(),");
    expect(route).toContain("Start and end are required when changing event timing mode");
    expect(route).toContain("const nextAllDay = body.allDay ?? existing.allDay;");
    expect(route).toContain("patch.allDay = nextAllDay;");
    expect(route).toContain("patch.timingLocked = true");
  });
});
