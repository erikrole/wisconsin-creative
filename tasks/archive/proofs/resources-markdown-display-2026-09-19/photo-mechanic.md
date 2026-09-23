Cull in Photo Mechanic, ingest to the photographer’s RAW folder, edit in Lightroom, then tag and rename the selects.

> [!IMPORTANT]
> Do this in order. Culling happens on the card. Nothing is copied to the Media Drive until Phase 2.

## Phase 1 — Culling in Photo Mechanic

**Goal:** Pick your selects before anything touches your hard drive.

1. Plug in your SD card.
2. Open **Photo Mechanic**.
3. In the **Navigator** panel, locate your RAW photos on the card and double-click the folder to open it.
4. Browse each photo and press `3` to mark keepers green. Use `1` or `2` for lower-priority colors if you want a secondary tier; unmarked photos stay uncolored.
5. Once you’ve culled through everything, click the **transparent/clear button** in the top-right color filter row (far right of the colored buttons). This hides all non-colored photos, leaving only your green picks visible.
6. Press `⌘A` to select all visible photos.

## Phase 2 — Ingesting in Photo Mechanic

1. Go to **File → Ingest from Selection**.
2. Set the **Primary Destination Folder** to the appropriate RAW folder for this photographer.
3. Click **Metadata (IPTC) Template** and fill in batch metadata — photographer name, event, keywords, date, etc. Close the template when done.
4. Set up your **rename string**. Copy and paste this, then adjust the fields:

```copy
SPORT-{iptcdate}-OPP-PHOTOGRAPHER-{seqn}
```

- `{iptcdate}` pulls the date from the camera automatically.
- Click **Set {seqn} var** and start your sequence at **001**.
- Example: `MBB-20260415-OSU-ROLE-001`
5. Set **Copy Photos** to **Directly into primary and secondary folders**.
6. Click **Ingest** to begin the transfer.

## Phase 3 — Editing in Lightroom

1. Open **Lightroom** and go to **File → Add Photos** (or **Add Folder**). Navigate to and select the RAW folder you just ingested into.
2. Edit your photos — apply exposure corrections, color grades, looks, etc.
3. Once editing is complete, press `⌘A` to select all, then go to **File → Export**.
4. Use these export settings:

   | Setting | Value |
   | --- | --- |
   | Format | JPG |
   | Size | Full Size |
   | Quality | 90% |
   | Metadata | All Metadata |
   | File Naming | Original Filename |
   | Destination | New folder named **SELECTS** inside the photographer’s folder |

## Phase 4 — Metadata tagging in Photo Mechanic

1. Go back to **Photo Mechanic**. In the Navigator, find and open the **SELECTS** folder you just exported into.
2. Click the first photo in the contact sheet to select it, then press `I` to open the Metadata/IPTC panel.
3. Add any remaining keywords in the **Keywords** field. Tag people and locations in the **Persons Shown** field.
4. Press `⌘N` to save and advance to the next photo (`⌘B` goes back). Repeat for every photo in the folder.

> [!WARNING]
> If Persons Shown is left blank, the rename in Phase 5 will produce a trailing dash: `VB-20260423-MICH-MAO-013-.jpg`. That’s fine if intentional — just be aware.

> [!TIP]
> Persons Shown is not only for athlete names. Use it for locations and main keywords too (`Camp Randall`, `Main Gym`) so photos are easy to search later.

## Phase 5 — Rename by Persons Shown

1. Once all photos are tagged, press `⌘A` to select all, then `⌘M` to rename.
2. Paste this rename string:

```copy
{filenamebase}-{persons}
```

This keeps your original filename and appends whatever you tagged in Persons Shown.

Examples:

- `VB-20260423-MICH-MAO-013-Kelly Sheffield`
- `VB-20260908-MINN-KROMKE-183-Field House.jpg`

**Made a mistake?**

- **If you haven’t run the rename yet** — go back to Phase 4, fix your Persons Shown tags, then run `{filenamebase}-{persons}` fresh. No rename needed to revert.
- **If you already ran the rename** — re-export the batch from Lightroom (originals still have clean names there) into a fresh SELECTS folder, then redo Phases 4 and 5.

## Quick reference — Hotkeys

> [!SHORTCUT]
> `3` mark green · `I` metadata · `⌘N` next · `⌘B` back · `⌘A` select all · `⌘M` rename
