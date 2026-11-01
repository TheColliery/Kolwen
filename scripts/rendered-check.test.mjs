// Tests for the rendered checks (scripts/rendered-check.mjs): the clean pages pass, and each defect the checks exist for is PLANTED in a copy of web/ and must be found by the real browser.
//   - a 400 px wide element fails the 320 px reflow check (SC 1.4.10);
//   - a box that clips its text fails the 200% text check (SC 1.4.4), both a box that cuts its own content and a text that sticks out of a clipping parent;
//   - an inline style whose hash is not in the Content-Security-Policy is reported by the browser.
// The browser tests need a route to a browser (scripts/lib/browser.mjs findRoute): the Chrome, Chromium or Edge found on Linux or macOS, or on Windows the headless shell inside WSL (never a Windows browser).
// Locally, with no route, they are SKIPPED and the skip names why; in CI (CI=true) a missing browser FAILS the first test below, so CI never goes green without them.
// Every child has a bound: the browser has a heap cap and a kill timer (scripts/lib/browser.mjs). Run: node --test scripts/rendered-check.test.mjs
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, win32 } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findBrowser, findRoute, launchBrowser, BROWSER_ENV, EXIT_NOT_RUN_HERE } from './lib/browser.mjs';
import * as browserLib from './lib/browser.mjs'; // devToolsEndpoint, profilePath, lockProfile and the rest are used through the namespace
import * as wslLib from './lib/wsl-route.mjs';
import { stripComments, readsOwnPath, startsItself } from './lib/entry-scan.mjs'; // toWslPath, decodeWslText, findWslRoute
import { makeResponder } from './lib/static-server.mjs';
import { reportField } from './lib/report-field.mjs';
import { renderedChecks, urlPathOf } from './rendered-check.mjs';
import * as checkLib from './rendered-check.mjs'; // classifyLogs
import { htmlPages } from './lib/web-files.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE_COUNT = htmlPages(join(ROOT, 'web')).length; // the pages renderedChecks walks: the same list, never a typed number
const CI = process.env.CI === 'true';
const route = findRoute();
const USABLE = route.kind === 'native' || route.kind === 'wsl';
const NATIVE = route.kind === 'native', WSL = route.kind === 'wsl';
const SKIP = !USABLE && !CI ? `no browser route here (${route.why}); the rendered checks did not run here` : false;
const SKIP_NATIVE = SKIP || (NATIVE ? false : 'the native route only: the WSL route gives every run a profile of its own');
const SKIP_WSL = SKIP || (WSL ? false : 'the WSL route only');

let browser = null;
const copies = [];
// An environment whose windir is the given folder, with no other spelling of it left (a copy of process.env can hold WINDIR, and the child would then read either one): the System32 wsl.exe is not under it. windir and not SystemRoot, because a node child started with a wrong SystemRoot aborts (exit 134).
const withWindir = (env, dir) => ({ ...Object.fromEntries(Object.entries(env).filter(([k]) => !/^windir$/i.test(k))), windir: dir });
before(async () => { if (USABLE) browser = await launchBrowser({ route, lifetimeMs: 600000 }); });
after(async () => { if (browser) await browser.close(); for (const d of copies) rmSync(d, { recursive: true, force: true }); });

// A copy of web/ in the OS temp folder, with `plant(dir)` applied. Only a folder this call made is ever removed.
function copyWeb(plant) {
  const dir = mkdtempSync(join(tmpdir(), 'kolwen-web-'));
  copies.push(dir);
  cpSync(join(ROOT, 'web'), join(dir, 'web'), { recursive: true });
  if (plant) plant(join(dir, 'web'));
  return join(dir, 'web');
}
const editPage = (webDir, file, fn) => writeFileSync(join(webDir, file), fn(readFileSync(join(webDir, file), 'utf8')));
const run = (webDir, checks, headers = false) => renderedChecks({ webDir, browser, checks, headers });
const where = (failures, file, check) => failures.filter(f => f.page === file && f.check === check);

test('in CI a browser is there: the rendered checks are never skipped there', { skip: CI ? false : 'only meaningful in CI' }, () => {
  assert.ok(USABLE, `CI has no browser route (${route.why}), so the rendered checks cannot run (set ${BROWSER_ENV} or install Chrome, Chromium or Edge)`);
});

test('the built pages pass all three checks, in both languages, under their real Content-Security-Policy', { skip: SKIP }, async () => {
  const { failures, measured } = await run(join(ROOT, 'web'), ['reflow', 'zoom', 'csp'], true);
  assert.deepEqual(failures, []);
  const pages = new Set(measured.map(m => m.page));
  assert.equal(pages.size, PAGE_COUNT, 'every page was measured: ' + pages.size);
  assert.equal(measured.filter(m => m.check === 'reflow').length, pages.size * 2, 'one reflow measurement per page and language');
  for (const m of measured.filter(m => m.check === 'zoom')) {
    assert.equal(m.rootPx, 32, `${m.page} [${m.lang}] was measured at a root font size of 200% of 16 px`);
    assert.ok(m.textElementsRead > 5, `${m.page} [${m.lang}] read its text elements (${m.textElementsRead})`);
  }
});

test('a 400 px wide element fails the 320 px reflow check on the page that has it, and only there', { skip: SKIP }, async () => {
  const web = copyWeb(w => editPage(w, 'terms.html', h => h.replace('<main>', '<div style="width:400px;height:20px;background:#f00">planted</div><main>')));
  const { failures } = await run(web, ['reflow']);
  const hit = where(failures, 'terms.html', 'reflow');
  assert.equal(hit.length, 2, 'both languages: ' + JSON.stringify(failures));
  assert.match(hit[0].detail, /at 320 px the page scrolls sideways: scrollWidth \d+ > clientWidth 320/);
  assert.equal(failures.length, 2, 'no other page fails');
});

test('the Thai document is measured too: an element only the Thai side holds fails there and not in English', { skip: SKIP }, async () => {
  const web = copyWeb(w => editPage(w, 'terms.html', h => h.replace('<div id="doc-th" lang="th" hidden>', '<div id="doc-th" lang="th" hidden><div style="width:400px;height:20px">planted</div>')));
  const { failures } = await run(web, ['reflow']);
  assert.deepEqual(failures.map(f => [f.page, f.lang]), [['terms.html', 'th']], JSON.stringify(failures));
});

test('the 320 px check is not the same as any viewport: the planted element passes at a width that holds it', { skip: SKIP }, async () => {
  const web = copyWeb(w => editPage(w, 'terms.html', h => h.replace('<main>', '<div style="width:300px;height:20px">fits</div><main>')));
  assert.deepEqual((await run(web, ['reflow'])).failures, []);
});

// The plan table of the pricing page (a data table) scrolls inside its own wrapper. At 320 px it had 2.4 px of slack with the font hinting off, and with FreeType's medium or full hinting (what a Linux
// visitor's browser often applies) its text is wider and the WHOLE PAGE scrolled sideways. SC 1.4.10 exempts "parts of the content which require two-dimensional layout for usage or meaning", and its own
// examples name data tables; so the table may scroll, and the page may not. Forced here, since the WSL route runs with the hinting off: a table of a width of 560 px, which is what slack of zero looks like.
test('the plan table scrolls inside its own wrapper: a table wider than 320 px never makes the page scroll sideways, and its wrapper is a named, keyboard-reachable region', { skip: SKIP }, async () => {
  const web = copyWeb(w => editPage(w, 'pricing.html', h => h.replace('</style>', '  .plans{min-width:560px}\n</style>')));
  const { failures } = await run(web, ['reflow']);
  assert.deepEqual(where(failures, 'pricing.html', 'reflow'), [], 'the page does not scroll sideways: ' + JSON.stringify(failures));
  const server = await browser.serve(web, { headers: false });
  const page = await browser.newPage();
  try {
    await page.setViewport(320, 800);
    await page.goto(server.origin + '/pricing');
    const wraps = await page.evaluate(`[...document.querySelectorAll('.plans-wrap')].map(e => ({ overflowX: getComputedStyle(e).overflowX, scrolls: e.scrollWidth > e.clientWidth, role: e.getAttribute('role'), tabindex: e.getAttribute('tabindex'), named: (e.getAttribute('aria-label') || '').length > 0, holdsTable: !!e.querySelector('table.plans'), inCard: e.parentElement.classList.contains('card') }))`);
    assert.equal(wraps.length, 2, 'one wrapper in each language document: ' + JSON.stringify(wraps));
    for (const x of wraps) assert.deepEqual({ ...x, scrolls: undefined }, { overflowX: 'auto', scrolls: undefined, role: 'region', tabindex: '0', named: true, holdsTable: true, inCard: true });
    assert.equal(wraps[0].scrolls, true, 'in the visible (English) document the table really is wider than its wrapper and scrolls there');
  } finally { await page.close(); await server.close(); }
});

test('a box that clips its own text fails the 200% text check', { skip: SKIP }, async () => {
  const web = copyWeb(w => editPage(w, 'terms.html', h => h.replace('<main>', '<div id="planted" style="width:7rem;height:1.4rem;overflow:hidden">A sentence that cannot fit in a box of this size at any text size</div><main>')));
  const { failures } = await run(web, ['zoom']);
  const hit = where(failures, 'terms.html', 'zoom');
  assert.ok(hit.length >= 1, JSON.stringify(failures));
  assert.match(hit[0].detail, /at 200% text: text is cut by its own box: div#planted/);
});

test('an element that fits at 100% and not at 200% makes the page scroll sideways, which fails the 200% text check', { skip: SKIP }, async () => {
  const web = copyWeb(w => editPage(w, 'terms.html', h => h.replace('<main>', '<div style="min-width:45rem;height:20px">planted</div><main>')));
  const hit = where((await run(web, ['zoom'])).failures, 'terms.html', 'zoom');
  assert.ok(hit.some(f => /at 200% text: the page scrolls sideways: scrollWidth \d+ > clientWidth/.test(f.detail)), JSON.stringify(hit));
  assert.deepEqual((await run(web, ['reflow'])).failures.filter(f => f.page === 'terms.html').length, 2, 'and at 320 px it fails the reflow check too');
});

test('text that sticks out of a clipping parent fails the 200% text check', { skip: SKIP }, async () => {
  const web = copyWeb(w => editPage(w, 'terms.html', h => h.replace('<main>', '<div id="frame" style="width:9rem;overflow:hidden"><p style="white-space:nowrap">A line that does not wrap and runs past the frame</p></div><main>')));
  const hit = where((await run(web, ['zoom'])).failures, 'terms.html', 'zoom');
  assert.ok(hit.some(f => /text of p is cut by div#frame/.test(f.detail)), JSON.stringify(hit));
});

test('a box that grows with its text, and a scrolling box, are not a loss', { skip: SKIP }, async () => {
  const web = copyWeb(w => editPage(w, 'terms.html', h => h.replace('<main>', '<div style="min-height:1.4rem;width:12rem">A box that grows with the text it holds, wrapping onto more lines</div><div style="width:9rem;overflow:auto"><p style="white-space:nowrap">A scrolling box keeps all of its text reachable</p></div><main>')));
  assert.deepEqual((await run(web, ['zoom'])).failures, []);
});

test('an inline style whose hash is not in the Content-Security-Policy is reported by the browser', { skip: SKIP }, async () => {
  const web = copyWeb(w => editPage(w, 'index.html', h => h.replace('</head>', '<style>body{outline:0}</style></head>')));
  const hit = where((await run(web, ['csp'], true)).failures, 'index.html', 'csp');
  assert.ok(hit.length >= 1 && /style/i.test(hit[0].detail), JSON.stringify(hit));
  assert.deepEqual((await run(web, ['csp'], false)).failures, [], 'with the headers off the same page is not a violation: the check reads the browser, not the file');
});

test('a Permissions-Policy message alone does not fail the csp check and is reported as a note; a CSP violation beside it still fails', { skip: SKIP }, async () => {
  // a feature name no browser knows: the same message the runner's Chrome gave for 'bluetooth' and 'web-share', whatever version of the engine runs here
  const planted = w => editPage(w, '_headers', h => h.replace('Permissions-Policy: accelerometer=()', 'Permissions-Policy: kolwen-no-such-feature=(), accelerometer=()'));
  const web = copyWeb(planted);
  const r = await run(web, ['csp'], true);
  assert.deepEqual(r.failures, [], 'no csp failure for a Permissions-Policy message: ' + JSON.stringify(r.failures));
  // only the planted name is counted: the runner's Chrome also reports the real _headers features it does not know ('bluetooth', 'web-share'), so a page carries more notes than the planted one
  const mine = r.notes.filter(n => /Unrecognized feature: 'kolwen-no-such-feature'/.test(n.text));
  assert.equal(mine.length, PAGE_COUNT * 2, 'one note for the planted name per page and language (' + PAGE_COUNT + ' pages x 2): ' + mine.length);
  assert.ok(mine.every(n => n.kind === 'permissions-policy'), JSON.stringify(mine[0]));
  const csp = r.measured.filter(m => m.check === 'csp');
  assert.equal(csp.length, PAGE_COUNT * 2, 'a csp measurement for every page and language');
  assert.ok(csp.every(m => m.violations === 0 && m.notes >= 1), JSON.stringify(csp.find(m => m.violations !== 0 || m.notes < 1)));
  const both = copyWeb(w => { planted(w); editPage(w, 'index.html', h => h.replace('</head>', '<style>body{outline:0}</style></head>')); });
  const hit = where((await run(both, ['csp'], true)).failures, 'index.html', 'csp');
  assert.ok(hit.length >= 1 && /style/i.test(hit[0].detail) && !/Permissions-Policy/.test(hit[0].detail), 'the planted CSP violation still fails, and it is the CSP message: ' + JSON.stringify(hit));
});

test('classifyLogs: a CSP violation is a violation, a Permissions-Policy or Feature-Policy message is a note, other page noise is neither', () => {
  const csp = { source: 'security', level: 'error', text: "Applying inline style violates the following Content Security Policy directive style-src self" };
  const pp = { source: 'other', level: 'error', text: "Error with Permissions-Policy header: Unrecognized feature: 'bluetooth'." };
  const fp = { source: 'security', level: 'warning', text: 'Feature-Policy: unknown feature' };
  const mixed = { source: 'security', level: 'warning', text: 'Mixed Content: the page was loaded over HTTPS' };
  const noise = { source: 'javascript', level: 'error', text: 'Uncaught TypeError: x is not a function' };
  const classifyLogs = checkLib.classifyLogs;
  assert.deepEqual(classifyLogs([pp]), { violations: [], notes: [{ kind: 'permissions-policy', text: pp.text }] });
  assert.equal(classifyLogs([csp]).violations.length, 1);
  assert.equal(classifyLogs([pp, csp, noise]).violations.length, 1);
  assert.equal(classifyLogs([pp, csp, noise]).notes.length, 1);
  assert.equal(classifyLogs([fp]).notes[0].kind, 'permissions-policy');
  assert.deepEqual(classifyLogs([mixed]), { violations: [], notes: [{ kind: 'security', text: mixed.text }] });
  assert.deepEqual(classifyLogs([noise]), { violations: [], notes: [] });
  assert.deepEqual(classifyLogs([]), { violations: [], notes: [] });
});

test('a page whose language switch does not set the wanted lang fails, and a page is never measured in a language another page left behind', { skip: SKIP }, async () => {
  // every page and language opens in a browser context of its own, so a page with no working switch opens in its own default (en) and passes there, and its Thai pass is the one that cannot get Thai:
  // with one shared context, the same page failed in English instead, because the Thai pass of the page before it had left "th" in localStorage
  const web = copyWeb(w => editPage(w, 'pricing.html', h => h.split('data-lang-set=').join('data-lang-x=')));
  const { failures } = await run(web, ['reflow']);
  const lang = failures.filter(f => f.check === 'language');
  assert.deepEqual(lang.map(f => [f.page, f.lang]), [['pricing.html', 'th']], JSON.stringify(failures));
  assert.match(lang[0].detail, /the language switch did not set lang="th" \(the page reports lang="en"\)/);
  assert.deepEqual((await run(copyWeb(), ['reflow'])).failures, [], 'with its switch the same page is measured in both languages, with no failure');
});

test('the zoom check really runs at 200%: the root font size is 32 px on every page', { skip: SKIP }, async () => {
  const { measured } = await run(copyWeb(), ['zoom']);
  assert.ok(measured.every(m => m.rootPx === 32));
});

// ── the reading theme ───────────────────────────────────────────────────────────────────────────────────────────
test('the reading theme: prose pages are solid and follow the device in both colour schemes, with the contrast and line heights the standard asks, and the default pages are untouched', { skip: SKIP }, async () => {
  const { failures, measured } = await run(join(ROOT, 'web'), ['theme', 'contrast', 'lineheight', 'measure'], true);
  assert.deepEqual(failures, []);
  const prose = ['changelog.html', 'privacy.html', 'refund.html', 'subprocessors.html', 'terms.html'];
  for (const p of prose) for (const scheme of ['light', 'dark']) {
    const th = measured.find(m => m.page === p && m.check === 'theme' && m.scheme === scheme);
    assert.ok(th && th.job === 'prose' && th.image === 'none', `${p} ${scheme}: prose, no background image`);
    assert.equal(th.color, scheme === 'light' ? 'rgb(251, 250, 248)' : 'rgb(15, 13, 11)', `${p} ${scheme}: the ground`);
    for (const lang of ['en', 'th']) {
      const c = measured.find(m => m.page === p && m.check === 'contrast' && m.lang === lang && m.scheme === scheme);
      assert.ok(c && c.read > 20 && c.worst >= 4.5, `${p} [${lang}] ${scheme}: ${c && c.read} text elements, worst ${c && c.worst}`);
    }
  }
  for (const p of prose) {
    const en = measured.find(m => m.page === p && m.check === 'lineheight' && m.lang === 'en'), th = measured.find(m => m.page === p && m.check === 'lineheight' && m.lang === 'th');
    assert.ok(en.min >= 1.5 - 0.005, `${p} Latin line height ${en.min}`);
    assert.ok(Math.abs(th.min - 1.65) < 0.005 && Math.abs(th.max - 1.65) < 0.005, `${p} Thai line height ${th.min}..${th.max}`);
  }
  for (const p of prose) {
    const en = measured.find(m => m.page === p && m.check === 'measure' && m.lang === 'en'), th = measured.find(m => m.page === p && m.check === 'measure' && m.lang === 'th');
    assert.ok(en.lines >= 5 && en.max <= 80, `${p} Latin: ${en.lines} lines, longest ${en.max} characters`);
    // the body text is 18 px and the column is 33em of it (594 px), in both languages: the px value is the one knob and the column follows it
    assert.equal(en.fontPx, 18, `${p}: the body text is 18 px`);
    assert.ok(Math.abs(en.columnEm - 33) < 0.1 && Math.abs(en.columnPx - 33 * 18) < 1, `${p}: the column is 33em of the body size, ${en.columnEm} em, ${en.columnPx} px`);
    assert.ok(th.lines >= 2 && th.fontPx === 18 && Math.abs(th.columnEm - 33) < 0.1, `${p} Thai: 18 px, the column is recorded in em (${th.columnEm}), ${th.lines} Thai lines read`);
  }
  for (const p of ['index.html', 'pricing.html', '404.html']) assert.ok(measured.filter(m => m.page === p && m.check === 'theme').every(m => m.job === 'default'), p + ' is the default job');
  assert.ok(!measured.some(m => m.check === 'contrast' && !prose.includes(m.page)), 'the contrast check reads prose pages only');
});

test('text that is too faint for ONE colour scheme fails that scheme\'s contrast check and not the other\'s', { skip: SKIP }, async () => {
  const web = copyWeb(w => editPage(w, 'terms.html', h => h.replace('<main>', '<main><p id="faint" style="color:#8d8d8d">Faint grey text</p>')));
  const { failures } = await run(web, ['contrast']);
  const hit = failures.filter(f => f.check === 'contrast');
  assert.ok(hit.length >= 1 && hit.every(f => f.scheme === 'light' && f.page === 'terms.html'), JSON.stringify(hit));
  assert.match(hit[0].detail, /under the floor in the light scheme: p#faint \d\.\d\d:1 \(floor 4\.5\)/);
  const web2 = copyWeb(w => editPage(w, 'terms.html', h => h.replace('<main>', '<main><p id="dim" style="color:#555555">Dark grey text</p>')));
  const hit2 = (await run(web2, ['contrast'])).failures.filter(f => f.check === 'contrast');
  assert.ok(hit2.length >= 1 && hit2.every(f => f.scheme === 'dark'), JSON.stringify(hit2));
});

test('large text has the lower floor of 3:1', { skip: SKIP }, async () => {
  // #8d8d8d on the light ground is about 3.2:1: it fails as body text and passes as large text
  const small = copyWeb(w => editPage(w, 'terms.html', h => h.replace('<main>', '<main><p style="color:#8d8d8d;font-size:1rem">Body size</p>')));
  assert.ok((await run(small, ['contrast'])).failures.some(f => f.scheme === 'light'));
  const large = copyWeb(w => editPage(w, 'terms.html', h => h.replace('<main>', '<main><p style="color:#8d8d8d;font-size:1.6rem">Large size</p>')));
  assert.deepEqual((await run(large, ['contrast'])).failures, []);
});

test('a translucent text colour is measured over what it really sits on, and a disabled control is exempt', { skip: SKIP }, async () => {
  const web = copyWeb(w => editPage(w, 'terms.html', h => h.replace('<main>', '<main><p style="color:rgba(0,0,0,0.3)">Translucent</p><button disabled style="color:#bbbbbb">Inactive</button>')));
  const hit = (await run(web, ['contrast'])).failures.filter(f => f.check === 'contrast');
  assert.ok(hit.some(f => f.scheme === 'light') && hit.some(f => f.scheme === 'dark'), 'the translucent black text fails on both grounds: ' + JSON.stringify(hit));
  assert.ok(!hit.some(f => /button/.test(f.detail)), 'the disabled button is not measured');
});

test('the opacity of an element counts: faded text fails where the same colour at full strength passes', { skip: SKIP }, async () => {
  const full = copyWeb(w => editPage(w, 'terms.html', h => h.replace('<main>', '<main><p>Full strength</p>')));
  assert.deepEqual((await run(full, ['contrast'])).failures, []);
  const faded = copyWeb(w => editPage(w, 'terms.html', h => h.replace('<main>', '<main><p id="faded" style="opacity:0.35">Faded text</p>')));
  const hit = (await run(faded, ['contrast'])).failures.filter(f => f.check === 'contrast');
  assert.ok(hit.length >= 2 && hit.every(f => /p#faded/.test(f.detail)), JSON.stringify(hit));
});

test('Thai text under 1.65 and Latin text under 1.5 fail the line height check, each in its own language', { skip: SKIP }, async () => {
  const th = copyWeb(w => editPage(w, 'terms.html', h => h.replace('<div id="doc-th" lang="th" hidden>', '<div id="doc-th" lang="th" hidden><p style="line-height:1.2">ไทยทดสอบ</p>')));
  const f1 = (await run(th, ['lineheight'])).failures;
  assert.deepEqual(f1.map(f => [f.page, f.lang]), [['terms.html', 'th']], JSON.stringify(f1));
  assert.match(f1[0].detail, /p has a line height of 1\.200 times its size; the Thai text is 1\.65/);
  // 1.55 is a good Latin line height and not the Thai one: the floors are per script
  const th2 = copyWeb(w => editPage(w, 'terms.html', h => h.replace('<div id="doc-th" lang="th" hidden>', '<div id="doc-th" lang="th" hidden><p style="line-height:1.55">ไทยทดสอบ</p>')));
  assert.ok((await run(th2, ['lineheight'])).failures.some(f => f.lang === 'th' && /1\.550 times its size; the Thai text is 1\.65/.test(f.detail)), 'Thai text at 1.55 fails');
  const en = copyWeb(w => editPage(w, 'terms.html', h => h.replace('<div id="doc-en" lang="en">', '<div id="doc-en" lang="en"><p style="line-height:1.1">Tight Latin</p>')));
  const f2 = (await run(en, ['lineheight'])).failures;
  assert.deepEqual(f2.map(f => [f.page, f.lang]), [['terms.html', 'en']], JSON.stringify(f2));
  assert.match(f2[0].detail, /the Latin text is at least 1\.5/);
});

test('a rendered Latin line of more than 80 characters fails the measure check; the Thai document is measured, never failed', { skip: SKIP }, async () => {
  const long = 'A single line that is far longer than the reading measure allows a line to be, so it holds well over eighty characters at once';
  const web = copyWeb(w => editPage(w, 'terms.html', h => h.replace('<div id="doc-en" lang="en">', `<div id="doc-en" lang="en"><p style="width:90rem;max-width:none">${long}</p>`)));
  const { failures } = await run(web, ['measure']);
  assert.deepEqual(failures.map(f => [f.page, f.lang]), [['terms.html', 'en']], JSON.stringify(failures));
  assert.match(failures[0].detail, /a rendered line holds \d+ characters; the reading measure is at most 80/);
  const thai = copyWeb(w => editPage(w, 'terms.html', h => h.replace('<div id="doc-th" lang="th" hidden>', '<div id="doc-th" lang="th" hidden><p style="width:90rem;max-width:none">ข้อความภาษาไทยที่ยาวมากในบรรทัดเดียวเพื่อทดสอบการวัดความยาวบรรทัดของเอกสารภาษาไทยโดยไม่ให้ล้มเหลว</p>')));
  assert.deepEqual((await run(thai, ['measure'])).failures, [], 'a long Thai line is recorded and is not a failure');
});

// BB-208 (the owner, 2026-10-20: "เอาลำดับ 18 21 24 30"): the type ladder of the reading pages, read from the browser. Title 30 px, h2 24 px, h3 21 px, body 18 px, in both languages and at every width
// (390, 1280, 1920 and 2560 px), and each step larger than the one below. The home, pricing and 404 pages do not move: their page title is still the fluid 20 to 24 px of font.size.title and
// title-home (the sizes measured on main at 8d01a78 at 1280 px: pricing 24 px, home 21 px, 404 21.6 px).
test('the reading ladder: on every prose page, in both languages and at 390, 1280, 1920 and 2560 px, the title is 30 px, h2 24 px, h3 21 px and the body 18 px, each above the one below; the other pages keep their title', { skip: SKIP }, async () => {
  const server = await browser.serve(join(ROOT, 'web'), { headers: false });
  const sizesOf = (page, lang) => page.evaluate(`(() => {
    const root = document.querySelector('#doc-${lang}'), size = el => parseFloat(getComputedStyle(el).fontSize), visible = el => getComputedStyle(el).display !== 'none';
    const first = sel => [...root.querySelectorAll(sel)].filter(visible).map(size);
    return { h1: first('h1'), h2: first('.legal h2'), h3: first('.legal h3'), body: first('.legal p:not(.sub):not(.fine), .legal li') };
  })()`);
  try {
    for (const file of ['terms.html', 'privacy.html', 'refund.html', 'changelog.html']) {
      for (const lang of ['en', 'th']) {
        for (const width of [390, 1280, 1920, 2560]) {
          const page = await browser.newPage();
          try {
            await page.setViewport(width, 800);
            await page.goto(server.origin + checkLib.urlPathOf(file));
            const got = await page.evaluate(`(() => { const b = document.querySelector('[data-lang-set="${lang}"]'); if (b) b.click(); return document.documentElement.lang; })()`);
            assert.equal(got, lang, `${file}: the language switch set ${lang}`);
            const s = await sizesOf(page, lang), at = `${file} ${lang} ${width} px`;
            assert.deepEqual([...new Set(s.h1)], [30], at + ': the title is 30 px');
            assert.deepEqual([...new Set(s.h2)], s.h2.length ? [24] : [], at + ': h2 is 24 px');
            assert.deepEqual([...new Set(s.h3)], s.h3.length ? [21] : [], at + ': h3 is 21 px');
            assert.deepEqual([...new Set(s.body)], [18], at + ': the body is 18 px');
            const steps = [30, 24, 21, 18].filter((_, i) => [s.h1, s.h2, s.h3, s.body][i].length);
            assert.ok(steps.length >= 2 && steps.every((x, i) => i === 0 || steps[i - 1] > x), at + ': each step is larger than the one below');
          } finally { await page.close(); }
        }
      }
    }
    // the pages that are not prose keep the title they had
    for (const [file, want] of [['pricing.html', 24], ['index.html', 21], ['404.html', 21.6]]) {
      const page = await browser.newPage();
      try {
        await page.setViewport(1280, 800);
        await page.goto(server.origin + checkLib.urlPathOf(file));
        const h1 = await page.evaluate(`parseFloat(getComputedStyle(document.querySelector('h1')).fontSize)`);
        assert.equal(h1, want, file + ': the title did not move');
      } finally { await page.close(); }
    }
  } finally { await server.close(); }
});

test('the theme check finds a prose page with a background image, one without a job, and a default page that carries the reading theme', { skip: SKIP }, async () => {
  const image = copyWeb(w => editPage(w, 'privacy.html', h => h.replace('<body>', '<body style="background-image:linear-gradient(red,blue)">')));
  assert.ok((await run(image, ['theme'])).failures.some(f => f.page === 'privacy.html' && /has a background image/.test(f.detail)));
  const nojob = copyWeb(w => editPage(w, 'privacy.html', h => h.replace(' data-job="prose"', '')));
  assert.ok((await run(nojob, ['theme'])).failures.some(f => f.page === 'privacy.html' && /declares no job/.test(f.detail)));
  const leak = copyWeb(w => editPage(w, 'index.html', h => h.replace('<html lang="en" data-job="default">', '<html lang="en" data-job="default" style="color-scheme:light dark">')));
  assert.ok((await run(leak, ['theme'])).failures.some(f => f.page === 'index.html' && /leaked into it/.test(f.detail)));
});

// ── no browser needed ───────────────────────────────────────────────────────────────────────────────────────────
test('findBrowser: an explicit path wins, a wrong explicit path is never replaced by a guess, and the platform lists are searched', () => {
  const me = process.execPath;
  assert.equal(findBrowser({ [BROWSER_ENV]: me }, 'linux'), me);
  assert.equal(findBrowser({ [BROWSER_ENV]: join(tmpdir(), 'no-such-browser-binary') , PATH: dirname(me) }, 'linux'), null);
  assert.equal(findBrowser({ PATH: '' }, 'linux'), null);
});

// The comments of a source file removed (a // that starts a line or follows white space, so http:// inside a string stays), for the tests that read the code and not the prose.
const codeOf = f => readFileSync(join(ROOT, f), 'utf8').split(/\r?\n/).map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');

test('devToolsEndpoint: the address the browser reports is accepted only as ws://127.0.0.1:<our port>/devtools/browser/<id>, and is rebuilt from our port and that id', () => {
  const devToolsEndpoint = browserLib.devToolsEndpoint;
  const ok = 'ws://127.0.0.1:9222/devtools/browser/0f3a-4B1c-9d';
  assert.equal(devToolsEndpoint(ok, 9222), ok);
  assert.equal(devToolsEndpoint('ws://127.0.0.1:1/devtools/browser/a', 1), 'ws://127.0.0.1:1/devtools/browser/a');
  assert.equal(devToolsEndpoint('ws://127.0.0.1:65535/devtools/browser/a', 65535), 'ws://127.0.0.1:65535/devtools/browser/a');
  const bads = ['ws://localhost:9222/devtools/browser/a', 'ws://127.0.0.2:9222/devtools/browser/a', 'ws://evil.example:9222/devtools/browser/a', 'ws://127.0.0.1:9223/devtools/browser/a',
    'ws://127.0.0.1:92220/devtools/browser/a', 'ws://127.0.0.1/devtools/browser/a', 'wss://127.0.0.1:9222/devtools/browser/a', 'http://127.0.0.1:9222/devtools/browser/a',
    'ws://127.0.0.1:9222/devtools/page/a', 'ws://127.0.0.1:9222/devtools/browser/', 'ws://127.0.0.1:9222/devtools/browser/a/b', 'ws://127.0.0.1:9222/devtools/browser/a?x=1',
    'ws://127.0.0.1:9222/devtools/browser/a#h', 'ws://127.0.0.1:9222@evil.example/devtools/browser/a', 'ws://user@127.0.0.1:9222/devtools/browser/a', ' ws://127.0.0.1:9222/devtools/browser/a',
    'ws://127.0.0.1:9222/devtools/browser/a\n', 'ws://127.0.0.1:9222/DEVTOOLS/browser/a', '', undefined, null, 42, {},
    // the dots of the host are dots and not "any character": each of these has one character in a dot's place, or one more after the host
    'ws://127x0x0x1:9222/devtools/browser/a', 'ws://127.0.0.1x:9222/devtools/browser/a', 'ws://127.0.0x1:9222/devtools/browser/a', 'ws://127x0.0.1:9222/devtools/browser/a', 'ws://127.0x0.1:9222/devtools/browser/a',
    'ws://1270.0.1:9222/devtools/browser/a', 'ws://127,0,0,1:9222/devtools/browser/a', 'ws://127-0-0-1:9222/devtools/browser/a'];
  for (const bad of bads) assert.throws(() => devToolsEndpoint(bad, 9222), /the browser answered with the WebSocket address [\s\S]* which is not ws:\/\/127\.0\.0\.1:9222\/devtools\/browser\/<id>$/, JSON.stringify(bad));
});

test('freePort: a port of 127.0.0.1 chosen by binding port 0, and free again afterwards', async () => {
  const p = await browserLib.freePort();
  assert.ok(Number.isInteger(p) && p >= 1024 && p <= 65535, String(p));
  const s = createServer();
  await new Promise((res, rej) => { s.once('error', rej); s.listen(p, '127.0.0.1', res); });
  await new Promise(r => s.close(r));
});

test('profilePath: one fixed folder in the user\'s own cache folder, never in a shared temp folder; KOLWEN_BROWSER_PROFILE names another', () => {
  const { profilePath, profileBase } = browserLib;
  const home = join(tmpdir(), 'home-of-a-user'); // path strings only: nothing is made
  const xdg = join(tmpdir(), 'xdg-cache');
  const lad = join(tmpdir(), 'local-app-data');
  const under = (base) => resolve(join(base, 'kolwen-browser-profile'));
  assert.equal(profilePath({ LOCALAPPDATA: lad }, 'win32', home), under(lad), 'Windows: %LOCALAPPDATA%');
  assert.equal(profilePath({}, 'win32', home), under(join(home, 'AppData', 'Local')), 'Windows without LOCALAPPDATA');
  assert.equal(profilePath({ XDG_CACHE_HOME: xdg }, 'linux', home), under(xdg), 'POSIX: $XDG_CACHE_HOME');
  assert.equal(profilePath({ XDG_CACHE_HOME: 'relative/cache' }, 'linux', home), under(join(home, '.cache')), 'a relative XDG_CACHE_HOME is ignored, as the XDG specification says');
  assert.equal(profilePath({}, 'linux', home), under(join(home, '.cache')), 'POSIX: ~/.cache');
  assert.equal(profilePath({}, 'darwin', home), under(join(home, '.cache')));
  assert.equal(profileBase({ TMPDIR: '/tmp', TEMP: 'C:\\Temp', TMP: 'C:\\Temp' }, 'linux', home), join(home, '.cache'), 'the temp variables play no part');
  // the real default, with the real home: not the OS temp folder, and the same on every call
  const real = profilePath({});
  assert.equal(real, profilePath({}));
  assert.notEqual(resolve(dirname(real)), resolve(tmpdir()), 'not in the shared temp folder');
  assert.equal(profilePath({ KOLWEN_BROWSER_PROFILE: join(tmpdir(), 'mine') }), resolve(join(tmpdir(), 'mine')));
  assert.equal(profilePath({ KOLWEN_BROWSER_PROFILE: '' }), real, 'an empty value is no value');
  assert.equal(browserLib.PROFILE_ENV, 'KOLWEN_BROWSER_PROFILE');
});

test('nothing in the browser code deletes anything: no rm, rmSync, rmdir, unlink or removeProfile, in code and not only in comments', () => {
  const code = f => readFileSync(join(ROOT, f), 'utf8').split(/\r?\n/).map(l => l.replace(/\/\/.*$/, '')).join('\n');
  for (const f of ['scripts/lib/browser.mjs', 'scripts/rendered-check.mjs', 'scripts/lib/static-server.mjs']) {
    assert.doesNotMatch(code(f), /\b(rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync|removeProfile|runDir|mkdtempSync)\b/, f);
  }
  assert.equal(browserLib.removeProfile, undefined);
  assert.equal(browserLib.runDir, undefined);
});

// A lock port is a hash of the profile path, so a test that locks a path of its own chooses it here: the port of a fixed path can be held on a runner by something that is not this check (main went red
// on that at 3581a1c: port 53356 for /tmp/kolwen-lock-test-b; the holder was never identified, and on Linux it may have been a client socket of the run itself, which the lock range of that day, 49152 to
// 65535, overlapped: see the range test below), and the lock then names the holder as it looks. The candidates are `<stem>`, `<stem>-1`, `<stem>-2` ... in the temp folder (path strings
// only: nothing is made). Each is taken when its port can be bound and released now, and no two chosen paths share a port. There is no retry: when fewer than `count` of `tried` candidates are free
// the test is skipped, visibly, naming the ports that were busy; it never passes on a path it did not check.
const portIsFree = port => new Promise(res => { const s = createServer(); s.once('error', () => res(false)); s.listen(port, '127.0.0.1', () => s.close(() => res(true))); });
async function freeLockPaths(stem, count, tried = 40) {
  const chosen = [], ports = new Set(), busy = [];
  for (let i = 0; i < tried && chosen.length < count; i++) {
    const p = join(tmpdir(), i === 0 ? stem : `${stem}-${i}`), port = browserLib.lockPortOf(p);
    if (ports.has(port)) continue;
    if (await portIsFree(port)) { chosen.push(p); ports.add(port); } else busy.push(port);
  }
  return chosen.length === count ? { paths: chosen } : { skip: `${count} lock port(s) were needed and only ${chosen.length} of ${tried} candidate paths named by ${stem} have one free here; busy: ${busy.join(', ')}` };
}

test('lockProfile: a profile is locked once; a second lock fails at once with one line, giving the lock up frees it, and another profile is not in the way', async t => {
  const got = await freeLockPaths('kolwen-lock-test', 2);
  if (got.skip) { t.skip(got.skip); return; }
  const [a, b] = got.paths;
  const release = await browserLib.lockProfile(a);
  // no clock here: a lock that hung instead of failing would be stopped by the runner's --test-timeout
  await assert.rejects(browserLib.lockProfile(a), e => {
    assert.equal(e.message, `the browser profile ${a} is in use by another run`);
    assert.ok(!e.message.includes('\n'), 'one line');
    return true;
  });
  const other = await browserLib.lockProfile(b);
  await other();
  await release();
  const again = await browserLib.lockProfile(a);
  await again();
});

// The lock's port used to be in 49152 to 65535, which is the whole dynamic range of Windows and macOS (IANA) and overlaps Linux's client-port range, 32768 to 60999
// (`/proc/sys/net/ipv4/ip_local_port_range`, read in WSL on 2026-10-20; a listener cannot take a port an outgoing connection owns, so a plain client socket could make the lock report "a program that is
// not this check"). Measured in WSL with kw1017i-u6/ephemeral-probe.py: of 3,000 outgoing connections to a local listener, 44% were given a port inside the old range and none a port inside 16384 to 32767;
// and a lock-style listen on the ports of 400 open outgoing connections was refused 400 times. The range is now 16384 to 32767: above the registered ports a system hands out by chance, below every default
// client range (Linux 32768, Windows, macOS and the IANA dynamic range 49152). What lives there is real servers, which the lock names as what they are.
test('the lock port range lies below every default client-port range: 16384 to 32767, and on a system that states its own client range (Linux) the two do not overlap', async t => {
  const { LOCK_PORT_FIRST, LOCK_PORT_LAST, lockPortOf } = browserLib;
  assert.deepEqual([LOCK_PORT_FIRST, LOCK_PORT_LAST], [16384, 32767]);
  assert.ok(LOCK_PORT_LAST < 32768, 'under Linux\'s default client range (32768 to 60999)');
  assert.ok(LOCK_PORT_LAST < 49152, 'under the IANA dynamic range that Windows and macOS hand out (49152 to 65535)');
  const seen = new Set();
  for (let i = 0; i < 4000; i++) { const p = lockPortOf(join(tmpdir(), 'kolwen-range-' + i)); assert.ok(p >= LOCK_PORT_FIRST && p <= LOCK_PORT_LAST, String(p)); seen.add(p); }
  assert.ok(seen.size > 3000, 'the hash spreads over the range: ' + seen.size + ' different ports for 4000 paths');
  // a capability probe, never a platform name: a system that states its client range in /proc says it here
  let range = null;
  try { range = readFileSync('/proc/sys/net/ipv4/ip_local_port_range', 'utf8').trim().split(/\s+/).map(Number); } catch { /* no such file: not a Linux that states it */ }
  if (!range || range.length !== 2 || range.some(Number.isNaN)) { t.skip('this system states no client-port range in /proc/sys/net/ipv4/ip_local_port_range'); return; }
  assert.ok(LOCK_PORT_LAST < range[0] || LOCK_PORT_FIRST > range[1], `the lock range ${LOCK_PORT_FIRST}-${LOCK_PORT_LAST} does not overlap this system's client range ${range[0]}-${range[1]}`);
});

test('lockPortOf: the same profile always gives the same port, in 16384 to 32767, and different profiles give different ones', () => {
  const { lockPortOf } = browserLib;
  const a = join(tmpdir(), 'kolwen-lock-test-a'), b = join(tmpdir(), 'kolwen-lock-test-b');
  assert.equal(lockPortOf(a), lockPortOf(a));
  assert.notEqual(lockPortOf(a), lockPortOf(b));
  for (const p of [a, b, '/', 'C:\\x', '', 'a'.repeat(500)]) assert.ok(lockPortOf(p) >= 16384 && lockPortOf(p) <= 32767, p.slice(0, 20));
  assert.equal(lockPortOf('C:\\Users\\A\\x', 'win32'), lockPortOf('c:\\users\\a\\x', 'win32'), 'Windows paths are case-blind');
  assert.notEqual(lockPortOf('/Home/a', 'linux'), lockPortOf('/home/a', 'linux'), 'POSIX paths are not');
});

const countBrowserFolders = () => readdirSync(dirname(browserLib.profilePath())).filter(n => n.startsWith('kolwen-browser-')).length; // beside the profile: the user's cache folder

test('two launches use the same profile folder, and the second makes no new kolwen-browser-* folder', { skip: SKIP_NATIVE }, async () => {
  const first = browser.profile;
  assert.equal(first, browserLib.profilePath());
  const before = countBrowserFolders();
  await browser.close();
  browser = await launchBrowser({ route, lifetimeMs: 600000 });
  assert.equal(browser.profile, first, 'the same folder');
  assert.equal(countBrowserFolders(), before, 'no new kolwen-browser-* folder in the OS temp folder');
  assert.ok(existsSync(first));
});

test('a second launch while a browser has the profile fails at once with one line, makes no second profile, and leaves the first browser working', { skip: SKIP_NATIVE }, async () => {
  const before = countBrowserFolders();
  // no clock here: a launch that hung instead of failing would be stopped by the runner's --test-timeout
  await assert.rejects(launchBrowser({ route }), e => { assert.match(e.message, /^the browser profile .+ is in use by another run$/); assert.ok(!e.message.includes('\n')); return true; });
  assert.equal(countBrowserFolders(), before, 'no second profile');
  const page = await browser.newPage();
  try { assert.equal(await page.evaluate('1 + 1'), 2); } finally { await page.close(); }
});

// ── a context for every page, a marker for the profile, a jar that stays clean ──────────────────────────────────
// The profile of a headless Edge held the computer's Microsoft account sign-in cookies (.MSA.Auth and _U on .bing.com and .msn.com), put there by Edge itself at start. Pages are measured in a browser
// context of their own so they never see that jar, nothing clears a jar browser-wide, a run fails if any jar holds a cookie from outside the served origin, and only a folder this code made is used.
test('prepareProfile: it makes and marks a new folder, accepts its own, adopts an empty one, and refuses any other folder with one line before anything starts', () => {
  const root = mkdtempSync(join(tmpdir(), 'kolwen-test-prep-'));
  copies.push(root);
  const { prepareProfile, MARKER } = browserLib;
  const fresh = join(root, 'fresh');
  prepareProfile(fresh);
  assert.ok(existsSync(join(fresh, MARKER)), 'the marker is written when the folder is made');
  prepareProfile(fresh); // its own folder again: accepted
  const empty = join(root, 'empty');
  mkdirSync(empty);
  prepareProfile(empty);
  assert.ok(existsSync(join(empty, MARKER)), 'an empty folder holds nothing of anyone, so it is adopted and marked');
  // a real browser profile has files and no marker
  const real = join(root, 'User Data');
  mkdirSync(join(real, 'Default'), { recursive: true });
  writeFileSync(join(real, 'Default', 'Cookies'), 'x');
  writeFileSync(join(real, 'Local State'), '{}');
  assert.throws(() => prepareProfile(real), e => {
    assert.match(e.message, /^the browser profile .*User Data is a folder this check did not make \(it has no kolwen-browser-profile\.marker\), so it is not used; point KOLWEN_BROWSER_PROFILE at a new or empty folder$/);
    assert.ok(!e.message.includes('\n'), 'one line');
    return true;
  });
  assert.equal(existsSync(join(real, MARKER)), false, 'and nothing is written into it');
  const file = join(root, 'afile');
  writeFileSync(file, 'x');
  assert.throws(() => prepareProfile(file), /is a folder this check did not make/);
});

test('prepareProfile refuses a profile path that is a symlink or a junction, and writes nothing through it', t => {
  const root = mkdtempSync(join(tmpdir(), 'kolwen-test-link-'));
  copies.push(root);
  const target = join(root, 'target');
  mkdirSync(target);
  const link = join(root, 'link');
  try { symlinkSync(target, link, 'junction'); } catch { t.skip('this system will not make a symlink or a junction'); return; } // a junction needs no privilege on Windows; on POSIX the type is ignored
  assert.throws(() => browserLib.prepareProfile(link), /the browser profile .*link is a link \(a symlink or a junction\), so it is not used$/);
  assert.deepEqual(readdirSync(target), [], 'nothing was written through the link');
});

test('prepareProfile makes the profile folder private (0o700, the marker 0o600), makes an existing folder of its own private, and leaves a folder it refuses untouched', t => {
  const root = mkdtempSync(join(tmpdir(), 'kolwen-test-mode-'));
  copies.push(root);
  // a capability probe, not a guess from the platform name: this volume must keep POSIX mode bits for the assertions to mean anything
  const probe = join(root, 'probe');
  mkdirSync(probe);
  try { chmodSync(probe, 0o755); } catch { t.skip('this volume refuses chmod'); return; }
  if ((statSync(probe).mode & 0o777) !== 0o755) { t.skip('this volume keeps no POSIX mode bits (the runner proves this)'); return; }
  const dir = join(root, 'p');
  browserLib.prepareProfile(dir);
  assert.equal(statSync(dir).mode & 0o077, 0, 'no group or other bit on the folder');
  assert.equal(statSync(dir).mode & 0o700, 0o700);
  assert.equal(statSync(join(dir, browserLib.MARKER)).mode & 0o077, 0, 'no group or other bit on the marker');
  // mkdir gives its mode to a folder it makes, not to one that was there: a folder of ours that was left open is made private by the next run
  chmodSync(dir, 0o755);
  browserLib.prepareProfile(dir);
  assert.equal(statSync(dir).mode & 0o077, 0, 'an existing folder of ours is made private');
  // a folder that is not ours is refused before anything is done to it, its mode included
  const foreign = join(root, 'foreign');
  mkdirSync(foreign);
  writeFileSync(join(foreign, 'Local State'), '{}');
  chmodSync(foreign, 0o755);
  assert.throws(() => browserLib.prepareProfile(foreign), /is a folder this check did not make/);
  assert.equal(statSync(foreign).mode & 0o777, 0o755, 'the refused folder keeps the mode it had');
});

test('writeMarker is an exclusive create: a marker that is already there is never overwritten, and that is not an error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kolwen-test-wx-'));
  copies.push(dir);
  writeFileSync(join(dir, browserLib.MARKER), 'mine');
  browserLib.writeMarker(dir);
  assert.equal(readFileSync(join(dir, browserLib.MARKER), 'utf8'), 'mine');
  const fresh = mkdtempSync(join(tmpdir(), 'kolwen-test-wx-'));
  copies.push(fresh);
  browserLib.writeMarker(fresh);
  assert.match(readFileSync(join(fresh, browserLib.MARKER), 'utf8'), /^made by scripts\/lib\/browser\.mjs/);
  assert.throws(() => browserLib.writeMarker(join(fresh, 'no', 'such', 'folder')), /ENOENT/, 'any other error is not swallowed');
});

test('what CodeQL asked for is in the code: no file is read (so no file data reaches a request), the port is ours, the marker is an exclusive create, the folder is 0o700, and nothing uses the shared temp folder', () => {
  const code = codeOf('scripts/lib/browser.mjs');
  assert.doesNotMatch(code, /DevToolsActivePort|readFileSync|readFile\b|createReadStream/, 'the port file is never read');
  assert.match(code, /\/json\/version/, 'the address comes from the browser\'s own answer');
  assert.match(code, /--remote-debugging-port=\$\{port\}/, 'the port is the one we chose');
  assert.doesNotMatch(code, /remote-debugging-port=0/);
  assert.match(code, /flag: 'wx'/, 'the marker is an exclusive create');
  assert.match(code, /mode: 0o700/, 'the folder is private');
  assert.match(code, /lstatSync\(profile/, 'a link is found without following it');
  assert.doesNotMatch(code, /tmpdir/, 'no shared temp folder');
  assert.doesNotMatch(code, /existsSync\(profile\)/, 'no check of the profile folder followed by a use of it');
});

test('launchBrowser refuses a profile folder it did not make before it starts anything, and writes nothing into it', async () => {
  const real = mkdtempSync(join(tmpdir(), 'kolwen-test-real-'));
  copies.push(real);
  writeFileSync(join(real, 'Local State'), '{}');
  const old = process.env.KOLWEN_BROWSER_PROFILE;
  process.env.KOLWEN_BROWSER_PROFILE = real;
  try {
    // the binary does not exist: a launch that got as far as starting it would fail with a different error
    await assert.rejects(launchBrowser({ binary: join(tmpdir(), 'no-such-browser-binary') }), /^Error: the browser profile .* is a folder this check did not make/);
  } finally { if (old === undefined) delete process.env.KOLWEN_BROWSER_PROFILE; else process.env.KOLWEN_BROWSER_PROFILE = old; }
  assert.deepEqual(readdirSync(real), ['Local State']);
});

test('foreignCookies: only the served origin\'s own cookies are allowed in a jar', () => {
  const f = browserLib.foreignCookies;
  const jar = [{ name: 'a', domain: '127.0.0.1' }, { name: 'b', domain: '.bing.com' }, { name: 'c', domain: 'www.bing.com' }, { name: 'd', domain: '.127.0.0.1' }, { name: 'e', domain: 'localhost' }];
  assert.deepEqual(f(jar).map(c => c.name), ['b', 'c', 'e']);
  assert.deepEqual(f([]), []);
});

test('nothing clears cookies or the cache browser-wide: no clearBrowserCookies, clearBrowserCache, clearCookies or clearState in the run path', () => {
  const code = f => readFileSync(join(ROOT, f), 'utf8').split(/\r?\n/).map(l => l.replace(/\/\/.*$/, '')).join('\n');
  for (const f of ['scripts/lib/browser.mjs', 'scripts/rendered-check.mjs']) assert.doesNotMatch(code(f), /clearBrowserCookies|clearBrowserCache|clearCookies|clearState|clearDataForOrigin/, f);
});

test('every page lives in a context of its own: it sees nothing of another page\'s storage or cookies or of the default context, a cookie list carries no value, and close() disposes the context', { skip: SKIP }, async () => {
  const server = await browser.serve(join(ROOT, 'web'), { headers: false }); // before the pages: the WSL route answers over the pages' own channel
  const contexts = async () => (await browser.send('Target.getBrowserContexts')).browserContextIds.length;
  const base = await contexts();
  const a = await browser.newPage(), b = await browser.newPage();
  try {
    assert.equal(await contexts(), base + 2, 'one context for each page');
    await a.goto(server.origin + '/pricing');
    await a.evaluate('document.querySelector(\'[data-lang-set="th"]\').click()');
    await a.goto(server.origin + '/terms');
    assert.equal(await a.evaluate('document.documentElement.lang'), 'th', 'precondition: a context remembers its own language');
    await b.goto(server.origin + '/terms');
    assert.equal(await b.evaluate('document.documentElement.lang'), 'en', 'another context does not');
    await a.send('Network.setCookie', { name: 'kwctx', value: 'not-for-print', url: server.origin + '/' });
    const mine = await a.cookies();
    assert.deepEqual(mine.map(c => c.name), ['kwctx']);
    assert.deepEqual(Object.keys(mine[0]).sort(), ['domain', 'name'], 'name and domain only: the value is dropped where the browser answers');
    assert.deepEqual(await b.cookies(), [], 'not in the other context');
    assert.equal((await browser.defaultCookies()).some(c => c.name === 'kwctx'), false, 'and not in the default jar');
  } finally { await a.close(); await b.close(); await server.close(); }
  assert.equal(await contexts(), base, 'both contexts are disposed');
});

test('the browser resolves no host name: localhost does not resolve, the server on 127.0.0.1 does', { skip: SKIP }, async () => {
  const server = await browser.serve(join(ROOT, 'web'), { headers: false }); // before the pages: the WSL route answers over the pages' own channel
  const page = await browser.newPage();
  try {
    const port = new URL(server.origin).port;
    const named = await page.send('Page.navigate', { url: `http://localhost:${port}/` });
    assert.equal(named.errorText, 'net::ERR_NAME_NOT_RESOLVED', 'a host name is not resolved, so no Microsoft endpoint can be reached');
    const ip = await page.send('Page.navigate', { url: server.origin + '/' });
    assert.equal(ip.errorText, undefined, 'the served origin on 127.0.0.1 loads');
  } finally { await page.close(); await server.close(); }
});

test('the jar check: a cookie from outside the served origin fails the run, in the default context and in the context of a page, with its name and domain and never its value', { skip: SKIP }, async () => {
  const PLANTED_VALUE = 'kwplantedvalue';
  const planted = value => browser.send('Storage.setCookies', { cookies: [{ name: 'kwplanted', value, domain: 'kwprobe.invalid', path: '/', ...(value === PLANTED_VALUE ? {} : { expires: 1 }) }] });
  await planted(PLANTED_VALUE);
  try {
    const r = await run(copyWeb(), ['reflow']);
    const hit = r.failures.filter(f => f.check === 'cookies');
    assert.equal(hit.length, 1, JSON.stringify(r.failures));
    assert.equal(hit[0].page, '(browser profile)');
    assert.match(hit[0].detail, /^1 cookie\(s\) outside the served 127\.0\.0\.1 origin in the default context of the browser profile .+: kwprobe\.invalid \(kwplanted\)$/);
    assert.ok(!JSON.stringify(r).includes(PLANTED_VALUE), 'the value is nowhere in the result');
  } finally { await planted('gone'); } // an expired cookie of the same name is the removal
  assert.equal((await browser.defaultCookies()).some(c => c.name === 'kwplanted'), false, 'the planted cookie is gone again');
  assert.deepEqual((await run(copyWeb(), ['reflow'])).failures, [], 'with the jar clean the same run passes');
  // the jar of a page's own context is read before the context is disposed
  const wrapped = { ...browser, newPage: async () => { const p = await browser.newPage(), real = p.cookies; return Object.assign(p, { cookies: async () => [...(await real()), { name: 'kwctxbad', domain: '.bing.com' }] }); } };
  const r2 = await renderedChecks({ webDir: copyWeb(), browser: wrapped, checks: ['reflow'], headers: false });
  const pages = r2.failures.filter(f => f.check === 'cookies');
  assert.equal(pages.length, PAGE_COUNT * 2, 'one per page and language (' + PAGE_COUNT + ' x 2): ' + pages.length);
  assert.ok(pages.every(f => f.detail === '1 cookie(s) outside the served 127.0.0.1 origin in the browser context of this page: .bing.com (kwctxbad)'), pages[0].detail);
});

test('the command line: with no browser route CI fails (1) and a developer run says "not run here" and exits 3, never a pass', () => {
  const script = join(ROOT, 'scripts/rendered-check.mjs');
  // the children run with their own HOME and TEMP, in a folder this test made
  const home = mkdtempSync(join(tmpdir(), 'kolwen-cli-home-'));
  copies.push(home);
  const env = { ...process.env, HOME: home, USERPROFILE: home, TEMP: home, TMP: home, TMPDIR: home, XDG_CONFIG_HOME: home, [BROWSER_ENV]: join(tmpdir(), 'no-such-browser-binary') };
  const ci = spawnSync(process.execPath, ['--max-old-space-size=256', script], { encoding: 'utf8', timeout: 60000, env: { ...env, CI: 'true' } });
  assert.equal(ci.status, 1);
  assert.match(ci.stderr, /FAIL rendered-check: .* did not run here\. In CI a missing browser is a failure, never a skip/);
  const local = spawnSync(process.execPath, ['--max-old-space-size=256', script], { encoding: 'utf8', timeout: 60000, env: { ...env, CI: '' } });
  assert.equal(EXIT_NOT_RUN_HERE, 3);
  assert.equal(local.status, EXIT_NOT_RUN_HERE, 'a distinct code: not a pass (0), not a finding (1), not a bad argument (2)');
  assert.match(local.stdout, /NOT RUN HERE rendered-check: .* did not run here\. This is not a pass: the pass is the pull request's CI \(the rendered job\), or a person's own browser looking at the pages\./);
  assert.equal(local.stdout.trim().split('\n').length, 1, 'one line');
  const bad = spawnSync(process.execPath, ['--max-old-space-size=256', script, '--nope'], { encoding: 'utf8', timeout: 60000, env });
  assert.equal(bad.status, 2);
  const only = spawnSync(process.execPath, ['--max-old-space-size=256', script, '--only', 'colour'], { encoding: 'utf8', timeout: 60000, env });
  assert.equal(only.status, 2);
});

test('on Windows the command line without WSL says "not run here" in one line and exits 3, and a Windows browser named in KOLWEN_BROWSER is refused', { skip: process.platform === 'win32' ? false : 'Windows only (the route is decided by the platform)' }, () => {
  const script = join(ROOT, 'scripts/rendered-check.mjs');
  const home = mkdtempSync(join(tmpdir(), 'kolwen-cli-home-'));
  copies.push(home);
  const env = { ...process.env, HOME: home, USERPROFILE: home, TEMP: home, TMP: home, TMPDIR: home, CI: '' };
  delete env[BROWSER_ENV];
  // WSL made unreachable: windir is a folder that does not exist, so the System32 wsl.exe is not there
  const noWsl = spawnSync(process.execPath, ['--max-old-space-size=256', script], { encoding: 'utf8', timeout: 60000, env: withWindir(env, join(tmpdir(), 'no-such-dir')) });
  assert.equal(noWsl.status, EXIT_NOT_RUN_HERE);
  assert.match(noWsl.stdout, /NOT RUN HERE rendered-check: WSL is not available here .* did not run here\. This is not a pass/);
  assert.equal(noWsl.stdout.trim().split('\n').length, 1, 'one line');
  // an existing Windows program named as the browser: refused, and nothing is started (the program is node itself, so it cannot be mistaken for a browser launch)
  const refused = spawnSync(process.execPath, ['--max-old-space-size=256', script], { encoding: 'utf8', timeout: 60000, env: withWindir({ ...env, [BROWSER_ENV]: process.execPath }, join(tmpdir(), 'no-such-dir')) });
  assert.equal(refused.status, EXIT_NOT_RUN_HERE);
  assert.match(refused.stdout, /NOT RUN HERE rendered-check: KOLWEN_BROWSER names .*, which is not the WSL route: on Windows this check never starts a Windows browser/);
});

test('urlPathOf maps a page file to the path the Worker serves', () => {
  assert.equal(urlPathOf('index.html'), '/');
  assert.equal(urlPathOf('pricing.html'), '/pricing');
  assert.equal(urlPathOf('404.html'), '/404');
  assert.equal(urlPathOf('docs/index.html'), '/docs/');
});

// ── the routes: Windows never starts a Windows browser; WSL is found by measurement; the pages travel by the browser's own channel ──────────────────────
// A Windows path built from parts, so no backslash has to be typed into a string literal.
const win = (...parts) => parts.join(String.fromCharCode(92));

test('findBrowser never returns a Windows browser: on win32 it is null whatever exists and whatever KOLWEN_BROWSER names; the other platforms still find theirs', () => {
  const everything = () => true;
  assert.equal(findBrowser({}, 'win32', everything), null);
  assert.equal(findBrowser({ [BROWSER_ENV]: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' }, 'win32', everything), null);
  assert.equal(findBrowser({ [BROWSER_ENV]: 'C:/x/chrome.exe', ProgramFiles: 'C:/Program Files', LOCALAPPDATA: 'C:/L' }, 'win32', everything), null);
  assert.equal(findBrowser({ [BROWSER_ENV]: win('C:', 'x', 'msedge.exe') }, 'win32', everything), null);
  assert.equal(findBrowser({ PATH: '/usr/bin' }, 'linux', p => p.endsWith('chromium')), join('/usr/bin', 'chromium'));
  assert.ok(findBrowser({}, 'darwin', p => p.includes('Google Chrome')).includes('Google Chrome'));
});

// A stand-in for wsl.exe: -l -q answers with a UTF-16 list (as the real one does), anything else is the probe script's answer.
const fakeWsl = ({ list = 'Ubuntu' + String.fromCharCode(13, 10), probe = 'kolwen-wsl: OK\n', listStatus = 0, calls = [] } = {}) => (args) => {
  calls.push(args);
  if (args[0] === '-l') return { status: listStatus, stdout: Buffer.from(list, 'utf16le'), error: null };
  return { status: 0, stdout: Buffer.from(probe), error: null };
};

const SCRIPTS_ON_C = win('C:', 'repo', 'scripts', 'wsl'); // the scripts folder as it is on a Windows machine, whatever machine this test runs on
test('findRoute on Windows: only the WSL route; the distro must exist AND the headless shell must be at its stable path; a Windows browser in KOLWEN_BROWSER is refused', () => {
  const calls = [];
  const ok = findRoute({}, 'win32', { scriptsDir: SCRIPTS_ON_C, run: fakeWsl({ calls }) });
  assert.deepEqual(ok, { kind: 'wsl', distro: 'Ubuntu' });
  const probe = calls.find(a => a[0] === '-d');
  assert.deepEqual(probe.slice(0, 4), ['-d', 'Ubuntu', '--exec', 'bash'], 'argv, started without a shell: nothing is a string a shell parses');
  assert.match(probe[4], /^\/mnt\/[a-z]\/.*\/scripts\/wsl\/probe\.sh$/);
  assert.equal(probe.length, 5);
  assert.equal(findRoute({ [BROWSER_ENV]: 'wsl' }, 'win32', { scriptsDir: SCRIPTS_ON_C, run: fakeWsl() }).kind, 'wsl');
  assert.equal(findRoute({ [BROWSER_ENV]: 'wsl:Ubuntu' }, 'win32', { scriptsDir: SCRIPTS_ON_C, run: fakeWsl() }).distro, 'Ubuntu');
  const other = findRoute({ [BROWSER_ENV]: 'wsl:Debian' }, 'win32', { scriptsDir: SCRIPTS_ON_C, run: fakeWsl() });
  assert.equal(other.kind, 'none');
  assert.match(other.why, /WSL has no distro named Debian/);
  // a Windows browser, or any program, named as the browser: refused with its reason, and nothing is asked of WSL
  for (const named of ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', win('C:', 'chrome.exe'), process.execPath, 'wslx', 'wsl:', 'wsl:a b', 'msedge']) {
    const asked = [];
    const r = findRoute({ [BROWSER_ENV]: named }, 'win32', { scriptsDir: SCRIPTS_ON_C, run: fakeWsl({ calls: asked }) });
    assert.equal(r.kind, 'refused', named);
    assert.match(r.why, /is not the WSL route: on Windows this check never starts a Windows browser; set it to wsl or wsl:<distro>, or leave it unset$/, named);
    assert.equal(asked.length, 0, 'WSL is not even asked: ' + named);
    assert.ok(r.why.startsWith(`KOLWEN_BROWSER names ${JSON.stringify(named)}, which`), 'the value is quoted: ' + r.why);
  }
  // PR #62: the value of KOLWEN_BROWSER is written into a one-line report, so a line break in it never reaches the report raw
  const forgedBrowser = 'wsl' + String.fromCharCode(10) + 'rendered-check passed: 8 page(s) x 2 languages';
  const forgedRoute = findRoute({ [BROWSER_ENV]: forgedBrowser }, 'win32', { scriptsDir: SCRIPTS_ON_C, run: fakeWsl() });
  assert.equal(forgedRoute.kind, 'refused');
  assert.equal(forgedRoute.why.split('\n').length, 1, 'one line: ' + JSON.stringify(forgedRoute.why));
  assert.ok(forgedRoute.why.includes('\\n'), 'the line break is written as \\n');
  // the two halves of the measurement
  const noDistro = findRoute({}, 'win32', { scriptsDir: SCRIPTS_ON_C, run: fakeWsl({ list: 'docker-desktop' + String.fromCharCode(13, 10) }) });
  assert.deepEqual([noDistro.kind, noDistro.why], ['none', 'WSL has no distro']);
  const noShell = findRoute({}, 'win32', { scriptsDir: SCRIPTS_ON_C, run: fakeWsl({ probe: 'kolwen-wsl: NOBIN\n' }) });
  assert.equal(noShell.kind, 'none');
  assert.match(noShell.why, /^the headless shell is not executable at ~\/tools\/chrome-headless-shell-linux64\/chrome-headless-shell in the WSL distro Ubuntu$/);
  const gone = findRoute({}, 'win32', { scriptsDir: SCRIPTS_ON_C, run: () => ({ status: null, stdout: Buffer.alloc(0), error: Object.assign(new Error('x'), { code: 'ENOENT' }) }) });
  assert.equal(gone.kind, 'none');
  assert.match(gone.why, /^WSL is not available here \(wsl\.exe could not be started: ENOENT\)$/);
  // docker's own distros are not ours
  assert.equal(findRoute({}, 'win32', { scriptsDir: SCRIPTS_ON_C, run: fakeWsl({ list: 'docker-desktop\r\nUbuntu-24.04\r\n' }) }).distro, 'Ubuntu-24.04');
  // other platforms: native, or none
  assert.deepEqual(findRoute({ PATH: '/usr/bin' }, 'linux', { exists: p => p.endsWith('google-chrome') }), { kind: 'native', binary: join('/usr/bin', 'google-chrome') });
  assert.equal(findRoute({ PATH: '' }, 'linux', { exists: () => false }).kind, 'none');
});

test('toWslPath and decodeWslText: a Windows path as the distro sees it, and the UTF-16 that wsl.exe prints for itself', () => {
  const { toWslPath, decodeWslText } = wslLib;
  assert.equal(toWslPath(win('C:', 'Users', 'a b', 'x', 'scripts', 'wsl', 'probe.sh')), '/mnt/c/Users/a b/x/scripts/wsl/probe.sh');
  assert.equal(toWslPath('D:/x//y/'), '/mnt/d/x/y');
  assert.equal(toWslPath(win('', '', 'server', 'share', 'x')), null, 'a UNC path is not on a drive the distro can see');
  assert.equal(toWslPath('scripts/wsl/probe.sh'), null);
  assert.equal(toWslPath('C:'), null);
  assert.equal(decodeWslText(Buffer.from(String.fromCharCode(0xfeff) + 'Ubuntu\r\n', 'utf16le')), 'Ubuntu\r\n', 'UTF-16 with a byte-order mark');
  assert.equal(decodeWslText(Buffer.from('Ubuntu\n', 'utf16le')), 'Ubuntu\n');
  assert.equal(decodeWslText(Buffer.from('kolwen-wsl: OK\n')), 'kolwen-wsl: OK\n', 'what a Linux program prints is UTF-8');
  assert.equal(decodeWslText(Buffer.alloc(0)), '');
});

test('makeResponder: the answer is a function of the URL: pages, clean URLs, a 404, nothing outside the root and never _headers; the real headers when asked', () => {
  const respond = makeResponder(join(ROOT, 'web'), { headers: true });
  const has = (r, name) => Object.keys(r.headers).some(k => k.toLowerCase() === name);
  const home = respond('/');
  assert.equal(home.status, 200);
  assert.match(home.headers['content-type'], /^text\/html/);
  assert.ok(home.body.length > 1000 && Buffer.isBuffer(home.body));
  assert.ok(has(home, 'content-security-policy'), 'the rule of _headers for /* is applied');
  assert.equal(respond('/pricing').status, 200);
  assert.equal(respond('/pricing.html').status, 200);
  assert.equal(respond('/404').status, 200, 'served with 200: this is for rendering, the 404 status is the post-deploy check\'s');
  assert.equal(respond('/?x=1').status, 200, 'a query is ignored');
  assert.match(respond('/fonts/fonts.css').headers['content-type'], /^text\/css/);
  for (const bad of ['/nope', '/_headers', '/_redirects', '/../package.json', '/%2e%2e/package.json', '/%', '/fonts/../../package.json']) {
    const r = respond(bad);
    assert.equal(r.status, 404, bad);
    assert.equal(r.body.toString(), 'not found');
  }
  assert.ok(!has(makeResponder(join(ROOT, 'web'), { headers: false })('/'), 'content-security-policy'), 'with the headers off there are none');
});

test('makeResponder: header names are lower-case, so a rule of _headers that overlaps a default replaces it and no name is there twice', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kolwen-test-hdr-'));
  copies.push(dir);
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>x</title>');
  writeFileSync(join(dir, '_headers'), '/*\n  Content-Type: text/x-test\n  Cache-Control: max-age=5\n  X-Mixed-Case: yes\n');
  const home = makeResponder(dir, { headers: true })('/');
  const names = Object.keys(home.headers);
  assert.deepEqual(names, names.map(n => n.toLowerCase()), 'every name is lower-case');
  assert.equal(new Set(names).size, names.length, 'no name twice');
  assert.equal(home.headers['content-type'], 'text/x-test', 'the rule replaces the default');
  assert.equal(home.headers['cache-control'], 'max-age=5');
  assert.equal(home.headers['x-mixed-case'], 'yes');
});

test('makeResponder: a file inside the root is answered 200 with its own bytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kolwen-test-serve-'));
  copies.push(dir);
  writeFileSync(join(dir, 'note.txt'), 'inside');
  const r = makeResponder(dir, { headers: false })('/note.txt');
  assert.equal(r.status, 200);
  assert.equal(r.body.toString(), 'inside');
});

test('makeResponder: a file link inside the root that points at a file outside it is answered 404, and the outside file is never served', t => {
  const root = mkdtempSync(join(tmpdir(), 'kolwen-test-link-root-'));
  const outside = mkdtempSync(join(tmpdir(), 'kolwen-test-link-out-'));
  copies.push(root, outside);
  writeFileSync(join(outside, 'secret.txt'), 'outside');
  try { symlinkSync(join(outside, 'secret.txt'), join(root, 'leak.txt')); } catch { t.skip('this system will not make a file symlink'); return; }
  const r = makeResponder(root, { headers: false })('/leak.txt');
  assert.equal(r.status, 404);
  assert.equal(r.body.toString(), 'not found');
  assert.ok(!r.body.toString().includes('outside'));
});

test('makeResponder: a folder link inside the root that points at a folder outside it is answered 404 for a file in it', t => {
  const root = mkdtempSync(join(tmpdir(), 'kolwen-test-dir-root-'));
  const outside = mkdtempSync(join(tmpdir(), 'kolwen-test-dir-out-'));
  copies.push(root, outside);
  writeFileSync(join(outside, 'secret.txt'), 'outside');
  try { symlinkSync(outside, join(root, 'linked'), 'junction'); } catch { t.skip('this system will not make a folder link or a junction'); return; } // a junction needs no privilege on Windows
  const r = makeResponder(root, { headers: false })('/linked/secret.txt');
  assert.equal(r.status, 404);
  assert.equal(r.body.toString(), 'not found');
});

test('a language value with a line break, a carriage return or an escape is reported as one escaped field, with no control character in the finding', { skip: SKIP }, async () => {
  // the value is written by the page, not by us: the page's own html lang attribute holds the three characters (a parser turns a carriage return into a line break)
  const odd = String.fromCharCode(10, 13, 27) + '[31m';
  const web = copyWeb(w => editPage(w, 'pricing.html', h => h.split('data-lang-set=').join('data-lang-x=').replace('<html lang="en"', '<html lang="en' + odd + '"')));
  const lang = (await run(web, ['reflow'])).failures.filter(f => f.page === 'pricing.html' && f.check === 'language');
  assert.equal(lang.length, 2, 'the two languages of the page, each one finding: ' + JSON.stringify(lang));
  for (const f of lang) {
    assert.doesNotMatch(f.detail, /[\u0000-\u001f\u007f]/, 'no raw control character in the finding');
    assert.match(f.detail, /reports lang="en\\n\\n\\u001b\[31m"\)/, 'the value is shown escaped: ' + f.detail);
  }
});

test('noteLine: a browser message with a line break, a carriage return or an escape stays on the one NOTE line, escaped', () => {
  const ctl = String.fromCharCode(10, 13, 27);
  const line = checkLib.noteLine([{ text: 'Error with Permissions-Policy header: x' + ctl + '[0m', page: 'index.html' }]);
  assert.equal(line.split('\n').length, 1, 'one line');
  assert.doesNotMatch(line, /[\u0000-\u001f\u007f]/, 'no raw control character');
  assert.match(line, /Permissions-Policy header: x\\n\\r\\u001b\[0m/);
});

test('a Content-Security-Policy violation whose message carries a line break, a carriage return or an escape is one FAIL line, with no control character in it', () => {
  const ctl = String.fromCharCode(10, 13, 27);
  const detail = checkLib.violationDetail({ text: 'Refused to apply' + ctl + '[0m inline style' });
  const line = checkLib.failLine({ page: 'index.html', lang: 'en', check: 'csp', detail });
  assert.equal(line.split('\n').length, 1, 'one line');
  assert.doesNotMatch(line, /[\x00-\x1f\x7f]/, 'no raw control character');
  assert.match(line, /reports: Refused to apply\\n\\r\\u001b\[0m inline style/);
});

test('a page file name carrying a line break, a carriage return or an escape stays inside its one FAIL line, escaped', () => {
  const ctl = String.fromCharCode(10, 13, 27);
  const line = checkLib.failLine({ page: 'a' + ctl + 'FAIL forged.html', lang: 'en', check: 'reflow', detail: 'wider than the viewport' });
  assert.equal(line.split('\n').length, 1, 'one line');
  assert.doesNotMatch(line, /[\x00-\x1f\x7f]/, 'no raw control character');
  assert.match(line, /^FAIL a\\n\\r\\u001bFAIL forged\.html \[en\] reflow: wider than the viewport$/);
});

test('reportField: the line and paragraph separators, DEL and the C1 controls come back as six-character escapes; ordinary text, Thai included, comes back unchanged', () => {
  const BS = String.fromCharCode(92);
  for (const code of [0x2028, 0x2029, 0x7f, 0x80, 0x85, 0x9f]) {
    const out = reportField(String.fromCharCode(code));
    assert.equal(out, BS + 'u' + code.toString(16).padStart(4, '0'), 'U+' + code.toString(16));
    assert.equal(out.length, 6);
  }
  assert.equal(reportField('ภาษาไทย ทดสอบ 123'), 'ภาษาไทย ทดสอบ 123');
  assert.equal(reportField('a"b'), 'a' + BS + '"b');
});

test('makeResponder: a link named a.css to a file named a.txt is answered with the bytes of the file and the type of the name asked for, text/css', t => {
  const root = mkdtempSync(join(tmpdir(), 'kolwen-test-type-'));
  copies.push(root);
  writeFileSync(join(root, 'a.txt'), 'body{}');
  try { symlinkSync(join(root, 'a.txt'), join(root, 'a.css')); } catch { t.skip('this system will not make a file symlink'); return; }
  const r = makeResponder(root, { headers: false })('/a.css');
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'text/css; charset=utf-8');
  assert.equal(r.body.toString(), 'body{}');
});

test('the DevTools route answers HEAD with the headers and an empty body, and any other method with the page', () => {
  const out = { status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<p>page') };
  const head = browserLib.fulfillParams('r1', 'HEAD', out), get = browserLib.fulfillParams('r1', 'GET', out);
  assert.equal(head.body, '');
  assert.equal(Buffer.from(get.body, 'base64').toString(), '<p>page');
  assert.deepEqual(head.responseHeaders, get.responseHeaders, 'the headers are the same');
  assert.equal(head.responseCode, 200);
  assert.equal(head.requestId, 'r1');
});

// This assertion CAN go red (CodeRabbit's catch-up of #55 read the Fetch spec and said it cannot): measured 2026-10-22 on the WSL route, with fulfillParams made to send the body on a HEAD, `h.text()` here read
// 20,929 characters and the assertion failed, so a Blink that is handed a body for a HEAD shows it to fetch. The unit test above reads the parameters themselves.
test('a HEAD request gets no body and a GET the whole page, on whichever route the browser takes', { skip: SKIP }, async () => {
  const server = await browser.serve(join(ROOT, 'web'), { headers: false });
  const page = await browser.newPage();
  try {
    await page.goto(server.origin + '/');
    const seen = await page.evaluate(`(async () => { const h = await fetch('/', { method: 'HEAD' }), g = await fetch('/'); return { head: (await h.text()).length, headStatus: h.status, get: (await g.text()).length }; })()`);
    assert.equal(seen.headStatus, 200);
    assert.equal(seen.head, 0, 'HEAD: no body');
    assert.ok(seen.get > 1000, 'GET: the page');
  } finally { await page.close(); await server.close(); }
});

// Q-11: a page listens for the browser's events (Log.entryAdded, Network.*, Fetch.requestPaused, Page.loadEventFired), and the connection used to keep every handler for as long as it lived, so a long
// run held one set per page ever opened, each filtering on a session id that no longer existed. A closed page now takes its handlers with it, and a load wait takes its own away once it is over.
test('a page that is closed leaves no event handler on the connection, and a navigation leaves none behind', { skip: SKIP }, async () => {
  const server = await browser.serve(join(ROOT, 'web'), { headers: false });
  const base = browser.listenerCount();
  try {
    for (let round = 0; round < 3; round++) {
      const page = await browser.newPage();
      const open = browser.listenerCount();
      assert.ok(open > base, 'an open page holds its handlers');
      await page.goto(server.origin + '/');
      await page.goto(server.origin + '/pricing');
      assert.equal(browser.listenerCount(), open, 'a finished navigation leaves no handler of its own');
      await page.close();
      assert.equal(browser.listenerCount(), base, 'a closed page leaves none (round ' + round + ')');
    }
  } finally { await server.close(); }
});

test('the WSL route starts only the System32 wsl.exe: KOLWEN_WSL_EXE no longer exists, so a renamed binary is never started', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kolwen-test-wsl-'));
  copies.push(dir);
  // A copy of node.exe saved as <odd dir>/wsl.exe is NAMED wsl.exe, and the old name check let it through
  const odd = join(dir, 'odd dir');
  mkdirSync(odd);
  const renamed = join(odd, 'wsl.exe');
  cpSync(process.execPath, renamed);
  const root = join(dir, 'root'); // a windir with no System32: the system wsl.exe is not there
  mkdirSync(root);
  const env = { KOLWEN_WSL_EXE: renamed, windir: root, SystemRoot: root };
  assert.equal(wslLib.systemWslExe(env), win32.join(root, 'System32', 'wsl.exe'), 'the program is derived from SystemRoot and from nothing else');
  const direct = wslLib.wslRun(['-l', '-q'], env);
  assert.equal(direct.status, null, 'the renamed copy of node.exe was not started (a started node.exe exits 9 on -l)');
  assert.ok(direct.error, 'the missing System32 wsl.exe is the failure');
  // route discovery with its DEFAULT runner (an injected one never reaches the program selection): it starts the System32 wsl.exe, which is missing here, and not the renamed copy (that one exits 9)
  const r = wslLib.findWslRoute({ env });
  assert.equal(r.kind, 'none', 'discovery found no route');
  assert.match(r.why, /could not be started: ENOENT/, 'the failure is the missing System32 wsl.exe, so the copy named in KOLWEN_WSL_EXE was not started: ' + r.why);
  const h = wslLib.startWslBrowser({ distro: 'Ubuntu', port: 1, lifetimeS: 1, scriptsDir: SCRIPTS_ON_C, env });
  for (let i = 0; i < 100 && !h.exited(); i++) await new Promise(res => setTimeout(res, 50));
  assert.equal(h.spawnError()?.code, 'ENOENT', 'startWslBrowser started the System32 wsl.exe, which is missing here: nothing named in the call is started');
  // windir unset: SystemRoot, then C:\Windows
  assert.equal(wslLib.systemWslExe({ windir: 'D:\\W' }), 'D:\\W\\System32\\wsl.exe');
  assert.equal(wslLib.systemWslExe({ SystemRoot: 'E:\\R' }), 'E:\\R\\System32\\wsl.exe');
  assert.equal(wslLib.systemWslExe({}), 'C:\\Windows\\System32\\wsl.exe');
});

// Every script that starts itself when it is run has the same guard, from scripts/lib/entry-guard.mjs: run through a
// junction or a symlink it does what a direct run does, and an import runs nothing. The scripts run in a bare copy of scripts/ (no web/, no git), where each one ends in its own failure line and a
// code other than 0: so a silent 0 is the guard's doing and nothing else. A script is added to this list when it starts itself, or the first test below fails.
const SELF_RUNNING = ['address-check', 'decap-battery', 'font-subset', 'page-weight', 'rendered-check', 'reply-language-check', 'sitemap-lastmod'];

// The bare copy and a way to run a script of it: the folder is made here, and nothing outside it is touched.
function bareCopy() {
  const root = mkdtempSync(join(tmpdir(), 'kolwen-test-guards-'));
  copies.push(root);
  const real = join(root, 'real'), work = join(root, 'work');
  cpSync(join(ROOT, 'scripts'), real, { recursive: true });
  mkdirSync(work);
  let env = { ...process.env, HOME: work, USERPROFILE: work, TEMP: work, TMP: work, TMPDIR: work, CI: 'true', [BROWSER_ENV]: join(tmpdir(), 'no-such-dir', 'no-such-browser') };
  if (process.platform === 'win32') env = withWindir(env, join(tmpdir(), 'no-such-dir'));
  const run = args => spawnSync(process.execPath, ['--max-old-space-size=256', ...args], { encoding: 'utf8', timeout: 60000, env, cwd: work });
  return { root, real, run };
}
const importOf = file => ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(file).href)})`];

// How the scan finds a script that starts itself, and the spellings it refuses, is scripts/lib/entry-scan.mjs (header). STATED LIMITS, kept true by the test below: it reads text. A guard that reaches argv
// through a name built at run time (`Reflect.get(process, 'ar' + 'gv')`), an alias of the whole `process` object (`const p = process; p.argv.at(1)`), `eval`, or a compare that reaches
// `import.meta.url` through a call other than fileURLToPath (`new URL(import.meta.url).pathname === x`) is not seen; a comment marker inside a string is read as a comment (a `//` cuts the rest of that line from the scan, a `/*` cuts everything up to the next `*/` on any later line, a guard in that span included);
// and a script that starts itself by a way that reads no path at all (a top-level call that is not behind any guard) is not a "self-running" script but a script that runs on import, which the
// import test below finds only for the listed ones.
test('the scan for a script that starts itself refuses the ways to ask "am I the main module" that it can read, and lets an argument and the shared guard through', () => {
  // The fixtures below that carry a template literal's interpolation are source text the scan is fed, NOT templates of this file: the backtick and the dollar sign are built from their code points and the
  // brace is joined to them, so no string of this file reads as a template written inside quotes (CodeQL js/template-syntax-in-string-literal, alert 53). The strings the scan reads are unchanged.
  const BT = String.fromCharCode(96), DOLLAR = String.fromCharCode(36), BS = String.fromCharCode(92);
  const tpl = inner => BT + DOLLAR + '{' + inner + '}' + BT;
  const planted = [
    'if (fileURLToPath(import.meta.url) === resolve(process.argv.at(1) ?? "")) main();', 'if (import.meta.main) main();', 'if (import.meta.filename === process.argv[1]) main();',
    "if (import.meta.url.endsWith('x.mjs')) main();", "if (import.meta.url.includes('x')) main();", 'if (import.meta.url === pathToFileURL(a).href) main();', 'if (pathToFileURL(a).href !== import.meta.url) {}',
    'if (process.argv[1].endsWith("x.mjs")) main();', 'const [, self] = process.argv;', 'const self = process.argv.slice(1)[0];', 'const self = process.argv.at(-1);', "const argv = process['argv'];",
    'const { argv } = process; if (argv[1]) main();', 'const a = process.argv; if (a[1]) main();', 'if (process . argv [ 1 ]) main();',
    // CodeRabbit 4309797621, PR #58: a compare that reaches import.meta.url through fileURLToPath is a guard of its own, on either side
    'if (fileURLToPath(import.meta.url) === x) main();', 'if (x === fileURLToPath(import.meta.url)) main();', 'if (fileURLToPath( import.meta.url ) !== y) return;',
    // The argument reads that remain refused ask which file is the main module
    'const [, self] = process.argv; const [, , a] = process.argv; const s = process.argv[1];', 'process.argv.includes(selfPath)', 'process.argv.indexOf(__filename)', 'process.argv.at(2)', 'process.argv[0]',
    'const { x, argv: a } = process;', 'const { x, y: z, argv = [] } = process;',
    // Two forms that read the script's own path passed the allow-list: an `includes` of a template that carries `${...}`, and a `slice` whose argument is an expression that
    // starts with a 2 or more but is worth 1; and a third of their kind, found while closing them: an `includes` of a literal joined to a name
    'if (process.argv.includes(' + tpl('fileURLToPath(import.meta.url)') + ')) main();', 'if (process.argv.slice(2 - 1)[0] === here) main();', "process.argv.includes('--x' + here)", "process.argv.indexOf(`x` + here)",
    'process.argv.slice(3 - 2, 5)', 'process.argv.slice(2 > 1 ? 1 : 2)', 'process.argv.includes(' + tpl('here') + ', 1)',
    // CodeRabbit 4322398861, PR #62: an escaped delimiter does not end a literal. These are `includes('\')'` followed by `.slice(2) + here)` (a real string `')`, then an expression that joins a name to
    // it), and its backtick and double-quote twins: the allow-list took the escaped quote as the end of the literal and the `)` after it as the end of the call
    "process.argv.includes('" + BS + "')'.slice(2) + here)", 'process.argv.indexOf(' + BT + BS + BT + ')' + BT + '.slice(2) + here)', 'process.argv.includes("' + BS + '")".slice(2) + here)',
    // still refused: a literal that ends in a backslash, an escaped closer that leaves the literal open, and a real interpolation after an escaped backslash
    "process.argv.includes('abc" + BS, "process.argv.includes('x" + BS + "')", 'process.argv.includes(' + BT + 'a' + BS + BS + DOLLAR + '{here}' + BT + ')',
  ];
  for (const src of planted) assert.ok(readsOwnPath(src), 'refused: ' + src);
  const fine = [
    'const arg = process.argv[2];', 'const args = process.argv.slice(2);', 'for (const a of process.argv.slice(2)) {}', 'if (process.argv.length > 2) {}', 'const x = process.argv[ 3 ];',
    'const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");', "const u = new URL('lib/x.mjs', import.meta.url);", 'const t = JSON.parse(readFileSync(new URL("./a.json", import.meta.url)));',
    'if (isMainModule(import.meta.url)) main();', '// process.argv[1] is only named in this comment', '/* import.meta.main, in a block comment */ const a = 1;',
    // Reading an argument is no question about the main module
    "if (process.argv.includes('--help')) usage();", "const web = process.argv.indexOf('--web') !== -1;", 'const [, , ...args] = process.argv;', 'const [,, first, second] = process.argv;', 'const x = process.argv[10];',
    'const rest = process.argv.slice(2).filter(a => a !== "--write");', "const w = process.argv.slice(3).includes('--write');",
    // Q-12: the literal forms that stay allowed: any quote, a template with no `${`, a second argument, a slice that ends at its start or at a comma
    "process.argv.includes(`--help`)", 'process.argv.includes("--help")', "process.argv.includes('--a', 3)", 'process.argv.slice( 2 )', 'process.argv.slice(2, 4)', 'process.argv.slice(10)', "process.argv.indexOf( '--web' ) > -1",
    // PR #62: valid escaped literals stay allowed (the escape pair is consumed, so the literal ends where the source ends it): an escaped quote of each kind, an escaped backtick, an escaped
    // backslash, an escaped interpolation, a lone dollar sign, an escape letter, and a second argument after any of them
    "process.argv.includes('can" + BS + "'t')", 'process.argv.includes("say ' + BS + '"hi' + BS + '"")', 'process.argv.indexOf(' + BT + BS + BT + BT + ')', "process.argv.includes('a" + BS + BS + "b')",
    'process.argv.includes(' + BT + 'price ' + DOLLAR + '5' + BT + ')', 'process.argv.includes(' + BT + 'a' + BS + DOLLAR + '{b}' + BT + ')', "process.argv.includes('x" + BS + "n', 2)", "process.argv.indexOf('it" + BS + "'s', 1)",
  ];
  for (const src of fine) assert.ok(!readsOwnPath(src), 'allowed: ' + src);
  assert.ok(startsItself('if (isMainModule(import.meta.url)) main();') && startsItself('if (import.meta.main) main();') && !startsItself('const arg = process.argv[2];'));
  // the stated limits: not seen
  for (const src of ["Reflect.get(process, 'ar' + 'gv').at(1)", 'const p = process; p.argv.at(1);', 'if (new URL(import.meta.url).pathname === x) main();',
    // PR #58 catch-up (CodeRabbit): a `/*` inside a string opens a comment for the scan, and a real `*/` many lines later closes it, so the guard between them is not seen (a `//` in a string only cuts its own line)
    "const RULE = '/*';\nif (import.meta.main) main();\n/* note */", "const u = 'a//b'; if (import.meta.main) main();"]) assert.ok(!readsOwnPath(src), 'a stated limit: ' + src);
});

// PR #58: a pattern of the helper took time cubic in the input (a `{ argv ` run with no closing brace: 6.2 s at 11,200 characters) and its comment stripper quadratic (an unclosed
// `/* a ` run). Not a wall-clock assertion: the helper runs in a child under a kill-timeout and a heap cap, and the test asserts that the child FINISHED.
test('the scan helpers finish on bulk input that gives their patterns nothing to match: every input ends the child itself, never by the kill', () => {
  const lib = pathToFileURL(join(ROOT, 'scripts/lib/entry-scan.mjs')).href;
  const child = `
    const { readsOwnPath, startsItself, stripComments } = await import(${JSON.stringify(lib)});
    const N = 40000;
    const inputs = [
      '{ argv '.repeat(N), '{ a, '.repeat(N), '{' + ' a,'.repeat(N), '/* a '.repeat(N), '/* a */ '.repeat(N), '// a '.repeat(N), 'process . '.repeat(N), 'process.argv.'.repeat(N), 'process.argv[ '.repeat(N),
      '[ , ,'.repeat(N), '[' + ' ,'.repeat(N), 'process.argv.includes('.repeat(N), 'process.argv.includes(' + String.fromCharCode(39) + 'x'.repeat(N), 'process.argv.includes(' + String.fromCharCode(96) + 'x'.repeat(N), 'process.argv.slice(2 '.repeat(N), 'process.argv.includes(' + String.fromCharCode(39) + (String.fromCharCode(92) + String.fromCharCode(39)).repeat(N), 'process.argv.includes(' + String.fromCharCode(39) + String.fromCharCode(92).repeat(N),
      'process.argv.includes(' + String.fromCharCode(96) + (String.fromCharCode(36) + 'a').repeat(N), 'process.argv.includes(' + String.fromCharCode(34) + ('a' + String.fromCharCode(92, 92)).repeat(N), 'import.meta.url '.repeat(N), 'fileURLToPath( import.meta.url '.repeat(N), ' '.repeat(N * 4) + '{', '{' + ' '.repeat(N * 4),
      '{ ' + 'a: b, '.repeat(N) + 'argv', "'".repeat(N), '\\n'.repeat(N),
    ];
    let seen = 0;
    for (const t of inputs) { stripComments(t); readsOwnPath(t); startsItself(t); seen++; }
    console.log('FINISHED ' + seen + ' OF ' + inputs.length);
  `;
  const r = spawnSync(process.execPath, ['--max-old-space-size=256', '--input-type=module', '-e', child], { encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL' });
  assert.equal(r.error, undefined, 'the child was not killed by the timeout: ' + (r.error && r.error.message));
  assert.equal(r.signal, null, 'and no signal ended it: ' + r.signal);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^FINISHED (\d+) OF \1\n?$/);
});

// No link here: these hold wherever the test runs, so a system that cannot make a link still checks them (CodeRabbit 4309062056, 4309062060).
test('the self-running scripts of scripts/ are exactly the list this test checks, none compares its path lexically, each says something and fails in a bare copy, and an import of each runs nothing', () => {
  const scripts = readdirSync(join(ROOT, 'scripts')).filter(f => /\.mjs$/.test(f) && !/\.test\.mjs$/.test(f)), source = f => readFileSync(join(ROOT, 'scripts', f), 'utf8');
  const found = scripts.filter(f => startsItself(source(f))).map(f => f.replace(/\.mjs$/, '')).sort();
  assert.deepEqual(found, [...SELF_RUNNING].sort(), 'a script that starts itself is in SELF_RUNNING, or it does not start itself: the list is what the link test below walks');
  const lexical = scripts.filter(f => readsOwnPath(source(f)));
  assert.deepEqual(lexical, [], 'no script reads its own path or asks "am I the main module" in its own words: a junction or a symlink would make it exit 0 having done nothing, and a file name test runs on an import');
  const unguarded = SELF_RUNNING.filter(name => !/isMainModule\(import\.meta\.url\)/.test(stripComments(source(name + '.mjs'))));
  assert.deepEqual(unguarded, [], 'every self-running script starts through isMainModule(import.meta.url) of scripts/lib/entry-guard.mjs');
  const { real, run } = bareCopy();
  for (const name of SELF_RUNNING) {
    const direct = run([join(real, name + '.mjs')]);
    assert.notEqual(direct.stdout + direct.stderr, '', name + ': a direct run in the bare copy says something');
    assert.notEqual(direct.status, 0, name + ': and does not exit 0');
    const imported = run(importOf(join(real, name + '.mjs')));
    assert.equal(imported.status, 0, name + ': an import runs nothing: ' + imported.stderr);
    assert.equal(imported.stdout + imported.stderr, '', name);
  }
});

// Q-10: decap-battery once started on the NAME of the file it was run as (`argv[1].endsWith('decap-battery.mjs')`), so any file with that name that merely imports it ran the whole command line. It starts
// through isMainModule now: a same-named file that imports it runs nothing (the old guard ran the label printer, or ended in a crash for want of web/ic.json in the bare copy).
test('decap-battery and reply-language-check start only as the main module: a file of the same name that imports each of them runs nothing', () => {
  const { root, real, run } = bareCopy();
  for (const name of ['decap-battery', 'reply-language-check']) {
    const dir = join(root, 'spoof-' + name);
    mkdirSync(dir);
    writeFileSync(join(dir, name + '.mjs'), `await import(${JSON.stringify(pathToFileURL(join(real, name + '.mjs')).href)});\n`);
    const r = run([join(dir, name + '.mjs'), name === 'decap-battery' ? '--label' : '--scan']);
    assert.equal(r.status, 0, name + ': ' + r.stderr);
    assert.equal(r.stdout + r.stderr, '', name + ': an import by a file of the same name runs nothing');
  }
});

// The one leg that needs a link, alone in its test: it is skipped, visibly, where the system will not make one.
test('through a junction or a symlink every self-running script does what a direct run does: the same exit code and the same output, and an import runs nothing', t => {
  const { root, real, run } = bareCopy();
  const link = join(root, 'link');
  try { symlinkSync(real, link, 'junction'); } catch { t.skip('this system will not make a symlink or a junction'); return; }
  for (const name of SELF_RUNNING) {
    const direct = run([join(real, name + '.mjs')]), viaLink = run([join(link, name + '.mjs')]);
    assert.equal(viaLink.status, direct.status, `${name}: the same exit code through the link (not a silent 0): ${viaLink.stdout}${viaLink.stderr}`);
    assert.equal(viaLink.stdout + viaLink.stderr, direct.stdout + direct.stderr, name + ': the same output through the link');
    const imported = run(importOf(join(link, name + '.mjs')));
    assert.equal(imported.status, 0, name + ': an import through the link runs nothing: ' + imported.stderr);
    assert.equal(imported.stdout + imported.stderr, '', name);
  }
});

test('scripts/wsl/browser-run.sh: LF only, argv checked, the stable path and never a versioned folder, and its only delete sits behind a guard on a path it made', () => {
  const sh = readFileSync(join(ROOT, 'scripts/wsl/browser-run.sh'), 'utf8');
  const probeSh = readFileSync(join(ROOT, 'scripts/wsl/probe.sh'), 'utf8');
  assert.ok(!sh.includes('\r') && !probeSh.includes('\r'), 'LF only: a CRLF script is "bad interpreter" in the distro');
  assert.match(sh, /^#!\/usr\/bin\/env bash\n/);
  assert.ok(sh.includes('$HOME/tools/chrome-headless-shell-linux64/chrome-headless-shell'), 'the stable path');
  assert.doesNotMatch(sh + probeSh, /chrome-headless-shell-[0-9]/, 'never a versioned folder');
  for (const need of ['BADPORT', 'BADLIFETIME', 'NOHOME', 'NOBIN', 'NOMKTEMP', 'BADRUN']) assert.ok(sh.includes(need), need);
  // exactly one delete, in the cleanup, inside `if guard`, of the variable the guard checks
  const deletes = sh.split('\n').filter(l => /\brm\b/.test(l) && !l.trim().startsWith('#'));
  assert.equal(deletes.length, 1, deletes.join(' | '));
  assert.equal(deletes[0].trim(), 'rm -rf -- "$RUN"');
  const at = sh.indexOf('rm -rf -- "$RUN"');
  const guardCall = sh.lastIndexOf('if guard; then', at);
  assert.ok(guardCall > 0 && at - guardCall < 40, 'the delete is the first thing inside `if guard; then`');
  // the guard: mktemp's shape, a real directory and not a link, resolving to itself, under /tmp, and not $HOME
  for (const need of ['mktemp -d /tmp/kolwen-browser-run-XXXXXX', '/tmp/kolwen-browser-run-??????', '[ -d "$RUN" ] && [ ! -L "$RUN" ]', 'realpath -e -- "$RUN"', '[ "$real" = "$RUN" ]', '[ "$real" != "$HOME" ]', '[ -n "${RUN:-}" ]'])
    assert.ok(sh.includes(need), need);
  assert.doesNotMatch(sh, /rm [^\n]*\$HOME/, '$HOME is never the target of a delete');
  assert.ok(sh.indexOf('guard || {') > 0 && sh.indexOf('guard || {') < sh.indexOf('mkdir -m 700'), 'the guard runs right after mktemp, before anything is put in the folder');
  assert.doesNotMatch(probeSh, /\brm\b|mkdir|mktemp/, 'the probe makes and deletes nothing');
});

test('the WSL script and the native route start the browser with the same switches (the WSL-only ones are named)', () => {
  const sh = readFileSync(join(ROOT, 'scripts/wsl/browser-run.sh'), 'utf8');
  const start = sh.indexOf('"$BIN"');
  const flags = (sh.slice(start, sh.indexOf('about:blank', start)).match(/'--[^']*'|--[^\s']+/g) ?? []).map(f => f.replace(/^'|'$/g, ''));
  const wslOnly = ['--remote-debugging-port="$PORT"', '--remote-debugging-address=127.0.0.1', '--user-data-dir="$RUN/profile"', '--font-render-hinting="$HINTING"'];
  for (const f of browserLib.COMMON_ARGS) assert.ok(flags.includes(f), 'the script carries ' + f);
  assert.deepEqual(flags.filter(f => !browserLib.COMMON_ARGS.includes(f) && !wslOnly.includes(f)), [], 'nothing else is in the script');
  for (const f of wslOnly) assert.ok(flags.includes(f), 'the script carries ' + f);
  assert.ok(browserLib.COMMON_ARGS.includes('--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1'), 'no host name resolves');
});

// Q-14 (the pending 4 of PR #57's unit): a one-run hinting knob. The WSL route runs the browser with the font hinting OFF, which is what makes its layout repeatable; a Linux visitor's browser often applies
// FreeType's medium or full hinting, which makes the Thai text wider (the plan table needs 275.6 px with none and 290 px with medium or full, measured at 320 px against 238 px of card content). KOLWEN_FONT_HINTING
// (none, slight, medium or full; unset is none) is read by scripts/wsl/browser-run.sh, so the rendered check can be run once with another hinting as a watch on the table's slack; it reaches the distro through
// WSLENV, and the run says which hinting it used.
test('KOLWEN_FONT_HINTING: the script reads it, takes only none, slight, medium or full (none when unset), and says which it used', () => {
  const sh = readFileSync(join(ROOT, 'scripts/wsl/browser-run.sh'), 'utf8');
  assert.match(sh, /^HINTING="\$\{KOLWEN_FONT_HINTING:-none\}"$/m, 'read from the environment, none by default');
  assert.match(sh, /case "\$HINTING" in none\|slight\|medium\|full\) ;; \*\) echo "kolwen-wsl: BADHINTING"; exit 2 ;; esac/, 'only the four values, checked before anything is made');
  assert.ok(sh.indexOf('BADHINTING') < sh.indexOf('mktemp -d'), 'the value is refused before the run folder is made');
  assert.match(sh, /echo "kolwen-wsl: HINTING=\$HINTING"/, 'the script says which hinting it used');
  assert.doesNotMatch(sh, /--font-render-hinting=none/, 'no hinting is written into the switches');
  assert.deepEqual(wslLib.HINTINGS, ['none', 'slight', 'medium', 'full']);
  assert.equal(wslLib.HINTING_ENV, 'KOLWEN_FONT_HINTING');
  for (const [env, want] of [[{}, 'none'], [{ KOLWEN_FONT_HINTING: '' }, 'none'], [{ KOLWEN_FONT_HINTING: 'full' }, 'full'], [{ KOLWEN_FONT_HINTING: 'slight' }, 'slight']]) assert.deepEqual(wslLib.fontHinting(env), { hinting: want }, JSON.stringify(env));
  for (const bad of ['Full', 'medium ', 'heavy', '1', '--no-sandbox', 'full; rm -rf x']) assert.match(wslLib.fontHinting({ KOLWEN_FONT_HINTING: bad }).why, /^KOLWEN_FONT_HINTING is .*, which is not one of none, slight, medium, full$/, bad);
  // PR #62 (CWE-117, log injection): a refused value is written into a line-oriented FAIL line, so it never carries a line break or any other control
  // character raw. The value is quoted and its CR, LF, C0, DEL, C1, U+2028 and U+2029 are escaped; a clean value still reads as before (inside quotes).
  const F = String.fromCharCode;
  const CONTROL = new RegExp('[' + F(0) + '-' + F(0x1f) + F(0x7f) + '-' + F(0x9f) + F(0x2028, 0x2029) + ']'); // C0, DEL, C1 and the two line separators, built from code points
  const forged = 'x' + F(10) + 'rendered-check passed: 8 page(s) x 2 languages (96 measurements) in WSL Ubuntu, font hinting none';
  for (const [label, bad] of [['LF', forged], ['CR', 'x' + F(13) + 'y'], ['CRLF', 'x' + F(13, 10) + 'y'], ['NUL', 'x' + F(0) + 'y'], ['ESC', 'x' + F(27) + '[2Ky'], ['DEL', 'x' + F(0x7f) + 'y'], ['C1 NEL', 'x' + F(0x85) + 'y'], ['U+2028', 'x' + F(0x2028) + 'y'], ['U+2029', 'x' + F(0x2029) + 'y'], ['lone surrogate', 'x' + F(0xd800) + 'y']]) {
    const why = wslLib.fontHinting({ KOLWEN_FONT_HINTING: bad }).why;
    assert.ok(why && !CONTROL.test(why), label + ': no raw control character in ' + JSON.stringify(why));
    assert.match(why, /^KOLWEN_FONT_HINTING is ".*", which is not one of none, slight, medium, full$/, label);
  }
  assert.equal(wslLib.fontHinting({ KOLWEN_FONT_HINTING: forged }).why.split('\n').length, 1, 'one line: a forged "passed" line cannot follow the message');
  assert.equal(wslLib.fontHinting({ KOLWEN_FONT_HINTING: 'heavy' }).why, 'KOLWEN_FONT_HINTING is "heavy", which is not one of none, slight, medium, full');
  assert.equal(wslLib.plainText('a' + F(10) + 'b'), '"a\\nb"');
  assert.equal(wslLib.plainText('a' + F(0x85, 0x2028)), '"a\\u0085\\u2028"');
  // it reaches the distro only through WSLENV, and an existing WSLENV is kept
  assert.equal(wslLib.wslEnvFor({ KOLWEN_FONT_HINTING: 'full' }).WSLENV, 'KOLWEN_FONT_HINTING');
  assert.equal(wslLib.wslEnvFor({ KOLWEN_FONT_HINTING: 'full', WSLENV: 'A/p:B' }).WSLENV, 'A/p:B:KOLWEN_FONT_HINTING');
  assert.equal(wslLib.wslEnvFor({ KOLWEN_FONT_HINTING: 'full', WSLENV: 'KOLWEN_FONT_HINTING/u' }).WSLENV, 'KOLWEN_FONT_HINTING/u', 'named once already: left as it is');
  assert.equal(wslLib.wslEnvFor({ PATH: 'x' }).WSLENV, undefined, 'unset: WSLENV is not touched');
  // a bad value starts nothing
  assert.throws(() => wslLib.startWslBrowser({ distro: 'Ubuntu', port: 1, lifetimeS: 1, scriptsDir: SCRIPTS_ON_C, env: { KOLWEN_FONT_HINTING: 'heavy' } }), /KOLWEN_FONT_HINTING is "heavy", which is not one of/);
});

test('with KOLWEN_FONT_HINTING=full the run reports it, the plan table is wider than with none, and it still scrolls inside its wrapper without the page scrolling sideways', { skip: SKIP_WSL }, async () => {
  const old = process.env.KOLWEN_FONT_HINTING;
  let hinted;
  process.env.KOLWEN_FONT_HINTING = 'full';
  try { hinted = await launchBrowser({ route, lifetimeMs: 120000 }); } finally { if (old === undefined) delete process.env.KOLWEN_FONT_HINTING; else process.env.KOLWEN_FONT_HINTING = old; }
  const read = async b => {
    const server = await b.serve(join(ROOT, 'web'), { headers: false });
    const page = await b.newPage();
    try {
      await page.setViewport(320, 800);
      await page.goto(server.origin + '/pricing');
      return await page.evaluate(`(() => { const t = [...document.querySelectorAll('table.plans')].find(x => x.offsetParent), w = t.closest('.plans-wrap');
        return { table: t.getBoundingClientRect().width, wrapper: w.clientWidth, scrolls: w.scrollWidth > w.clientWidth, overflowX: getComputedStyle(w).overflowX, page: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }; })()`);
    } finally { await page.close(); await server.close(); }
  };
  try {
    assert.equal(hinted.hinting, 'full', 'the run reports the hinting it used');
    assert.match(hinted.label, /font hinting full/);
    assert.equal(browser.hinting, 'none', 'the shared browser of this file ran with the default');
    assert.match(browser.label, /font hinting none/);
    const none = await read(browser), full = await read(hinted);
    assert.ok(full.table > none.table + 5, `the knob took effect: the table is ${full.table} px with full hinting and ${none.table} px with none`);
    assert.equal(full.overflowX, 'auto');
    assert.equal(full.scrolls, true, 'the table is wider than its wrapper and scrolls there: ' + JSON.stringify(full));
    assert.equal(full.page, full.viewport, 'the page does not scroll sideways: ' + JSON.stringify(full));
  } finally { await hinted.close(); }
});

test('a lock port held by a program that is not this check is reported as that, and not as another run', async t => {
  const got = await freeLockPaths('kolwen-lock-test-foreign', 1); // the foreign listener needs the port free to take it, so the path is one whose port is
  if (got.skip) { t.skip(got.skip); return; }
  const p = got.paths[0], port = browserLib.lockPortOf(p);
  const foreign = createServer(s => { s.on('error', () => {}); s.end('hello'); }); // it speaks, but it does not greet as this check's lock does
  try { await new Promise((res, rej) => { foreign.once('error', rej); foreign.listen(port, '127.0.0.1', res); }); } catch { t.skip(`lock port ${port} of ${p} was taken between the check and the listen`); return; }
  try {
    await assert.rejects(browserLib.lockProfile(p), e => {
      assert.equal(e.message, `the browser profile ${p} could not be locked: port ${port} of 127.0.0.1 is held by a program that is not this check (point KOLWEN_BROWSER_PROFILE at another folder)`);
      assert.ok(!e.message.includes('in use by another run'));
      return true;
    });
    assert.equal(await browserLib.lockHolder(port), 'another program');
  } finally { await new Promise(r => foreign.close(r)); }
  const release = await browserLib.lockProfile(p);
  assert.equal(await browserLib.lockHolder(port), 'a run', 'this check\'s own lock greets whoever connects');
  await release();
});

// PR #62: the EACCES branch and its message are tested on every OS by an injected server whose listen fails with the code a reserving system gives; the probe test below
// keeps the real reservation as an extra that skips visibly where the system has none
const failingServer = code => {
  const handlers = {};
  return { unref() {}, once(ev, fn) { handlers[ev] = fn; }, listen() { setImmediate(() => handlers.error(Object.assign(new Error('listen ' + code), { code }))); } };
};
test('lockProfile: a listen refused with EACCES is one line saying the system reserves the port, and any other listen error is passed on as it is (injected server, every OS)', async () => {
  const p = join(tmpdir(), 'kolwen-lock-stub-reserved'), port = browserLib.lockPortOf(p);
  await assert.rejects(browserLib.lockProfile(p, () => failingServer('EACCES')), e => {
    assert.equal(e.message, `the browser profile ${p} could not be locked: port ${port} of 127.0.0.1 is reserved by the system (point KOLWEN_BROWSER_PROFILE at another folder)`);
    return true;
  });
  await assert.rejects(browserLib.lockProfile(p, () => failingServer('EMFILE')), e => { assert.equal(e.code, 'EMFILE'); assert.match(e.message, /^listen EMFILE$/); return true; });
});

test('a lock port that the system reserves (Windows keeps ranges of the dynamic ports) is one line saying so, not a raw listen error', async t => {
  const tryListen = port => new Promise(res => { const s = createServer(); s.once('error', e => res(e.code)); s.listen(port, '127.0.0.1', () => s.close(() => res('ok'))); });
  // a capability probe: every port of the lock's range is tried (in batches, at once), then paths are hashed (nothing is bound) until one maps to a reserved port; the lock range moved under the
  // client ranges (Q-13), where a system reserves little: Windows lists one port there on the box this was written on, so the paths are searched, not the ports of 6000 of them
  const reserved = new Set();
  const started = Date.now();
  let probed = 0;
  // a budget of 8 s and an early stop at the first reserved port: a bind is slow on Windows (about 1.4 ms), where reservations live, and fast where there are none
  for (let first = browserLib.LOCK_PORT_FIRST; first <= browserLib.LOCK_PORT_LAST && !reserved.size && Date.now() - started < 8000; first += 512) {
    const ports = Array.from({ length: Math.min(512, browserLib.LOCK_PORT_LAST - first + 1) }, (_, k) => first + k);
    (await Promise.all(ports.map(async p => [p, await tryListen(p)]))).forEach(([p, code]) => { if (code === 'EACCES') reserved.add(p); });
    probed += ports.length;
  }
  let found = null;
  if (reserved.size) for (let i = 0; i < 2000000 && !found; i++) { const p = join(tmpdir(), 'kolwen-lock-probe-' + i); if (reserved.has(browserLib.lockPortOf(p))) found = p; }
  if (!found) { t.skip(reserved.size ? `${reserved.size} reserved port(s) in the lock range, and no path of 2,000,000 maps to one` : `no reserved port found among the ${probed} ports of the lock range 16384 to 32767 that were tried in 8 s`); return; }
  await assert.rejects(browserLib.lockProfile(found), e => {
    assert.match(e.message, /^the browser profile .*kolwen-lock-probe-\d+ could not be locked: port \d+ of 127\.0\.0\.1 is reserved by the system \(point KOLWEN_BROWSER_PROFILE at another folder\)$/);
    return true;
  });
});

test('the marker records intent, not origin (a stated limit): a folder that holds a copied marker is accepted as ours', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kolwen-test-copied-'));
  copies.push(dir);
  writeFileSync(join(dir, 'Local State'), '{}');
  writeFileSync(join(dir, browserLib.MARKER), 'copied from somewhere else');
  assert.doesNotThrow(() => browserLib.prepareProfile(dir));
  const header = readFileSync(join(ROOT, 'scripts/lib/browser.mjs'), 'utf8');
  assert.match(header, /the marker records INTENT, not origin/);
});

test('a resource asked for by host name is a finding: the browser resolves no host name, so it fails, and the run says which address', { skip: SKIP }, async () => {
  const web = copyWeb(w => editPage(w, 'terms.html', h => h.replace('<main>', '<img src="http://cdn.kolwen-no-such-host.example/x.png" alt=""><main>')));
  const { failures } = await run(web, ['reflow']);
  const hit = failures.filter(f => f.check === 'resources');
  assert.deepEqual(hit.map(f => [f.page, f.lang]), [['terms.html', 'en'], ['terms.html', 'th']], JSON.stringify(failures));
  assert.match(hit[0].detail, /^a resource was asked for by host name and could not be reached, because the browser resolves no host name: http:\/\/cdn\.kolwen-no-such-host\.example\/x\.png$/);
  assert.deepEqual((await run(copyWeb(), ['reflow'])).failures.filter(f => f.check === 'resources'), [], 'the built pages ask for nothing by host name');
});

test('on the WSL route a run leaves no folder of its own in the distro, and two launches run at once, each with a profile of its own', { skip: SKIP_WSL }, async () => {
  const probe = toWslProbe();
  const count = () => Number(/RUNS=(\d+)/.exec(wslLib.decodeWslText(wslLib.wslRun(['-d', route.distro, '--exec', 'bash', probe, 'count']).stdout))?.[1]);
  const before = count();
  assert.ok(before >= 1, 'the shared browser of this file has its folder: ' + before);
  const second = await launchBrowser({ route, lifetimeMs: 120000 });
  assert.equal(count(), before + 1, 'a second browser, a second folder, at the same time');
  assert.notEqual(second.profile, undefined);
  const page = await second.newPage();
  try { assert.equal(await page.evaluate('1 + 2'), 3); } finally { await page.close(); }
  const mine = await browser.newPage();
  try { assert.equal(await mine.evaluate('2 + 2'), 4, 'and the first one is still working'); } finally { await mine.close(); }
  await second.close();
  assert.equal(count(), before, 'the second browser\'s folder is gone with it');
});
const toWslProbe = () => wslLib.toWslPath(join(wslLib.WSL_SCRIPTS, 'probe.sh'));

// K-17: a checked page reaches only its own origin. The page asks for an image on another loopback port; the request is failed as blocked by the client, and the server on that
// port gets no request. On the WSL route that server (on Windows) is not reachable from the distro, so the request is refused by the page, and its errorText is the witness there;
// the native route's proof is the CI runner, where the server is reachable and the hit count is the witness as well.
test('K-17: a checked page reaches only its own origin: a request to another loopback port is blocked, and the other server sees nothing', { skip: SKIP }, async () => {
  let hits = 0;
  const other = createHttpServer((req, res) => { hits++; res.end(); });
  await new Promise(r => other.listen(0, '127.0.0.1', r));
  const probe = `http://127.0.0.1:${other.address().port}/probe.png`;
  try {
    const web = copyWeb(w => editPage(w, 'index.html', h => h.replace('</body>', `<img alt="" src="${probe}"></body>`)));
    const server = await browser.serve(web, { headers: false });
    const page = await browser.newPage();
    try {
      await page.goto(server.origin + '/');
      await page.evaluate('new Promise(r => setTimeout(r, 300)).then(() => true)'); // the image's request has ended by now
      const failed = page.resourceFailures.filter(f => f.url === probe).map(f => f.errorText);
      assert.equal(failed.length, 1, 'one failure for the request: ' + JSON.stringify(failed));
      assert.match(failed[0], /^net::ERR_BLOCKED_BY_CLIENT/, 'the request is failed as blocked by the client (Chrome adds .Inspector to it)');
      assert.equal(hits, 0, 'the other server got no request');
    } finally { await page.close(); await server.close(); }
  } finally { await new Promise(r => other.close(r)); }
});

// A checked page reaches no other loopback port: its WebSocket and its dedicated worker's fetch are both held to the page's own origin.
// The listener is the test's own, on another loopback port. The WSL route serves its pages through the DevTools channel, so this runs on the
// native route only; CI's Linux runner is the native route. The page reports its outcomes through one promise: no fixed sleep.
test('a checked page cannot open a WebSocket or make a worker fetch to another loopback port, and that listener sees nothing', { skip: route.kind === 'native' ? false : 'the WSL route serves its pages through the DevTools channel, so this witness runs on the native route only' }, async () => {
  const seen = { connections: 0, requests: [] };
  const other = createServer(sock => {
    seen.connections++;
    sock.on('data', d => { if (seen.requests.length < 4) seen.requests.push(d.toString('latin1').split('\r\n')[0].slice(0, 60)); sock.destroy(); });
    sock.on('error', () => {});
  });
  let server = null, page = null;
  try {
    await new Promise(r => other.listen(0, '127.0.0.1', r));
    const port = other.address().port;
    const web = copyWeb(w => editPage(w, 'index.html', h => h.replace('</head>', () => '<script>\n'
      + 'window.__r = {};\n'
      + 'window.__done = Promise.all([\n'
      + "  new Promise(res => { try { const w = new WebSocket('ws://127.0.0.1:" + port + "/ws'); w.onopen = () => { __r.ws = 'open'; res(); }; w.onerror = () => { __r.wsError = true; res(); }; w.onclose = () => res(); } catch (e) { __r.wsThrow = String(e); res(); } }),\n"
      + "  new Promise(res => { const src = 'fetch(\"http://127.0.0.1:" + port + "/worker\").then(() => postMessage(\"ok\"), () => postMessage(\"error\"));'; const wk = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))); wk.onmessage = e => { __r.worker = e.data; res(); }; wk.onerror = () => { __r.workerError = true; res(); }; }),\n"
      + "]).then(() => true);\n"
      + '</script></head>')));
    server = await browser.serve(web, { headers: false });
    page = await browser.newPage();
    await page.goto(server.origin + '/index.html');
    await page.evaluate('window.__done');
    const r = JSON.parse(await page.evaluate('JSON.stringify(window.__r)'));
    assert.notEqual(r.ws, 'open', 'the page WebSocket reached the other port: ' + JSON.stringify(r));
    assert.equal(r.worker, 'error', 'the worker fetch was not refused: ' + JSON.stringify(r));
    assert.equal(seen.connections, 0, 'the other server saw ' + seen.connections + ' connection(s): ' + JSON.stringify(seen.requests));
    assert.deepEqual(page.workerSetupFailures, [], 'a worker could not be held to the origin: ' + JSON.stringify(page.workerSetupFailures));
  } finally {
    if (page) await page.close().catch(() => { /* the page went away */ });
    if (server) await server.close().catch(() => { /* the server went away */ });
    other.close();
  }
});
