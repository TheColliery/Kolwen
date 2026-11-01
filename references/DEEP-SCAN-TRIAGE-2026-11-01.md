# Security scan triage, 2026-11-01

A CodeRabbit Deep Scan of `main`, read against `afa119b`, lists 9 open findings: 2 medium and 7 low. Five were raised for the first time on 2026-11-01. Four were already open on 2026-10-31, and they keep the disposition the October record gave them, because the code at those sites has not moved.

Eight of the nine sit in CI and development scripts, reached only through a contributor's pull request in that pull request's own CI. The ninth is in the Worker, in a handler that answers 404 before the input is read while subscriptions are switched off, as they are today.

Method: each finding was read against the code: why it was raised, whether it holds, and its other sides (the callers, the environments it runs in, who controls its input). Each has one disposition: FIXED, CONSIDERED, REJECTED or DEFERRED.

Advisories: whether a finding warrants a GitHub security advisory turns on who controls the input that reaches it. For eight of the nine it is the maintainer's own input or a contributor's pull request in its own CI, and no released artifact carries that code. The ninth is not reachable while the subscription switch is off. Advisories owed: 0. If the subscription switch is turned on before row 3 is fixed, this is read again.

| # | Category | Where (at afa119b) | First raised | Disposition | Reason |
|---|---|---|---|---|---|
| 1 | denial_of_service | `scripts/coderabbit-config.test.mjs` (`expandBraces`) | 2026-11-01 | DEFERRED (one open fix for rows 1, 6, 8 and 9) | brace alternatives are expanded in full before any bound; the expansion gets a count and size limit |
| 2 | denial_of_service | `scripts/lib/font-coverage.mjs` (`facesOf`) | 2026-10-31 | DEFERRED (the open fix for rows 2, 4, 5 and 7, as in October) | the block match rescans on unclosed openers; one forward pass replaces it |
| 3 | denial_of_service | `worker/index.mjs` (`EMAIL_SHAPE`, `handleSubscription`) | 2026-11-01 | DEFERRED (an open fix) | the address pattern can backtrack on a long dotted domain; a length limit before it and a linear check. Not reachable while subscriptions are off |
| 4 | denial_of_service | `scripts/address-check.mjs` (`addressesIn`) | 2026-10-31 | DEFERRED (the open fix for rows 2, 4, 5 and 7) | the address match rescans a long local-part run; one forward pass replaces it |
| 5 | denial_of_service | `scripts/sitemap-lastmod.mjs` (`strip`) | 2026-10-31 | DEFERRED (the open fix for rows 2, 4, 5 and 7) | the script and style removal rescans inside a comment; comments are removed first, in one pass |
| 6 | denial_of_service | `scripts/lib/page-template.mjs` (`withoutComments`) | 2026-11-01 | DEFERRED (one open fix for rows 1, 6, 8 and 9) | comment removal restarts from the start after each deletion; a forward scan keeps its position |
| 7 | denial_of_service | `scripts/lib/legal-render.mjs` (`splitSource`) | 2026-10-31 | DEFERRED (the open fix for rows 2, 4, 5 and 7) | the comment removal rescans at each unclosed opener; one forward pass replaces it |
| 8 | denial_of_service | `scripts/surface-check.mjs` (`blank`, over each `dataSpansOf` span) | 2026-11-01 | DEFERRED (one open fix for rows 1, 6, 8 and 9) | overlapping spans are blanked one by one; the spans are merged, or the visible text built in one pass |
| 9 | denial_of_service | `scripts/rendered-check.mjs` (`measureLines`) | 2026-11-01 | DEFERRED (one open fix for rows 1, 6, 8 and 9) | every line is filtered again for every block; each block's last line is recorded once |

Count: FIXED 0, CONSIDERED 0, REJECTED 0, DEFERRED 9. Advisories owed: 0.
