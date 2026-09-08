from pathlib import Path
import json, subprocess, base64, html
p=Path(__file__).resolve().parent
rows=[
('Refresh failure recovery','A failed refresh retained rows without an in-list explanation.','Show a warning above retained items with Retry.'),
('Refresh progress','Existing rows gave no in-list indication of refresh work.','Show Updating items while keeping rows visible.'),
('Pagination cursor recovery','Reset changed the cursor before the request succeeded.','Commit the new cursor only on success; block pagination after a failed reset.'),
('Empty-page termination','An empty page with a larger reported total could keep the spinner alive.','Stop pagination when a page returns no rows.'),
('Accurate empty-state titles','Filtered Favorites could imply the entire favorites collection was empty.','Say No matching items when search or status filters are active.'),
('Empty-state filter recovery','A status-filtered empty list offered no direct reset action.','Offer Reset filters in the empty state.'),
('Single search-clear refresh','Clear search started a direct request and a debounced request.','Use the existing debounced search path once.'),
('Empty asset tags','The context menu offered copying an empty tag.','Only offer Copy Asset Tag for a nonempty tag.'),
('Favorite request serialization','Rapid taps could overlap optimistic writes for one item.','Allow one favorite request per asset at a time.'),
('Unavailable family color','Zero available items still used the available-green tone.','Use neutral gray for zero availability.'),
('Precise item accessibility dates','VoiceOver rounded due times into days.','Announce the actual due date and time.'),
('Stable booking search','Refresh could remove the empty search field while rows remained.','Keep search mounted whenever the retained list qualifies.'),
('Stable explicit booking order','Installing an updated booking restored operational sorting.','Preserve the explicitly selected server ordering.'),
('Consistent booking accessibility','VoiceOver could call a pending pickup a return due date.','Use the same pickup/due timing text as the visible row.'),
('Bulk item counts','Each bulk SKU counted as one item regardless of quantity.','Sum planned bulk quantities plus serialized items.')]
spec={'title':'15 native iOS fixes','eyebrow':'Wisconsin Creative · Items and Bookings · September 7, 2026','lede':'Small reliability and accessibility improvements in everyday gear workflows. Implemented locally; simulator fixture evidence is separate from live service verification.','stats':[{'k':'Fixes','v':'15'},{'k':'Source checks','v':'33'},{'k':'Native tests','v':'22'},{'k':'UI tests','v':'2'}],'sections':[],'changes':[{'h':str(i+1)+'. '+r[0],'was':r[1],'now':r[2]} for i,r in enumerate(rows)],'verification':['WisconsinPerformance simulator build-for-testing succeeded on iPhone 16 Pro, iOS 26.5.','33 source-contract tests passed across 10 files.','4 BookingModels XCTest tests and 18 ScheduleVenueName Swift Testing tests passed. Two stale Schedule fixture initializers were updated to compile against current models.','Items long-press and Bookings filter/swipe interaction tests passed on iPhone 16 Pro.','An 8-second fixture delay reproduced Updating items with retained rows; the captured image was visually inspected.','Repository docs verification and git diff --check passed.'],'notes':['After-only transition evidence: normal before captures are retained alongside this report, but there is no matched pre-change delayed-refresh capture. Normal Bookings captures are byte-identical and do not demonstrate the edge-case fixes. No visual improvement measurement is claimed.','Screenshots use the existing local DEBUG fixture API on iPhone 16 Pro iOS 26.5, 402 × 874 logical points, light appearance, with a 9:41 status-bar override. They do not demonstrate an authenticated production session.','Failure responses, empty/filter-specific payloads, concurrent favorite writes, zero-availability family data, bulk quantities, and VoiceOver playback were not all exercised end to end. Source checks and native tests cover a subset; these runtime gates remain open.','Source snapshots for the two production files are retained before and after. Existing unrelated checkout changes were preserved. No commit, push, TestFlight upload, or production release was performed.']}
(p/'review-spec.json').write_text(json.dumps(spec,indent=2))
subprocess.run(['python3','.agents/skills/gt-ui-review/assets/build_review_page.py',str(p/'review-spec.json'),str(p/'review.html')],check=True)
cards=[]
for fn,title in [('after-items.png','Items · settled list'),('after-items-refresh.png','Items · refresh retains rows'),('after-bookings.png','Bookings · settled list')]:
    data=base64.b64encode((p/fn).read_bytes()).decode()
    cards.append(f'<figure style="margin:0"><figcaption>{html.escape(title)}</figcaption><img alt="{html.escape(title)}" style="width:100%;max-width:330px;border-radius:24px;margin-top:12px" src="data:image/png;base64,{data}"></figure>')
gallery='<section><h2>After-only simulator captures</h2><p>No matched comparison is claimed for the refresh transition.</p><div style="display:flex;flex-wrap:wrap;gap:24px">'+''.join(cards)+'</div></section>'
page=(p/'review.html').read_text()
page=page.replace('</header>','</header>'+gallery,1)
(p/'review.html').write_text(page)
