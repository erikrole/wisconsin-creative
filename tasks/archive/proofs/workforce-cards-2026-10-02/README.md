# Hiring card review

Matched desktop captures use the actual pre-redesign dirty HiringClient board markup and the changed ApplicantCard component. `before-source.txt` and `after-source.txt` retain the relevant source snapshots, `fixture.json` contains only fictional candidates, and the capture receipts bind image bytes to matching declared settings. Shared CSS comes from the recorded repository revision.

`after-mobile.png` and `after-dark.png` are supplemental after-only captures after toggling the first fixture applicant to Reviewed. `interaction-results.json` records keyboard/review/layout checks against in-memory fixture callbacks. They do not prove server persistence.

The self-contained `review.html` presents the matched comparison. Authentication and the changed full route remain a separate managed-preview acceptance gate. Production spreadsheet decisions were verified independently; no private applicant material is included here.
