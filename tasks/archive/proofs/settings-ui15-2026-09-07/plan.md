# Settings UI batch — 15 fixes

Scope: Reservation Rules, Checkout Policies, Appearance. Only these three page components and their local proof/tests/docs. Existing primitives remain unchanged. No API/schema changes or live settings writes.

1. Enter submits either policy form.
2. Reset changes restores the last loaded/saved values.
3. Unsaved changes are visibly named in the action row.
4. Unsaved edits trigger browser unload protection.
5. Background refresh failures preserve the visible form and offer retry.
6. Successful background reads refresh clean forms without replacing dirty drafts.
7. Input help and error text is programmatically associated with each field.
8. Invalid submission focuses the first invalid field.
9. Save errors remain inline with the entered values.
10. Save labels remain stable with an announced pending state.
11. Policy inputs and action buttons meet the 40px target floor.
12. Blank grace period is rejected instead of silently becoming zero.
13. Policy descriptions accurately distinguish new-booking limits from ongoing grace/no-show behavior.
14. Appearance choices have explicit keyboard-focus rings.
15. Text-size selection has a non-color checkmark and clean accessible names; theme and text-size choices are labelled groups.

Proof: render actual page components, shared primitives, styles, useFetch and React Query with synthetic response interception. Record source snapshot/hash before editing; same viewport, fixture and appearance for pairs. This proves the component UI and client behavior, not authenticated server or production state. Follow with focused tests, TypeScript, lint, application build, docs/codemap and final diff checks.

## Acceptance

Implemented locally. All 110 focused tests pass; TypeScript, lint and production app build pass. Browser checks cover both forms with isolated API fixtures. Matched desktop captures use the original dirty source snapshots; authenticated application and production verification are not claimed. Browser unload protection covers reload/tab close, not client-side route transitions. No commits, pushes or live settings writes.
