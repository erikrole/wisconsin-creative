# Wisconsin Badgers YouTube: title and description formats

Agreed with Erik, 2026-10-01. The audit tooling and the daily new-upload job read this file.

## Dates
AP style: `Jan. Feb. March April May June July Aug. Sept. Oct. Nov. Dec.`, then day and year: `Sept. 26, 2026`.
Separator is `||` (space, two pipes, space).

## Formats (uploads since July 1, 2026)
| Type | Title pattern | Example |
|---|---|---|
| Game highlights | `Highlights vs\|at Opponent \|\| Wisconsin Sport \|\| Date` | `Highlights at Penn State \|\| Wisconsin Football \|\| Sept. 26, 2026` |
| Postgame press conference | `Name Postgame Press Conference \|\| Wisconsin Football vs\|at Opponent \|\| Date` | `Luke Fickell Postgame Press Conference \|\| Wisconsin Football at Penn State \|\| Sept. 26, 2026` |
| Volleyball post-match | `Post-Match Press Conference \|\| Wisconsin Volleyball vs\|at Opponent \|\| Date` | `Post-Match Press Conference \|\| Wisconsin Volleyball vs Marquette \|\| Sept. 17, 2026` |
| Media availability | `Name Media Availability \|\| Wisconsin Sport \|\| Date` | `Jeff Grimes Media Availability \|\| Wisconsin Football \|\| Aug. 22, 2026` |
| Weekly media conference | `Name Weekly Media Conference \|\| Wisconsin Sport \|\| Date` | `Mike Hastings Weekly Media Conference \|\| Wisconsin Men's Hockey \|\| Sept. 29, 2026` |
| Multi-sport weekly | `Wisconsin Weekly Press Conference \|\| Date` | `Wisconsin Weekly Press Conference \|\| Sept. 28, 2026` |

Rules: `vs` or `at` comes from the schedule (home or away). BTT and NCAA tournament games always read `vs`, with the event in parentheses: `(BTT)`, `(NCAA Tournament)`, `(Final Four)`, a bowl name.
Opponent spelling follows the schedule or the existing title.

## Football cinematics: KEEP AS IS (do not standardize)
Format: `YEAR Wisconsin Football || Cinematic Recap vs Opponent`
Example: `2026 Wisconsin Football || Cinematic Recap vs Penn State`
This is its own format. The audit and the daily job never rewrite these titles. (Basketball "Cinematic Highlights vs Opponent" titles follow the highlights pattern with `Cinematic` in front.)

## Descriptions
- Opening line states who or what, in the form `Sport Role Name speaks with the media.` (roles come from the uwbadgers.com staff and roster pages).
- Postgame: result sentence from the schedule, e.g. `... after the Badgers' 24-20 win at No. 13 Penn State on Sept. 26, 2026.`
- Highlights: trimmed game story from the official recap, with score, standouts and one notable stat.
- Long videos (over 10 minutes): chapters. Coach-segment chapters for the weeklies (`Football: Luke Fickell`, `Volleyball: Kelly Sheffield`), starting at 0:00, at least three.
- Footer on every video: `More from Wisconsin Athletics: uwbadgers.com` then `#Badgers #OnWisconsin`.
- Time-sensitive copy ("Up Next", "Kickoff is set for") is removed once the event has passed.
- Never invent facts. Sources: the title, the schedule API, the official recap, the transcript.

## Exclusions
Unlisted and private videos are never touched.
