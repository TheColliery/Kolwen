# Security scan triage, 2026-11-01

A CodeRabbit Deep Scan of `main`, read against `afa119b`, lists 9 open findings: 2 medium and 7 low. Five were raised for the first time on 2026-11-01. Four were already open on 2026-10-31, and they keep the disposition the October record gave them, because the code at those sites has not moved.

Eight of the nine sit in CI and development scripts, reached only through a contributor's pull request in that pull request's own CI. The ninth is in the Worker, in a handler that answers 404 before the input is read while subscriptions are switched off, as they are today.

Method: each finding was read against the code: why it was raised, whether it holds, and its other sides (the callers, the environments it runs in, who controls its input). Each has one disposition: FIXED, CONSIDERED, REJECTED or DEFERRED.

Advisories: whether a finding warrants a GitHub security advisory turns on who controls the input that reaches it. For eight of the nine it is the maintainer's own input or a contributor's pull request in its own CI, and no released artifact carries that code. The ninth was not reachable while the subscription switch is off, and it is fixed. Advisories owed: 0.

| # | Category | Where (at afa119b) | First raised | Disposition | Reason |
|---|---|---|---|---|---|
| 1 | denial_of_service | `scripts/coderabbit-config.test.mjs` (`expandBraces`) | 2026-11-01 | DEFERRED (one open fix for rows 1, 6, 8 and 9) | brace alternatives are expanded in full before any bound; the expansion gets a count and size limit |
| 2 | denial_of_service | `scripts/lib/font-coverage.mjs` (`facesOf`) | 2026-10-31 | DEFERRED (the open fix for rows 2, 4, 5 and 7, as in October) | the block match rescans on unclosed openers; one forward pass replaces it |
| 3 | denial_of_service | `worker/index.mjs` (`EMAIL_SHAPE`, `handleSubscription`; now `emailShape`) | 2026-11-01 | FIXED (a15186e) | the address pattern could backtrack on a long dotted domain; an address over 254 characters is now refused before a single linear check. It was not reachable while subscriptions are off |
| 4 | denial_of_service | `scripts/address-check.mjs` (`addressesIn`) | 2026-10-31 | DEFERRED (the open fix for rows 2, 4, 5 and 7) | the address match rescans a long local-part run; one forward pass replaces it |
| 5 | denial_of_service | `scripts/sitemap-lastmod.mjs` (`strip`) | 2026-10-31 | DEFERRED (the open fix for rows 2, 4, 5 and 7) | the script and style removal rescans inside a comment; comments are removed first, in one pass |
| 6 | denial_of_service | `scripts/lib/page-template.mjs` (`withoutComments`) | 2026-11-01 | DEFERRED (one open fix for rows 1, 6, 8 and 9) | comment removal restarts from the start after each deletion; a forward scan keeps its position |
| 7 | denial_of_service | `scripts/lib/legal-render.mjs` (`splitSource`) | 2026-10-31 | DEFERRED (the open fix for rows 2, 4, 5 and 7) | the comment removal rescans at each unclosed opener; one forward pass replaces it |
| 8 | denial_of_service | `scripts/surface-check.mjs` (`blank`, over each `dataSpansOf` span) | 2026-11-01 | DEFERRED (one open fix for rows 1, 6, 8 and 9) | overlapping spans are blanked one by one; the spans are merged, or the visible text built in one pass |
| 9 | denial_of_service | `scripts/rendered-check.mjs` (`measureLines`) | 2026-11-01 | DEFERRED (one open fix for rows 1, 6, 8 and 9) | every line is filtered again for every block; each block's last line is recorded once |

Count: FIXED 1, CONSIDERED 0, REJECTED 0, DEFERRED 8. Advisories owed: 0.

## Batch B, 2026-11-03

A second Deep Scan of `main`, read against `099e02e`, lists 35 open findings: 20 medium and 15 low. Against the scan recorded above:
- 11 are the same findings seen again;
- 9 sit at the same file and weakness class as an earlier finding;
- 15 are new;
- 10 earlier findings are no longer listed.

Eleven of the open rows come from earlier scans that this scan did not raise again. Nine of those sit at sites where the fix has already shipped: their dashboard entries are open only because nobody has closed them.

Thirty-four of the 35 sit in CI and development scripts, reached only by the maintainer's own input or by a contributor's pull request in that pull request's own CI. The 35th is the Worker's subscription address check, fixed before this scan.

Method as above:
- Each finding was read against the code at `099e02e`: why it was raised, whether it holds, and its other sides (the callers, the environments it runs in, who controls its input).
- Each has one disposition: FIXED, CONSIDERED, REJECTED or DEFERRED.
- "Seen" says whether a row is new, seen again, or at the same file and class as an earlier one.
  "Seen again" means still open from an earlier scan, not reported afresh by this one. "Same file and class"
  means this scan raised a finding at the file and weakness class of an earlier one. "New" means neither.

Advisories: as above, none is owed. No finding reaches the served site or a published package through input from outside the repository, and the one in the Worker is fixed.

| # | Class | Where | Seen | Disposition | Reason |
|---|---|---|---|---|---|
| 1 | uncontrolled resource use (CWE-400) | `scripts/lib/i18n-catalogue.mjs`, the cross-language key comparison | new | FIXED (7a38caf) | more than 16 catalogue files are refused with one named line, not compared pair by pair |
| 2 | super-linear matching (CWE-1333) | `scripts/surface-check.mjs`, the CSS `url()` pattern | new | DEFERRED (one open fix for rows 2, 7, 12 to 15, 17, 18, 21 and 22) | an unquoted body may contain further openers, so a failed match rescans; the body excludes them |
| 3 | uncontrolled resource use (CWE-400) | `scripts/lib/i18n-catalogue.mjs`, catalogue flattening | new | FIXED (7a38caf) | the total key text is bounded at 1 MiB; past it the file is refused with a named line |
| 4 | inefficient algorithm (CWE-407) | `scripts/lib/page-template.mjs`, comment removal | same file and class | DEFERRED (the open fix of rows 1, 6, 8 and 9 above) | the earlier row 6, reworded; the code has not moved |
| 5 | uncontrolled resource use (CWE-400) | `scripts/lib/type-lint.mjs`, the unresolved-variable report | same file and class | FIXED (276eea5) | unresolved-name problems quote 120 characters, 200 names are listed, and the rest are counted in one line |
| 6 | inefficient algorithm (CWE-407) | `scripts/rendered-check.mjs`, the line measurement | same file and class | DEFERRED (the open fix of rows 1, 6, 8 and 9 above) | the earlier row 9, reworded; the code has not moved |
| 7 | inefficient algorithm (CWE-407) | `scripts/lib/rendered-text.mjs`, declaration recovery after an unterminated string | new | DEFERRED (the open fix of row 2) | recovery restarts inside a string already scanned; the scan keeps its position |
| 8 | super-linear matching (CWE-1333) | `scripts/lib/type-lint.mjs`, the declaration pattern | new | FIXED (276eea5) | the declaration value is the rest of its segment, trimmed, read in one pass over the whitespace |
| 9 | uncontrolled resource use (CWE-400) | `scripts/lib/static-server.mjs`, the `_headers` read | new | FIXED (8216038) | the `_headers` file is read through the contained reader: a link that leads outside the root is refused, and a missing file keeps no rules |
| 10 | super-linear matching (CWE-1333) | `scripts/lib/rendered-text.mjs`, the script-string pattern | same file and class | DEFERRED (the open fix of rows 2, 4, 5 and 7 above) | an earlier row at this site, reworded; the code has not moved |
| 11 | super-linear matching (CWE-1333) | `scripts/lib/legal-render.mjs`, comment removal | same file and class | DEFERRED (the open fix of rows 2, 4, 5 and 7 above) | the earlier row 7, reworded |
| 12 | super-linear matching (CWE-1333) | `scripts/surface-check.mjs`, SVG removal | new | DEFERRED (the open fix of row 2) | an opener with no closing tag makes the search rescan the rest; one forward pass replaces it |
| 13 | inefficient algorithm (CWE-407) | `scripts/lib/type-lint.mjs`, nested function inspection | new | DEFERRED (the open fix of row 2) | overlapping bodies are scanned once per opener; each body is scanned once |
| 14 | super-linear matching (CWE-1333) | `scripts/lib/legal-render.mjs`, the link pattern | same file and class | DEFERRED (the open fix of row 2) | a new site in this file: extra openers in a label make a failed match rescan; the label excludes them |
| 15 | uncontrolled resource use (CWE-400) | `scripts/lib/font-coverage.mjs`, the glyph sets per stylesheet address | new | DEFERRED (the open fix of row 2) | each spelling of an address gets its own copy of the character lists; addresses are resolved to one file first |
| 16 | uncontrolled resource use (CWE-400) | `scripts/lib/font-coverage.mjs`, the font file read | new | FIXED (8216038) | the font file is read through the contained reader, which refuses a link that leads outside the root |
| 17 | inefficient algorithm (CWE-407) | `scripts/lib/headers-file.mjs`, the path-pattern match | new | DEFERRED (the open fix of row 2) | the match allocates state the size of the path for each pattern token; the state is shared |
| 18 | super-linear matching (CWE-1333) | `scripts/coderabbit-config.test.mjs`, the glob translation | new | DEFERRED (the open fix of row 2) | runs of wildcards become ambiguous quantifiers; they are collapsed first |
| 19 | super-linear matching (CWE-1333) | `scripts/lib/font-coverage.mjs` (`facesOf`) | same file and class | DEFERRED (the open fix of rows 2, 4, 5 and 7 above) | the earlier row 2, reworded |
| 20 | browser confinement | `scripts/lib/browser.mjs`, request interception | new | CONSIDERED | true: the interception does not see WebSocket connections. The page's own Content-Security-Policy is the control that blocks them, and it is tested; no browser-level block held on the CI runner's browser |
| 21 | uncontrolled resource use (CWE-400) | `scripts/lib/domain-seams.mjs`, the reserved-key report | new | DEFERRED (the open fix of row 2) | each message carries the full ancestor path and the walk continues below the key; the walk stops there |
| 22 | super-linear matching (CWE-1333) | `scripts/lib/domain-seams.mjs`, the cookie-write pattern | new | DEFERRED (the open fix of row 2) | a failed destructuring candidate makes the match rescan a long suffix; the pattern is anchored |
| 23 | uncontrolled resource use (CWE-400) | `scripts/coderabbit-config.test.mjs` (`expandBraces`) | same file and class | DEFERRED (the open fix of rows 1, 6, 8 and 9 above) | the earlier row 1, reworded |
| 24 | super-linear matching (CWE-1333) | `scripts/address-check.mjs` (`addressesIn`) | same file and class | DEFERRED (the open fix of rows 2, 4, 5 and 7 above) | the earlier row 4, reworded |
| 25 | super-linear matching (CWE-1333) | `worker/index.mjs` (`emailShape`) | seen again | FIXED (a15186e) | the earlier row 3; an address over 254 characters is refused before one linear pass |
| 26 | super-linear matching (CWE-1333) | `scripts/sitemap-lastmod.mjs` (`strip`) | seen again | DEFERRED (the open fix of rows 2, 4, 5 and 7 above) | the earlier row 5 |
| 27 | inefficient algorithm (CWE-407) | `scripts/surface-check.mjs` (`blank`) | seen again | DEFERRED (the open fix of rows 1, 6, 8 and 9 above) | the earlier row 8 |
| 28 | uncontrolled resource use (CWE-400) | `scripts/lib/woff2-cmap.mjs`, range expansion | seen again | FIXED (f168e05) | the October rows; the reader bounds every size its font declares |
| 29 | uncontrolled resource use (CWE-400) | `scripts/page-weight.mjs`, the stylesheet queue | seen again | FIXED (def04ae) | the queue is keyed by the real path |
| 30 | super-linear matching (CWE-1333) | `scripts/post-deploy-check.mjs`, script removal | seen again | FIXED (f168e05) | the October row; removal is one forward pass |
| 31 | uncontrolled resource use (CWE-400) | `scripts/page-weight.mjs`, the asset read | seen again | FIXED (def04ae) | the read goes through the contained reader: inside the root, a regular file, bounded |
| 32 | uncontrolled resource use (CWE-400) | `scripts/sitemap-lastmod.mjs`, the page read | seen again | FIXED (def04ae) | the same contained reader |
| 33 | uncontrolled resource use (CWE-400) | `scripts/lib/woff2-cmap.mjs`, name records | seen again | FIXED (f168e05) | the name records have a byte limit |
| 34 | decompression bomb (CWE-409) | `scripts/lib/woff2-cmap.mjs`, decompression | seen again | FIXED (f168e05) | the output is capped at the sizes the font's directory declares |
| 35 | uncontrolled resource use (CWE-400) | `scripts/lib/type-lint.mjs`, variable expansion | seen again | FIXED (f168e05) | expansion is memoised with an output budget, and the memo honours depth since 21b3afd |

**No longer listed (10):**
- 3 were fixed:
  - the `_headers` parser's dropped removal lines (`scripts/lib/headers-file.mjs`, 9e09d25 and 0efffc2);
  - the path matcher's wildcards (`scripts/lib/headers-file.mjs`, f168e05);
  - the browser's loopback reach (`scripts/lib/browser.mjs`, f168e05).
- 7 were renamed, not fixed: listed again in this batch, reworded, as rows 4, 6, 10, 11, 19, 23 and 24.

Count: FIXED 15, CONSIDERED 1, REJECTED 0, DEFERRED 19. Advisories owed: 0.
