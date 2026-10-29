# Security scan triage, 2026-10-28

A CodeRabbit Deep Scan of `main` at `118a734` raised 12 findings, 6 medium and 6 low. All 12 sit in CI and development scripts. None is in anything the site serves or the package ships.

Method: each finding was read against the code: why it was raised, whether it holds, and its other sides (the callers, the environments it runs in, who controls its input). Each has one disposition: FIXED, CONSIDERED, REJECTED or DEFERRED.

Advisories: whether a finding warrants a GitHub security advisory turns on who controls the input that reaches it. None does. Every path is reached only by the maintainer's own input or by a contributor's pull request, which runs in that pull request's own CI or in a local check before review, and no released artifact carries this code. Each finding is recorded here, and when fixed, in the CHANGELOG.

| # | Category | Where (at 118a734) | Disposition | Reason |
|---|---|---|---|---|
| 1 | authorization_bypass | `.github/workflows/publish-pypi.yml:158` | FIXED (this change; Linux runner, the workflow's own) | a manual run now always publishes to TestPyPI, as the step's comment already said |
| 2 | ssrf | `scripts/lib/browser.mjs:238` | DEFERRED (an open fix) | the check's browser should reach only the server it serves from |
| 3 | injection | `scripts/reply-language-check.mjs:139` | FIXED (this change; tested on Windows and Linux) | text from outside is escaped before it enters a report line |
| 4 | denial_of_service | `scripts/lib/woff2-cmap.mjs:83` | DEFERRED (one open fix for rows 4, 6 and 11) | the font reader gets size bounds; one change for rows 4, 6 and 11 |
| 5 | denial_of_service | `scripts/lib/headers-file.mjs:132` | DEFERRED (one open fix for rows 5, 7 and 12) | matching gets linear time; one change for rows 5, 7 and 12 |
| 6 | denial_of_service | `scripts/lib/woff2-cmap.mjs:37` | DEFERRED (one open fix for rows 4, 6 and 11) | same change as row 4 |
| 7 | denial_of_service | `scripts/lib/type-lint.mjs:61` | DEFERRED (one open fix for rows 5, 7 and 12) | same change as row 5 |
| 8 | denial_of_service | `scripts/lib/secret-scan.mjs:316` | FIXED in `ba86100` | the shared scanner's overlap check no longer grows with the square of a line's matches |
| 9 | injection | `scripts/rendered-check.mjs:377` | FIXED (this change; tested on Windows and Linux) | same change as row 3 |
| 10 | path_traversal | `scripts/lib/static-server.mjs:34` | FIXED (this change; tested on Windows, and on Linux where the file-link case also runs) | the local test server now resolves links before it checks a path is inside its root |
| 11 | denial_of_service | `scripts/lib/woff2-cmap.mjs:69` | DEFERRED (one open fix for rows 4, 6 and 11) | same change as row 4 |
| 12 | denial_of_service | `scripts/post-deploy-check.mjs:78` | DEFERRED (one open fix for rows 5, 7 and 12) | it fetches only the origin its operator passes, and any redirect that origin answers with (default `https://kolwen.com/`; the deploy-check workflow passes none) |

Count: FIXED 5, DEFERRED 7, CONSIDERED 0, REJECTED 0. Advisories owed: 0.
