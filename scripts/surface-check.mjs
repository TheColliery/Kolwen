// Kolwen surface check — the room's own laws, mechanised.
//
// This repo's risk is not broken code: one zero-dependency generator is the only executable of
// consequence. Its risk is a FALSE PUBLIC CLAIM. Every assertion below is a rule the room
// already holds and has already caught a violation of. Zero dependencies, Node built-ins only.
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const fail = [];
const note = (f, msg) => fail.push(`${f}: ${msg}`);

const tracked = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);

// Binary only. SVG is TEXT — hand-editable XML, tracked, and served at kolwen.com/favicon.svg,
// so it is exactly the kind of file a path or a private name gets pasted into. The dot is
// escaped: unescaped, the class also swallowed any name merely ENDING in those letters.
const isBinary = f => /\.(png|ico|woff2?|ttf)$/i.test(f);

// SCOPE. These rules police PUBLISHED CLAIMS — what a reader of the site, the README, the brand
// doc or the PyPI page sees. One exclusion, load-bearing: a checker must be able to NAME the
// strings it forbids, and scanning itself makes every rule its own violation.
const SELF = 'scripts/surface-check.mjs';
const isText = f => !isBinary(f);
const PUBLISHED = f => isText(f) && f !== SELF && !f.startsWith('.github/') && !f.startsWith('scripts/');
const SCANNABLE = f => isText(f) && f !== SELF;   // leak rules run wider than claim rules
const read = f => readFileSync(f, 'utf8');

// ── 1. Trademark: FILED, never registered ────────────────────────────────────
for (const f of tracked.filter(PUBLISHED)) {
  const s = read(f);
  if (s.includes('®')) note(f, 'contains the registered-trademark symbol — the mark is FILED');
  // "not yet registered" is the CORRECT claim — flag an AFFIRMATIVE assertion only.
  for (const m of s.matchAll(/(.{0,24})\bregistered\b/gi)) {
    if (!/(not|never|yet)\s*(yet\s*)?$/i.test(m[1])) note(f, 'asserts the mark is registered — it is FILED');
  }
  // Thai gets a PATTERN, not one literal: several phrasings assert the same false status.
  if (/จดทะเบียน(แล้ว|เรียบร้อย|สมบูรณ์)|ได้รับการจดทะเบียน/.test(s)) note(f, 'claims in Thai that the mark is already registered');
}

// ── 2. No trademark filing identifier on a published surface ─────────────────
// STRUCTURAL, and deliberately so: naming the identifiers here would publish them in this very
// file, in a public permanent repo — the defect this rule exists to prevent. A long digit run
// has no legitimate use on any published surface in this repo (verified: zero occurrences), so
// the shape is the rule. It also catches identifiers nobody thought to tell this checker about.
// A content digest is not an identifier: a sha256 is 64 hex characters and, by chance, carries a run
// of nine or more decimal digits in roughly one digest in four (3 of the 16 in the pinned requirements
// file, LWK-177, had one, of 10, 14 and 15 digits). Publishing that file reddened the required
// surface job on a hash, and every re-pin would have done it again.
// So a digest is removed BEFORE the digit-run test, and only a digest: an algorithm prefix followed
// by EXACTLY that algorithm's length in hex characters, and nothing hex after it. Lengths are fixed
// by the algorithms, not chosen here. The first version accepted "32 or more" behind any prefix,
// which stripped a filing identifier padded with hex filler to 32+ characters, whole, before the
// test ever saw it (LWK-184, final inspect R1). A bare 9+ digit run anywhere else, one glued to a
// short prefix, and one behind the WRONG length for its prefix all still trip the rule.
// HONEST LIMIT of any shape-based strip: a payload padded to exactly the algorithm's length is
// indistinguishable from a real digest by shape alone. That needs deliberate construction, and the
// accident this rule guards against never arrives dressed that way; it is named here rather than
// left for the next reader to discover.
const DIGEST_HEX = { md5: 32, sha1: 40, sha224: 56, sha256: 64, sha384: 96, sha512: 128 };
const DIGEST = new RegExp('\\b(?:' + Object.entries(DIGEST_HEX).map(([a, n]) => `${a}:[0-9a-f]{${n}}`).join('|') + ')(?![0-9a-f])', 'gi');
for (const f of tracked.filter(PUBLISHED)) {
  const runs = read(f).replace(DIGEST, '').match(/\d{9,}/g);
  if (runs) note(f, `contains a ${runs[0].length}-digit identifier-shaped number — filing identifiers are owner-deferred from every public surface`);
}

// ── 3. No kitchen leakage ────────────────────────────────────────────────────
// NO leading \b: it is a word-boundary assertion, and against a branch beginning with "." it can
// never hold at a whitespace or line start — which silently disabled the .claude/ branch, the
// single most common internal prefix in this flock. Each branch is distinctive on its own.
const KITCHEN = /(coalkiln|LLMWorks\/|_work\/|\.claude\/|scratchpad\/|agent-memory\/)/i;
// LICENSE files are EXEMPT for the brand-name rule ONLY: a trademark-reservation clause must
// name the names it reserves. That is the clause's whole function.
const RESERVATION_EXEMPT = new Set(['LICENSE', 'py/LICENSE']);
// .gitignore must NAME the paths it fences — the fence is not a leak.
const PATH_EXEMPT = new Set(['.gitignore']);
for (const f of tracked.filter(SCANNABLE)) {
  const s = read(f);
  if (!PATH_EXEMPT.has(f) && KITCHEN.test(s)) note(f, 'contains an internal path or private-repo reference');
  if (!RESERVATION_EXEMPT.has(f) && /\bBankfire\b/.test(s)) note(f, 'names the private repo outside a licence reservation clause');
  // LWK-168: this was `[A-Za-z]:\Users\|...` — `\U` is an identity escape and `\|` a LITERAL pipe,
  // so there was no alternation at all and the pattern matched a string no file contains. The rule
  // was published as enforced and could never fire. Backslashes are doubled so the Windows branch
  // means a real backslash, and the `|` is a real alternation between the Windows and macOS homes.
  if (/[A-Za-z]:\\Users\\|\/Users\/[a-z0-9]+\//i.test(s)) note(f, 'contains an absolute local path');
}

// ── 4. Thai orthography ──────────────────────────────────────────────────────
for (const f of tracked.filter(PUBLISHED)) {
  const s = read(f);
  if (/ํา/.test(s)) note(f, 'decomposed SARA AM (U+0E4D U+0E32) — must be U+0E33');
  for (const cp of [0x200B, 0x200C, 0x200D, 0x00A0, 0xFEFF]) {
    if (s.includes(String.fromCodePoint(cp))) note(f, `invisible character U+${cp.toString(16).toUpperCase()}`);
  }
  if (s.includes('…')) note(f, 'U+2026 ellipsis — use three ASCII dots');
}

// ── 5. web/index.html integrity + bilingual STRUCTURE ────────────────────────
// Named "structure", not "parity": these assert that both language blocks exist and that the
// right one is default-visible. They do NOT compare the two blocks claim-for-claim. A real
// parity assertion is a separate unit; until it exists the weaker name is the true one.
if (existsSync('web/index.html')) {
  const s = read('web/index.html');
  for (const t of ['html','head','body','main','nav','footer','div','span','p','h1','h2','a','button','script','style','noscript','svg']) {
    const o = (s.match(new RegExp('<' + t + '(?=[ >\n/])', 'g')) || []).length;
    const c = (s.match(new RegExp('</' + t + '>', 'g')) || []).length;
    if (o !== c) note('web/index.html', `unbalanced <${t}>: ${o} open, ${c} close`);
  }
  const ld = s.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!ld) note('web/index.html', 'structured-data block missing');
  else { try { JSON.parse(ld[1]); } catch (e) { note('web/index.html', 'ld+json does not parse: ' + e.message); } }
  if (!/<html lang="en">/.test(s)) note('web/index.html', 'default document language is not English');
  if (!/id="doc-th"[^>]*\shidden/.test(s)) note('web/index.html', 'Thai block is not hidden by default');
  if (/id="doc-en"[^>]*\shidden/.test(s)) note('web/index.html', 'English block is hidden by default');
  if (!/mailto:info@kolwen\.com/.test(s)) note('web/index.html', 'the published contact channel is missing');
}

// ── 6. Every contrast ratio in the brand doc recomputes from its own hex pair ─
if (existsSync('brand/README.md')) {
  const lin = c => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const L = h => { const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
  const ratio = (a, b) => { const [x, y] = [L(a), L(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const PAIRS = [['#e8833a','#15130f'],['#A65A19','#ffffff'],['#e8833a','#ffffff'],['#A65A19','#15130f'],['#A65A19','#ece4d9'],['#A65A19','#f1f1f1']];
  const THRESHOLDS = new Set(['3', '4.5', '7']);   // WCAG's own bars, not measurements of a pair
  const doc = read('brand/README.md');
  const stated = [...new Set(doc.match(/\b\d+(?:\.\d+)?:1/g) || [])].map(t => t.slice(0, -2)).filter(t => !THRESHOLDS.has(t));
  // LWK-168: a doc that states no measured ratio (the figures deleted, or written in a shape the
  // pattern above no longer reads) made this loop run over nothing and the rule pass silently.
  // LWK-183: the message names what the READER of a red run can do. It used to tell them to
  // "retire the rule", which a contributor who only edits docs cannot; the maintainer can.
  if (stated.length === 0) note('brand/README.md', 'states no measured contrast ratio (n:1), so rule 6 recomputed nothing — this CHECK is now empty, not the brand doc\'s colours proven. Restore the ratio table in brand/README.md (each figure written as n:1); if the figures were removed on purpose, ask the maintainer to retire rule 6 in scripts/surface-check.mjs');
  for (const t of stated) {
    // <= : a correctly-rounded 2-decimal figure sits at most 0.005 from its true value, so a
    // strict < reds a correct document at exactly the rounding boundary.
    const ok = PAIRS.some(([a, b]) => Math.abs(ratio(a, b) - Number(t)) <= 0.005);
    if (!ok) note('brand/README.md', `states ${t}:1, which no documented colour pair produces`);
  }
} else {
  // The brand authority doc is this room's own law (CLAUDE.md); a missing one used to switch the
  // whole contrast rule off without a word.
  note('brand/README.md', 'is missing — rule 6 (contrast ratios) has nothing to check, so this CHECK is now empty, not the colours proven. Restore brand/README.md; if it was removed on purpose, ask the maintainer to retire rule 6 in scripts/surface-check.mjs');
}

// ── 7. The publish root ships only shipped assets ────────────────────────────
// `wrangler.jsonc` publishes ./web wholesale as `assets.directory`, so EVERY path under web/
// is a live URL on kolwen.com. A scratch tree once sat at web/scratchpad/design/kolwen-ds
// (empty, so nothing ever leaked) — an invitation to save a working file into the publish root.
//
// HONEST SCOPE, because the two deploy paths differ and only one of them any CI can see:
// Workers Builds clones the REPO, so it ships tracked files only — which is exactly what this
// allowlist governs. A manual local `wrangler deploy` uploads the local DIRECTORY, untracked
// files included, and no check running in CI can see those. That half is closed by the scratch
// tree no longer existing under web/, not by this rule.
const SHIPPED = new Set([
  'web/index.html', 'web/robots.txt', 'web/sitemap.xml', 'web/ic.json',
  // Added BY NAME, never by widening the glob — the point of the list is that a new path under
  // web/ is a deliberate act. `404.html` is served for an unmatched request (not_found_handling:
  // 404-page). `_headers` is PARSED by Workers and, per Cloudflare's own docs, "will not itself
  // be served as a static asset" — shipped but never fetchable, which post-deploy-check must
  // also know.
  'web/404.html', 'web/_headers',
  'web/favicon.svg', 'web/favicon-32.png', 'web/apple-touch-icon.png', 'web/og.png',
]);
for (const f of tracked.filter(f => f.startsWith('web/'))) {
  if (!SHIPPED.has(f)) note(f, 'is tracked under the publish root but is not a declared shipped asset — every path under web/ is a live URL');
}
for (const f of SHIPPED) {
  if (!existsSync(f)) note(f, 'is declared a shipped asset but is missing from the publish root');
}


// ── 8. The wrangler values this checker depends on are CONFIRMED, not assumed ─────────────
// Rule 7 governs `web/` because wrangler publishes it, and post-deploy-check reads the same
// directory. Until now both facts lived only in a COMMENT: a one-word config change could
// falsify three artefacts with every gate still green (the r17 finding). Now the file is read.
{
  const w = read('wrangler.jsonc');
  // JSONC: comments make JSON.parse unsafe here, so the two values are matched as TEXT. A
  // duplicate key, or the same text inside a comment, would defeat this — stated rather than
  // pretended away; this guards against silent drift, not against a hostile edit.
  if (!/"directory"\s*:\s*"\.\/web"/.test(w)) {
    note('wrangler.jsonc', 'assets.directory is not "./web" — surface-check rule 7 and post-deploy-check both assume it is');
  }
  const nf = w.match(/"not_found_handling"\s*:\s*"([^"]+)"/);
  if (!nf) {
    note('wrangler.jsonc', 'assets.not_found_handling is absent — the behaviour of an unmatched path is then undeclared');
  } else if (!['404-page', 'single-page-application'].includes(nf[1])) {
    note('wrangler.jsonc', `assets.not_found_handling is "${nf[1]}", which is not one of the two documented values`);
  }
}

// ── 9. Nothing retypes the IC label ──────────────────────────────────────────
// docs/NEVER-A-CLONE.md: `web/ic.json` is the ONE source of truth, and "nothing retypes these
// values anywhere" — a retyped label can disagree with the file the day the IC is swapped. That
// sentence had no machine behind it. The values are read from the file at run time, never pasted
// here: a copy in this checker would be the very retype it forbids, and this file is scanned too.
if (existsSync('web/ic.json')) {
  let ic = null;
  try { ic = JSON.parse(read('web/ic.json')); } catch (e) { note('web/ic.json', 'does not parse: ' + e.message); }
  // LWK-182: the SCHEMA is declared in the file, and this rule asserts what the file declares --
  // never a key list of its own. `$required_text` names the keys that must always hold non-empty
  // text. Before it existed the rule could only guard whichever keys happened to be non-empty, so
  // emptying ONE label left the other guarding and the emptied one silently unguarded; and a rule
  // enforcing a schema nobody had written down would have been an invention, not a check.
  // An unparseable file is already a finding, above.
  let labels = [];
  if (ic) {
    const req = ic.$required_text;
    if (!Array.isArray(req) || req.length === 0 || !req.every(k => typeof k === 'string' && k)) {
      note('web/ic.json', 'does not declare `$required_text` (a non-empty list of the keys that must hold text), so rule 9 has no schema to assert — an undeclared schema is a finding, not a pass');
    } else {
      for (const k of req) {
        if (typeof ic[k] !== 'string' || !ic[k].trim()) note('web/ic.json', `declares "${k}" as required text, but it is empty or missing — the product would show no label, and a retype of the old one would pass unseen`);
      }
      labels = req.map(k => ic[k]).filter(v => typeof v === 'string' && v.trim());
    }
  }
  for (const f of tracked.filter(f => isText(f) && f !== 'web/ic.json')) {
    const s = read(f);
    if (labels.some(v => s.includes(v))) note(f, 'retypes the IC label from web/ic.json — read it from that file, never copy it');
  }
}

// ── 10. Every legal GAP in a legal draft carries its counsel-pending marker ──
// LWK-168 (re-inspect M1), extended to TERMS.md by LWK-185. The draft privacy notice and the draft
// terms are published as DRAFTS precisely because clauses that need a lawyer carry a
// `[pending legal review]` marker instead of an answer. The check every seat ran was a single-line
// grep for that marker: it returned 5 against a real 6, because GAP 3's marker wraps across a line
// break. Delete that marker and the grep still said 5 -- a legal gap lost the mark saying counsel
// had not cleared it and every instrument reported clean.
//
// So this COUNTS AND ASSERTS, and it asserts against each document's own GAPs, never a fixed
// number (which rots the day a gap is added or closed): every distinct `GAP n` the document names
// must have the marker beside it, whitespace and line breaks inside the marker allowed. It names
// WHICH gap lost one. A document that names no GAP is a finding, not a pass -- the rule would be
// empty -- and so is a missing one. Only a document's LABELLED gaps bind: a prose sentence that
// merely describes what the marker means (a draft header) is not a gap and is never counted as one.
// The Thai marker is deliberately NOT asserted per gap (the Thai rides as short blockquotes, not a
// parallel legal text); it is only counted wrap-aware and reported.
const LEGAL_DRAFTS = ['PRIVACY.md', 'TERMS.md'];
const gapNotes = [];
for (const doc of LEGAL_DRAFTS) {
  if (!existsSync(doc)) {
    note(doc, `is missing — rule 10 (legal-gap markers) has nothing to check, so this CHECK is now empty, not the gaps proven. Restore ${doc}; if it was removed on purpose, ask the maintainer to take it out of rule 10 in scripts/surface-check.mjs`);
    continue;
  }
  const s = read(doc);
  const gaps = [...new Set([...s.matchAll(/\bGAP\s+(\d+)\b/g)].map(m => m[1]))];
  if (gaps.length === 0) note(doc, `names no "GAP n", so rule 10 checked nothing — this CHECK is now empty, not the gaps proven. Restore the "GAP n" labels beside the counsel-pending clauses; if they were renumbered or reworded on purpose, ask the maintainer to update rule 10 in scripts/surface-check.mjs`);
  for (const n of gaps) {
    // The class between label and marker admits a backtick: a literal token in markdown is
    // written `[pending legal review]`, and this instrument must not dictate how a published legal
    // sentence is typeset. (LWK-184 T1: without it a correct, backticked marker went red with a
    // message claiming the marker was MISSING.)
    if (!new RegExp('GAP\\s+' + n + '[\\s`—–:*.-]*\\[pending\\s+legal\\s+review\\]').test(s)) {
      note(doc, `GAP ${n} has no [pending legal review] marker beside it — counsel has not cleared it, and the document no longer says so`);
    }
  }
  const en = (s.match(/\[pending\s+legal\s+review\]/g) || []).length;
  const th = (s.match(/\[\s*รอ\s*ที่ปรึกษา\s*กฎหมาย\s*\]/g) || []).length;
  gapNotes.push(`${doc} ${gaps.length} named GAPs (markers, wrap-aware: ${en} English, ${th} Thai)`);
}
const gapNote = gapNotes.length ? ' · ' + gapNotes.join(' · ') : '';

// ── 11. A job-level `permissions:` block that checks out states `contents` ───
// LWK-190. A job-level `permissions:` block REPLACES the workflow-level one rather than merging
// with it: a job that checks the repository out and declares its own block without `contents`
// reads `contents: none` inside that job. This has hit three workflows so far (`publish-pypi.yml`,
// `codeql.yml`, `scorecard.yml`), every one found and fixed by a HAND-RUN structural scan, which
// is not a gate. This is that gate: a tiny structural reader, not a YAML library (a `jobs:`
// top-level entry at 2-space indent starts a job; a `permissions:` key at 4-space indent under it
// is that job's own block; its members sit past 4-space indent). A job with NO block of its own
// inherits the workflow-level one and is not checked — that is correct, not a hole.
//
// Non-vacuity, the same discipline rules 6/9/10 already carry, and PER FILE (LWK-190 F1): a
// workflow with zero jobs is invalid to GitHub, so a file this reader parses to zero jobs is a
// finding naming THAT file, never folded into one global note that a single parseable workflow
// elsewhere would silence. `.yaml` is read alongside `.yml` (F2) — GitHub reads both, and a file
// this reader never even opens cannot become an F1 finding either; the two cures are independent.
// The block scan skips blank and comment lines while looking for `contents:` and a `#`-led line is
// never read as a real `uses: actions/checkout@` (F4) — a checker must not flag a document for its
// OWN formatting choices, the exact class this room already hardened rule 10 against. `{}` reads as
// an empty block (no contents, same as the bare-word class); `read-all`/`write-all` read as
// granting contents, per GitHub's own docs (F3).
//
// STATED LIMIT, not fixed here (a LOW unit does not grow this into a YAML parser): a job key at
// other than 2-space indent, or a quoted job key, is not recognised as a job at all -- such a file
// now surfaces as "parsed to zero jobs" (a finding, per F1) rather than silently passing, but its
// jobs are still not individually checked. A composite or reusable workflow step
// (`uses: ./.github/actions/x`) is never read as a checkout -- scoped to `actions/checkout@`
// on purpose; this repo has no composite actions today.
{
  const WF_DIR = '.github/workflows';
  const wfFiles = tracked.filter(f => f.startsWith(WF_DIR + '/') && (f.endsWith('.yml') || f.endsWith('.yaml')));
  if (wfFiles.length === 0) {
    note(WF_DIR, 'has no tracked *.yml or *.yaml workflow, so rule 11 (job-level permissions) checked nothing');
  } else {
    for (const f of wfFiles) {
      const lines = read(f).split('\n');
      let inJobs = false, cur = null;
      const jobs = [];
      const flush = () => { if (cur) jobs.push(cur); };
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (/^jobs:\s*$/.test(l)) { inJobs = true; continue; }
        if (!inJobs) continue;
        const j = l.match(/^  ([A-Za-z0-9_.-]+):\s*$/);
        if (j) { flush(); cur = { name: j[1], hasBlock: false, checkout: false, contents: false }; continue; }
        if (!cur) continue;
        if (/^    permissions:\s*\{\s*\}\s*$/.test(l)) {
          cur.hasBlock = true;                                  // `{}` -- nothing specified, contents: none
        } else if (/^    permissions:\s*(read-all|write-all)\s*$/.test(l)) {
          cur.hasBlock = true; cur.contents = true;             // the whole-set inline forms grant contents
        } else if (/^    permissions:\s*$/.test(l)) {
          // the multi-line block form: scan its members past this line
          cur.hasBlock = true;
          for (let k = i + 1; k < lines.length; k++) {
            const m = lines[k];
            if (/^\s*$/.test(m)) continue;                     // blank line inside the block: keep scanning
            const trimmed = m.replace(/^\s+/, '');
            if (trimmed.startsWith('#')) continue;              // a comment at ANY indent: keep scanning
            const indent = m.length - trimmed.length;
            if (indent <= 4) break;                             // back to job level or the next key
            if (/^contents:/.test(trimmed)) cur.contents = true;
          }
        }
        const lineTrimmed = l.replace(/^\s+/, '');
        if (!lineTrimmed.startsWith('#') && /uses:\s*actions\/checkout@/.test(l)) cur.checkout = true;
      }
      flush();
      if (jobs.length === 0) {
        note(f, 'parsed to zero jobs under this reader\'s narrow job-key shape (exactly 2-space indent, an unquoted key, nothing after the colon) -- rule 11 could not check any job in this file');
        continue;
      }
      for (const j of jobs) {
        if (j.hasBlock && j.checkout && !j.contents) {
          note(f, `job "${j.name}" declares its own permissions: block and checks the repository out, but does not state contents: -- contents reads none inside that job`);
        }
      }
    }
  }
}

// ── 12. The retired contact address never returns to a published file ──────
// LWK-209. The role addresses replaced one address at this domain as the published contact; that
// address is retired, and the published channels are the role addresses.
// Rule 5 only EXPECTS the page's info@ link, which proves nothing about the retired address coming
// back. This bans it outright, with ZERO allowlist: no published file has a legitimate reason to
// carry it, so the ban itself is the proof it cannot return.
//
// SET: SCANNABLE, the same wide set rule 3 uses for leaks -- every tracked text file except this one,
// so `.github/`, `scripts/`, `docs/`, `governance/`, the root documents and the text under `web/`
// are all in scope. Wider than PUBLISHED on purpose: this is a leak, not a claim, and the repo is
// public whatever folder a file sits in.
//
// The pattern is built from FRAGMENTS, and no message prints a match: this file is scanned by
// nothing, but it is itself published, and a CI log is public.
//
// Spellings caught (case-insensitive): plain, full-width (U+FF20), percent-encoded, HTML numeric and
// named entities, a JS/JSON escape, and the `[at]` / `(at)` word with spaces or tabs around it.
//
// NON-VACUITY, three parts, because this room's scar is a gate that lies: (a) every spelling above is
// run through its own pattern AT RUN TIME, so a pattern that cannot fire fails the build by name;
// (b) a set of near-misses must NOT match, so an over-broad pattern fails the same way; (c) an empty
// scanned set, or one that lacks any of five anchor files (three a reader meets, two outside the
// PUBLISHED set), is a finding, not a pass.
//
// STATED LIMITS, not fixed here: an IMAGE of the address (png/ico/font files are never read, og.png
// included); an address split across two lines (the bracket form tolerates spaces and tabs only);
// the local part or the domain obfuscated (`[dot]`, entity-encoded letters, a string assembled by
// concatenation in script); double encoding (`%2540`); base64 or any other wrapper; any surface
// outside this repository (registry metadata, a dashboard, an edge rule); and git HISTORY: the rule
// reads the tree, and the address stays in commits made before it was retired. A different address
// at another host, or a subdomain of this one, is a different address and is deliberately not matched.
//
// CODEQL (js/regex/missing-regexp-anchor, alert on the HOST fragment, LWK-209 bounce 1). The query
// treats a constant string that ends in a top-level domain as a hostname pattern and fires when no
// `^` or `$` appears anywhere in it; it reads each constant fragment that flows into a RegExp on its
// own, and this fragment is a hostname by construction. This is a detector, not a URL validator, but
// the alert is fixed rather than dismissed, by ANCHORING it in the form the query recognises: the
// fragment now ends `(?:$|...)`. The `$|` branch is semantically redundant (a negative lookahead
// already holds at the end of the input, and there is no `m` flag), and is there so the fragment
// carries an explicit end anchor. Read at the query source (github/codeql main, 2026-09-25); NOT
// verified by running CodeQL here, so the PR's own CodeQL run is the verification.
{
  const LOCAL = 'con' + 'tact';
  // Start of the local part: not preceded by a character of an address's own alphabet (a longer
  // local part is a different address), EXCEPT right after an escape, whose last character is
  // alphanumeric: `%20`, `%3A`, a backslash then n, r or t, a backslash-u and four hex digits.
  const START = '(?:(?<![A-Za-z0-9._%+-])|(?<=%[0-9A-Fa-f]{2})|(?<=\\\\[nrt])|(?<=\\\\u[0-9A-Fa-f]{4}))';
  // End of the domain: the end of the input, or not followed by a longer domain (`-x`, `x`) and not
  // followed by a dot and more label characters (`.au`), while a sentence-final dot is still a match.
  const HOST = 'kol' + 'wen\\.' + 'com' + '(?:$|(?![A-Za-z0-9-])(?!\\.[A-Za-z0-9]))';
  const SEPARATORS = {
    'plain @': '@',
    'full-width @ (U+FF20)': '＠',
    'percent-encoded @': '%40',
    'HTML numeric entity for @': '&#0*64;?|&#x0*40;?',
    'HTML named entity for @': '&commat;?',
    'JS/JSON escape for @': '\\\\u0*40|\\\\x40',
    '[at] / (at) word': '[ \\t]*[\\[(][ \\t]*at[ \\t]*[\\])][ \\t]*',
  };
  // START stops a longer local part (a different address) matching; HOST's tail stops a longer
  // domain doing the same.
  const FORMS = Object.entries(SEPARATORS).map(([label, sep]) => [
    label,
    new RegExp(START + LOCAL + '(?:' + sep + ')' + HOST, 'i'),
  ]);

  // Fixtures use their OWN fragments, not LOCAL/HOST above: a fixture derived from the same constant as the
  // pattern would pass with the pattern wrong (a typo in both), which is the circular self-check this avoids.
  const LF = 'cont' + 'act';
  const H = 'kol' + 'wen.com';
  const SHOULD_MATCH = [
    ['plain @', `${LF}@${H}`],
    ['plain @', `<a href="mailto:${LF}@${H}">`],
    ['plain @', `${LF.toUpperCase()}@${H.toUpperCase()}`],
    ['full-width @ (U+FF20)', `${LF}${String.fromCodePoint(0xFF20)}${H}`],
    ['percent-encoded @', `mailto:${LF}%40${H}`],
    ['HTML numeric entity for @', `${LF}&#64;${H}`],
    ['HTML numeric entity for @', `${LF}&#x40;${H}`],
    ['HTML numeric entity for @', `${LF}&#X0040;${H}`],
    ['HTML named entity for @', `${LF}&commat;${H}`],
    ['JS/JSON escape for @', `"${LF}\\u0040${H}"`],
    ['[at] / (at) word', `${LF}[at]${H}`],
    ['[at] / (at) word', `${LF} (at) ${H}`],
    ['[at] / (at) word', `${LF}[ AT ]${H}`],
    // After an escape whose last character is alphanumeric, and at a sentence end or end of input.
    ['percent-encoded @', `mailto:%20${LF}%40${H}`],
    ['plain @', `?body=Write%20to%20${LF}@${H}`],
    ['plain @', `"x\\n${LF}@${H}"`],
    ['plain @', `"x\\u0020${LF}@${H}"`],
    ['plain @', `write to ${LF}@${H}.`],
    ['plain @', `${LF}@${H}. Next sentence`],
  ];
  const SHOULD_NOT_MATCH = [
    `info@${H}`, `security@${H}`, `privacy@${H}`,
    `${LF}@example.com`, `${LF}@${H}any`, `re${LF}@${H}`, `${LF}@mail.${H}`,
    `${LF}${H}`, `hello (at) ${H}`, `${LF} at ${H}`,
    // A longer domain behind a dot, and an escape-lookalike that is a longer local part.
    `${LF}@${H}.au`, `${LF}@${H}.co.uk`, `%2${LF}@${H}`, `\\x${LF}@${H}`,
  ];
  const cannotFire = new Set(), overBroad = new Set();
  for (const [label, sample] of SHOULD_MATCH) {
    const re = FORMS.find(([l]) => l === label)?.[1];
    if (!re || !re.test(sample)) cannotFire.add(label);
  }
  for (const sample of SHOULD_NOT_MATCH) {
    const hit = FORMS.find(([, re]) => re.test(sample));
    if (hit) overBroad.add(hit[0]);
  }
  for (const label of cannotFire) note(SELF, `rule 12 self-check: the "${label}" pattern does not match its own fixture, so it could never fire — a ban that cannot fire is not a ban`);
  for (const label of overBroad) note(SELF, `rule 12 self-check: the "${label}" pattern matches a near-miss that is not the banned address, so it is over-broad`);

  const scanned = tracked.filter(SCANNABLE);
  if (scanned.length === 0) {
    note('git ls-files', 'lists no scannable text file, so rule 12 checked nothing — this CHECK is now empty, not the surface proven clean');
  }
  // The first three are PUBLISHED files a reader meets. The last two sit OUTSIDE the PUBLISHED set
  // (`.github/`, `scripts/`), so narrowing the scan to PUBLISHED fails here instead of passing silently.
  for (const anchor of ['web/index.html', 'README.md', 'CHANGELOG.md', '.github/workflows/ci.yml', 'scripts/post-deploy-check.mjs']) {
    if (!scanned.includes(anchor)) note(anchor, 'is not among the files rule 12 scans (missing, untracked or excluded), so this CHECK does not cover a surface a reader meets');
  }
  for (const f of scanned) {
    const s = read(f);
    for (const [label, re] of FORMS) {
      const m = re.exec(s);
      if (m) note(f, `line ${s.slice(0, m.index).split('\n').length}: the retired contact address appears (${label}) — use a role address`);
    }
  }
}

// ── 13. The CSP admits exactly the inline code the served pages carry ───────
// LWK-211. `web/_headers` admits the page's one inline script, and its inline styles, by `sha256-`
// hash. A hash is a claim about bytes: change one byte of the script and the browser silently refuses
// to run it, the language toggle dies, and every other check stays green. So the hashes are RECOMPUTED
// here from the served HTML and compared, both ways: a missing hash breaks the page, and an extra one is
// a stale hash that admits nothing, which reads as coverage.
//
// It also refuses a policy that has lost its floor: `'unsafe-inline'` or `'unsafe-eval'` in `script-src`
// (or in `default-src`, which `script-src` falls back to if it is ever deleted), a missing
// `default-src 'self'` / `object-src 'none'` / `base-uri 'self'` / `frame-ancestors 'none'`, the CSP on
// more than one rule (Cloudflare JOINS a header set twice, so two policies would be served), the CSP on
// any path but `/*` (the 404 served for an unmatched path is not `/404.html`), a Referrer-Policy other than
// strict-origin-when-cross-origin, a missing Permissions-Policy, a CSP set in a `<meta>` tag, an origin
// the HTML loads a stylesheet or script from that the policy does not name, and an inline event handler
// or `style=` attribute, which this policy blocks silently. Cloudflare's caps on the file are checked too
// (100 rules, 2,000 characters a line).
//
// NON-VACUITY: no `_headers`, no CSP in it, no inline script or no inline style found in the served HTML,
// or a served page the rule was written around missing, is a finding, never a pass. The script and style
// counts are printed in the pass line, so a run that hashed nothing cannot read as a run that did.
//
// STATED LIMITS, not fixed here: the HTML is read as text, not parsed, so a script or style inside an
// HTML comment is counted (it fails safe, demanding a hash it does not need); `font-src` origins come from
// the CSS a stylesheet loads, which this rule cannot see, so that directive is checked by hand against the
// served stylesheet, not here; `style-src` carrying `'unsafe-inline'` is not refused (a hash makes browsers
// ignore it); nothing the edge injects into the response is in the repo, so nothing here can see it (the
// post-deploy check reads the served headers, and `_headers` says what the edge adds); and whether the
// served response really carries these headers is the post-deploy check's job, not this rule's.
const CSP_STATS = { scripts: 0, styles: 0 };
{
  const HEADERS = 'web/_headers';
  const ANCHOR_PAGES = ['web/index.html', 'web/404.html'];
  const DATA_TYPES = new Set(['application/ld+json', 'application/json']);
  const EXEC_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'module']);
  const htmlFiles = tracked.filter(f => f.startsWith('web/') && f.endsWith('.html'));
  for (const p of ANCHOR_PAGES) if (!htmlFiles.includes(p)) note(p, 'is not a tracked HTML page, so rule 13 has nothing to hash for it — this CHECK is now empty for that page, not the page proven covered');

  const sha256 = text => "'sha256-" + createHash('sha256').update(text, 'utf8').digest('base64') + "'";
  const want = { script: new Set(), style: new Set() };
  const origins = { script: new Set(), style: new Set() };
  for (const f of htmlFiles) {
    const s = read(f).replace(/\r\n/g, '\n');
    for (const m of s.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const src = (m[1].match(/\bsrc\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
      if (src) { const o = src.match(/^https?:\/\/[^/]+/i); if (o) origins.script.add(o[0].toLowerCase()); continue; }
      const type = ((m[1].match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1] || '').toLowerCase();
      if (DATA_TYPES.has(type)) continue;
      if (!EXEC_TYPES.has(type)) { note(f, `has an inline <script type="${type}"> that rule 13 cannot classify as code or data, so its CSP admission is unchecked`); continue; }
      want.script.add(sha256(m[2])); CSP_STATS.scripts++;
    }
    for (const m of s.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) { want.style.add(sha256(m[1])); CSP_STATS.styles++; }
    for (const m of s.matchAll(/<link\b[^>]*>/gi)) {
      if (!/\brel\s*=\s*["']?[^"'>]*\bstylesheet\b/i.test(m[0])) continue;
      const o = (m[0].match(/\bhref\s*=\s*["']?(https?:\/\/[^/"'\s>]+)/i) || [])[1];
      if (o) origins.style.add(o.toLowerCase());
    }
    if (/<[a-zA-Z][^>]*\s(?:on[a-z]+|style)\s*=/.test(s)) note(f, 'has an inline event handler or style="" attribute, which the CSP blocks without saying so — move it into the hashed script or style');
    if (/<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy/i.test(s)) note(f, 'sets a CSP in a <meta> tag — headers are set at the host, and frame-ancestors has no meta form');
  }
  if (CSP_STATS.scripts === 0) note('web/index.html', 'has no inline script for rule 13 to hash, so this CHECK is now empty, not the CSP proven exact. If the page\'s script was removed on purpose, remove its hash from web/_headers and ask the maintainer to retire the script half of rule 13');
  if (CSP_STATS.styles === 0) note('web/index.html', 'has no inline style for rule 13 to hash, so this CHECK is now empty for styles, not the CSP proven exact');

  let lib = null;
  try { lib = await import(pathToFileURL(resolve('scripts/lib/headers-file.mjs')).href); }
  catch (e) { note('scripts/lib/headers-file.mjs', 'could not be loaded, so rule 13 could not read web/_headers (' + (e.code || 'import failed') + ')'); }
  if (!existsSync(HEADERS)) note(HEADERS, 'is missing, so no response carries a CSP from this repo — rule 13 has nothing to check. Restore it; if it was removed on purpose, ask the maintainer to retire rule 13');
  else if (lib) {
    const text = read(HEADERS);
    const rules = lib.parseHeadersFile(text);
    if (rules.length > 100) note(HEADERS, `has ${rules.length} rules; Cloudflare allows 100`);
    text.split(/\r?\n/).forEach((l, i) => { if (l.length > 2000) note(HEADERS, `line ${i + 1} is ${l.length} characters; Cloudflare allows 2,000 per line`); });
    const csp = lib.declarations(rules, 'Content-Security-Policy');
    if (csp.length === 0) note(HEADERS, 'declares no Content-Security-Policy, so rule 13 checked nothing — this CHECK is now empty, not the CSP proven');
    else {
      if (csp.length > 1) note(HEADERS, `sets Content-Security-Policy on ${csp.length} rules (lines ${csp.map(c => c.line).join(', ')}); Cloudflare joins a header set twice with a comma, so the served value would no longer be one policy`);
      const { pattern, value, line } = csp[0];
      if (pattern !== '/*') note(HEADERS, `line ${line}: the CSP is on "${pattern}", not "/*" — the 404 served for an unmatched path would not carry it`);
      const { dirs, repeats } = lib.parsePolicy(value);
      for (const r of new Set(repeats)) note(HEADERS, `line ${line}: the CSP names ${r} twice; a browser keeps only the first`);
      const exact = { 'default-src': ["'self'"], 'object-src': ["'none'"], 'base-uri': ["'self'"], 'frame-ancestors': ["'none'"] };
      for (const [d, toks] of Object.entries(exact)) {
        const got = dirs.get(d);
        if (!got || got.join(' ') !== toks.join(' ')) note(HEADERS, `line ${line}: the CSP floor needs ${d} ${toks.join(' ')}, found ${got ? got.join(' ') : 'nothing'}`);
      }
      for (const d of ['script-src', 'default-src']) {
        for (const bad of ["'unsafe-inline'", "'unsafe-eval'"]) if ((dirs.get(d) || []).includes(bad)) note(HEADERS, `line ${line}: ${d} carries ${bad}`);
      }
      for (const [kind, dir] of [['script', 'script-src'], ['style', 'style-src']]) {
        const toks = dirs.get(dir);
        if (!toks) { if (want[kind].size) note(HEADERS, `line ${line}: the CSP has no ${dir}, but the served HTML has inline ${kind}s that need admitting`); continue; }
        const have = new Set(toks.filter(t => /^'sha256-/.test(t)));
        for (const t of toks) if (/^'sha(?:384|512)-/.test(t)) note(HEADERS, `line ${line}: ${dir} uses ${t.slice(0, 11)}…, which rule 13 does not recompute; use sha256`);
        for (const h of want[kind]) if (!have.has(h)) note(HEADERS, `line ${line}: ${dir} does not admit the inline ${kind} whose hash is ${h} — the browser will refuse it`);
        for (const h of have) if (!want[kind].has(h)) note(HEADERS, `line ${line}: ${dir} admits ${h}, which matches no inline ${kind} in the served HTML (a stale hash)`);
        for (const o of origins[kind]) if (!toks.map(t => t.toLowerCase()).includes(o)) note(HEADERS, `line ${line}: the HTML loads a ${kind === 'style' ? 'stylesheet' : 'script'} from ${o}, which ${dir} does not name`);
      }
      const block = rules.find(r => r.pattern === pattern);
      const ref = lib.declarations([block], 'Referrer-Policy')[0];
      if (!ref || ref.value !== 'strict-origin-when-cross-origin') note(HEADERS, `the "${pattern}" rule needs Referrer-Policy: strict-origin-when-cross-origin, found ${ref ? ref.value : 'none'}`);
      const pp = lib.declarations([block], 'Permissions-Policy')[0];
      if (!pp || !/\w+=\(\)/.test(pp.value)) note(HEADERS, `the "${pattern}" rule needs a Permissions-Policy that disables features (name=()), found ${pp ? 'none that does' : 'none'}`);
    }
  }
}

if (fail.length) {
  console.error('surface check FAILED:\n' + fail.map(f => '  - ' + f).join('\n'));
  process.exit(1);
}
console.log(`surface check passed — ${tracked.length} tracked files, ${tracked.filter(SCANNABLE).length} scanned · CSP hashes recomputed for ${CSP_STATS.scripts} inline script(s) and ${CSP_STATS.styles} inline style(s)${gapNote}`);
