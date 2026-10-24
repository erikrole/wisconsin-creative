# Native Signature Capture Audit - 2026-10-07

## Scope

- Surfaces: `ios/Wisconsin/Views/Signatures/SignaturesView.swift` (collections and roster), `SignatureCaptureView.swift` (capture), and `SignatureCanvasView.swift` (UIKit Pencil canvas)
- Logic: `ios/Wisconsin/Core/SignatureStrokeRecorder.swift`; models in `ios/Wisconsin/Models/SignatureModels.swift`
- API methods: `APIClient.signatureCollections()`, `signatureCollection(id:)`, `signatureCaptureBootstrap(collectionId:memberId:)`, and `saveSignatureCapture(collectionId:memberId:body:)`
- Server contracts: `GET /api/signatures/collections`, `GET /api/signatures/collections/{id}`, `GET /api/signatures/collections/{id}/members/{memberId}`, `POST /api/signatures/collections/{id}/capture/{memberId}`
- Product contracts: `docs/AREA_SIGNATURES.md`, `docs/BRIEF_SIGNATURE_CAPTURE_V1.md`, and `docs/AREA_MOBILE.md`
- Roles: STAFF and ADMIN, iPad only, through the Browse gate `SignatureCaptureAvailability`

## User job

At a media day, open a team roster, find whoever walks up (in no particular order), and capture their Apple Pencil signature, then return to the roster. Roster imports, settings, downloads, and history stay on the web.

## Reachability and state inventory

| State | Current behavior | Audit result |
| --- | --- | --- |
| Browse entry | Signatures appears only on iPad for STAFF and ADMIN | Accepted |
| Collections | Open collections with signed/required counts; archived collections hidden | Accepted |
| Roster | Web layout: readiness header (team rosters), search by name, number, or title, group filter, collapsible groups with signed counts, jersey circle, green signed rows | Accepted |
| Saved signature | Template-tinted PNG preview (follows light/dark); tap for Quick Look on a checkerboard; row menu Replace signature | Accepted |
| Empty filter | "No roster members in this view" | Accepted |
| Load failures | Collections, roster, and signer each show Retry | Accepted |
| Drawing input | Apple Pencil only; finger, palm, and mouse never draw (simulator builds also accept direct touch for development) | Accepted |
| Sample capture | Every coalesced Pencil sample recorded once; repeated runs dropped; predicted touches display-only | Accepted |
| Canvas size | Logical box sized so the worst-case crop fits the server export box; letterboxed on rotation | Accepted |
| History bar | Large Undo / Redo / Clear / Replay above the canvas; Clear is undoable; Command-Z, Shift-Command-Z, Command-Delete, Command-R; Pencil double-tap or squeeze undo (honors the iPad's Pencil setting) | Accepted |
| Replay | Redraws unsaved strokes at the signer's real Pencil timing, pen lifts capped at 0.5 s; any new stroke stops it | Accepted |
| Orientation | Canvas only in landscape; portrait shows a rotate prompt and keeps the ink (iPadOS will not let a multitasking app force rotation) | Accepted |
| Edge gestures and sleep | System edge gestures deferred, home indicator hidden, idle timer off while capturing | Accepted |
| Cancel with ink | Discard confirmation; swipe-to-dismiss disabled while ink is unsaved | Accepted |
| Save | "Save signature" turns into a green "Saved"; Command-S; brief confirmation, then back to the roster (no auto-advance, Erik 2026-10-06) | Accepted |
| Ambiguous failure (network, 425, 429, 5xx) | Same request ID on retry | Accepted |
| Conflict (409) | Ink kept, signer reloaded, new request ID; when another iPad saved first, Save asks "Replace the signature saved on another iPad?" before replacing | Fixed (Fable review 2026-10-07) |
| Stroke sample limit | A stroke at 10,000 samples stops growing and the signer is told to lift and keep signing | Fixed (Fable review 2026-10-07) |
| Decode failure after a 2xx | Treated as saved instead of replaying forever | Fixed (Fable review 2026-10-07) |
| Inactive signer | Save disabled | Fixed (Fable review 2026-10-07) |
| Archived collection or read-only role preview | Save disabled with an explanation | Accepted |
| Stroke limit | 128 strokes; further strokes refused with a notice | Accepted |

## Remaining risk

- Real Pencil behavior (palm rejection, double-tap/squeeze, 240 Hz sampling) can only be proven on a physical iPad; see `docs/IOS_DEVICE_WALKTHROUGH.md`.
- Linked Creative Staff members: the bootstrap reports the team collection's status while the save checks the canonical Creative Staff collection, so an archived Creative Staff roster shows Save and then returns 409.
- Server-side `requestId` replay after a function timeout could, in theory, let a stalled original request delete blobs a reclaiming replay committed (PLAUSIBLE, needs the original to outlive the function timeout).
- The logical canvas size locks on the first non-empty layout; a transient narrow first layout (Stage Manager) keeps a smaller canvas for that capture.
- Drafts are in memory only: leaving the capture screen or the app being terminated loses unsaved ink (the web keeps device-local drafts).
