// Kolwen surface check — the room's own laws, mechanised.
//
// This repo's risk is not broken code, it is a FALSE PUBLIC CLAIM: every incident it has had
// was a truth defect in published text. Each assertion below is a rule the room already holds
// and has already caught a violation of. Zero dependencies, Node built-ins only.
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const fail = [];
const note = (f, msg) => fail.push(`${f}: ${msg}`);

const tracked = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
const isText = f => !/.(png|svg|ico|woff2?|ttf)$/i.test(f);

// SCOPE. These checks police PUBLISHED CLAIMS — what a reader of the site, the README, the
// brand doc or the PyPI page actually sees. Two exclusions, both load-bearing:
//   SELF  — a checker must be able to NAME the strings it forbids. Scanning itself makes
//           every rule its own violation, which is how this check first went red.
//   .github/** and scripts/** are CI machinery, not claims about the product. They stay in
//           scope for the leak checks below (an internal path can leak from anywhere) but
//           not for the claim checks.
const SELF = 'scripts/surface-check.mjs';
const PUBLISHED = f => isText(f) && f !== SELF && !f.startsWith('.github/') && !f.startsWith('scripts/');
const SCANNABLE = f => isText(f) && f !== SELF;
const read = f => readFileSync(f, 'utf8');

// ── 1. Trademark: FILED, never registered ────────────────────────────────────
// The word mark is filed and pending. "®" or "registered" asserts a status we do not hold.
for (const f of tracked.filter(PUBLISHED)) {
  const s = read(f);
  if (s.includes('®')) note(f, 'contains ® — the mark is FILED, not registered');
  // "not yet registered" is the CORRECT claim — flag an AFFIRMATIVE assertion only.
  for (const m of s.matchAll(/(.{0,24})\bregistered\b/gi)) {
    if (!/(not|never|yet|un)\s*(yet\s*)?$/i.test(m[1])) note(f, 'asserts the mark is registered — it is FILED');
  }
  if (/จดทะเบียนแล้ว/.test(s)) note(f, 'claims the mark is already registered');
}

// ── 2. No filing identifier on a public surface ──────────────────────────────
// Owner deferral: an identifier a reader cannot look up costs the same trust as a false one.
for (const f of tracked.filter(PUBLISHED)) {
  if (/\b(69082400283315|260145727)\b/.test(read(f))) note(f, 'publishes a trademark filing identifier (owner-deferred)');
}

// ── 3. No kitchen leakage ────────────────────────────────────────────────────
// The private side's name, paths and process vocabulary never reach this repo.
// LICENSE files are EXEMPT for the brand-name check only: their trademark-reservation
// clause must name the names it reserves, which is the whole point of such a clause.
const KITCHEN = /\b(coalkiln|LLMWorks\/|_work\/|\.claude\/|scratchpad\/)/i;
const RESERVATION_EXEMPT = new Set(['LICENSE', 'py/LICENSE']);
// .gitignore must NAME the paths it fences — the fence is not a leak.
const PATH_EXEMPT = new Set(['.gitignore']);
for (const f of tracked.filter(SCANNABLE)) {
  const s = read(f);
  if (!PATH_EXEMPT.has(f) && KITCHEN.test(s)) note(f, 'contains an internal path or private-repo reference');
  if (!RESERVATION_EXEMPT.has(f) && /\bBankfire\b/.test(s)) note(f, 'names the private repo outside a licence reservation clause');
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

// ── 5. web/index.html integrity ──────────────────────────────────────────────
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

  // Bilingual parity: English is the default view, Thai exists and is hidden until asked for.
  if (!/<html lang="en">/.test(s)) note('web/index.html', 'default document language is not English');
  if (!/id="doc-th"[^>]*\shidden/.test(s)) note('web/index.html', 'Thai block is not hidden by default');
  if (/id="doc-en"[^>]*\shidden/.test(s)) note('web/index.html', 'English block is hidden by default');
  if (!/mailto:contact@kolwen\.com/.test(s)) note('web/index.html', 'the published contact channel is missing');
}

// ── 6. Every contrast ratio in the brand doc recomputes from its own hex pair ─
// WCAG 2.x relative luminance. A ratio stated beside a colour must be derivable from it.
if (existsSync('brand/README.md')) {
  const lin = c => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const L = h => { const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
  const ratio = (a, b) => { const [x, y] = [L(a), L(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const PAIRS = [['#e8833a','#15130f'],['#A65A19','#ffffff'],['#e8833a','#ffffff'],['#A65A19','#15130f'],['#A65A19','#ece4d9'],['#A65A19','#f1f1f1']];
  const doc = read('brand/README.md');
  // WCAG's own bars are thresholds, not measurements of a pair — exclude them.
  const THRESHOLDS = new Set(['3', '4.5', '7']);
  const stated = [...new Set(doc.match(/\b\d+(?:\.\d+)?:1/g) || [])].map(t => t.slice(0, -2)).filter(t => !THRESHOLDS.has(t));
  for (const t of stated) {
    const ok = PAIRS.some(([a, b]) => Math.abs(ratio(a, b) - Number(t)) < 0.005);
    if (!ok) note('brand/README.md', `states ${t}:1, which no documented colour pair produces`);
  }
}

if (fail.length) {
  console.error('surface check FAILED:\n' + fail.map(f => '  - ' + f).join('\n'));
  process.exit(1);
}
console.log(`surface check passed — ${tracked.length} tracked files, ${tracked.filter(isText).length} text`);
