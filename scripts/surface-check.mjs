// Kolwen surface check — the room's own laws, mechanised.
//
// This repo's risk is not broken code: one zero-dependency generator is the only executable of
// consequence. Its risk is a FALSE PUBLIC CLAIM. Every assertion below is a rule the room
// already holds and has already caught a violation of. Zero dependencies, Node built-ins only.
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

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
for (const f of tracked.filter(PUBLISHED)) {
  const runs = read(f).match(/\d{9,}/g);
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
  if (/[A-Za-z]:\Users\|\/Users\/[a-z0-9]+\//i.test(s)) note(f, 'contains an absolute local path');
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
  if (!/mailto:contact@kolwen\.com/.test(s)) note('web/index.html', 'the published contact channel is missing');
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
  for (const t of stated) {
    // <= : a correctly-rounded 2-decimal figure sits at most 0.005 from its true value, so a
    // strict < reds a correct document at exactly the rounding boundary.
    const ok = PAIRS.some(([a, b]) => Math.abs(ratio(a, b) - Number(t)) <= 0.005);
    if (!ok) note('brand/README.md', `states ${t}:1, which no documented colour pair produces`);
  }
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
  'web/index.html', 'web/robots.txt', 'web/sitemap.xml',
  'web/favicon.svg', 'web/favicon-32.png', 'web/apple-touch-icon.png', 'web/og.png',
]);
for (const f of tracked.filter(f => f.startsWith('web/'))) {
  if (!SHIPPED.has(f)) note(f, 'is tracked under the publish root but is not a declared shipped asset — every path under web/ is a live URL');
}
for (const f of SHIPPED) {
  if (!existsSync(f)) note(f, 'is declared a shipped asset but is missing from the publish root');
}

if (fail.length) {
  console.error('surface check FAILED:\n' + fail.map(f => '  - ' + f).join('\n'));
  process.exit(1);
}
console.log(`surface check passed — ${tracked.length} tracked files, ${tracked.filter(SCANNABLE).length} scanned`);
