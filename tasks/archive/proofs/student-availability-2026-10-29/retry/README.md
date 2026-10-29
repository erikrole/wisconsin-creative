# Retry-safe save verification

Six real-PostgreSQL Availability cases cover lost-successful-response retry, simultaneous submissions, changed/deleted replay, actor/target isolation, atomic rollback and a student retry after staff review. All 19 PostgreSQL tests passed. Full unit coverage passed (8,475 tests, 13 skipped). Browser fixture evidence is in `../preview-browser.json`; authenticated preview acceptance remains pending.

The first full local test run lacked CI’s dummy SESSION_SECRET and exposed the calendar-date guard and undersized review buttons. The correct local test setting and product fixes were applied before these passing results. No production settings were used.
