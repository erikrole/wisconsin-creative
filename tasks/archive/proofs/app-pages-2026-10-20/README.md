# Public app page visual evidence

`review.html` is self-contained. `spec.json` and the repository gt-ui-review builder produce the three matched PNG comparisons; the saved review also includes an appended after-only gallery of the three new product pages, using the original JPEG captures alongside this file.

Each paired image has metadata and a hash-bound evidence receipt. Before is ready production deployment dpl_42N3EDKqotgytTdVy3HDxAE7pisA at c71954b56c7ae767dd5f5bbcfdbed0274bc368c5. After references the retained UI source snapshot SHA-256 in the metadata. The original JPEGs and exact source archive are retained outside the repository in the task evidence folder. PNG comparisons are lossless encodings of the decoded JPEG screenshot pixels; product screenshots were never retouched.

Source product screenshot provenance: `public/apps/shots/README.md`. These are public, static-content presentation checks, not authenticated or physical-device acceptance.

Production advanced to c71954b before the paired captures. That commit has no changes to the app directory or product page sources; the receipts name the actual ready deployment. After captures were refreshed from the rebased UI commit, whose app-page and asset bytes match the retained source archive.
