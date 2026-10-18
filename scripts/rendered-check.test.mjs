// Tests for the rendered checks (scripts/rendered-check.mjs): the clean pages pass, and each defect the checks exist for is PLANTED in a copy of web/ and must be found by the real browser.
//   - a 400 px wide element fails the 320 px reflow check (SC 1.4.10);
//   - a box that clips its text fails the 200% text check (SC 1.4.4), both a box that cuts its own content and a text that sticks out of a clipping parent;
//   - an inline style whose hash is not in the Content-Security-Policy is reported by the browser.
// These tests need Chrome or Edge. Locally, with none found, they are SKIPPED and the skip names why; in CI (CI=true) a missing browser FAILS the first test below, so CI never goes green without them.
// Every child has a bound: the browser has a heap cap and a kill timer (scripts/lib/browser.mjs). Run: node --test scripts/rendered-check.test.mjs
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findBrowser, launchBrowser, BROWSER_ENV } from './lib/browser.mjs';
import * as browserLib from './lib/browser.mjs'; // devToolsEndpoint, profilePath, lockProfile and the rest are used through the namespace
import { serveWeb } from './lib/static-server.mjs';
import { renderedChecks, urlPathOf } from './rendered-check.mjs';
import * as checkLib from './rendered-check.mjs'; // classifyLogs

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CI = process.env.CI === 'true';
const binary = findBrowser();
const SKIP = !binary && !CI ? `no Chrome or Edge found (set ${BROWSER_ENV}); the rendered checks did not run here` : false;

let browser = null;
const copies = [];
before(async () => { if (binary) browser = await launchBrowser({ binary, lifetimeMs: 600000 }); });
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
  assert.ok(binary, `CI has no Chrome or Edge, so the rendered checks cannot run (set ${BROWSER_ENV} or install one)`);
});

test('the built pages pass all three checks, in both languages, under their real Content-Security-Policy', { skip: SKIP }, async () => {
  const { failures, measured } = await run(join(ROOT, 'web'), ['reflow', 'zoom', 'csp'], true);
  assert.deepEqual(failures, []);
  const pages = new Set(measured.map(m => m.page));
  assert.ok(pages.size >= 7, 'every page was measured: ' + pages.size);
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
  assert.equal(mine.length, 14, 'one note for the planted name per page and language (7 pages x 2): ' + mine.length);
  assert.ok(mine.every(n => n.kind === 'permissions-policy'), JSON.stringify(mine[0]));
  const csp = r.measured.filter(m => m.check === 'csp');
  assert.equal(csp.length, 14, 'a csp measurement for every page and language');
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
  // the state of every earlier page is cleared before a load, so a page with no working switch opens in its own default (en) and passes there, and its Thai pass is the one that cannot get Thai:
  // before the state was cleared, the same page failed in English instead, because the Thai pass of the page before it had left "th" in localStorage
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
  const prose = ['changelog.html', 'privacy.html', 'refund.html', 'terms.html'];
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
    assert.ok(Math.abs(en.columnEm - 480 / 14.5) < 0.1, `${p}: the column is 30rem, ${en.columnEm} em of the body size`);
    assert.ok(th.lines >= 2 && Math.abs(th.columnEm - 480 / 14.5) < 0.1, `${p} Thai: the column is recorded in em (${th.columnEm}), ${th.lines} Thai lines read`);
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

test('lockProfile: a profile is locked once; a second lock fails at once with one line, giving the lock up frees it, and another profile is not in the way', async () => {
  const a = join(tmpdir(), 'kolwen-lock-test-a'), b = join(tmpdir(), 'kolwen-lock-test-b'); // path strings only: nothing is made, and nothing is read
  const release = await browserLib.lockProfile(a);
  const t0 = Date.now();
  await assert.rejects(browserLib.lockProfile(a), e => {
    assert.match(e.message, /^the browser profile .*kolwen-lock-test-a is in use by another run$/);
    assert.ok(!e.message.includes('\n'), 'one line');
    return true;
  });
  assert.ok(Date.now() - t0 < 2000, 'at once, not a hang: ' + (Date.now() - t0) + ' ms');
  const other = await browserLib.lockProfile(b);
  await other();
  await release();
  const again = await browserLib.lockProfile(a);
  await again();
});

test('lockPortOf: the same profile always gives the same port, in 49152 to 65535, and different profiles give different ones', () => {
  const { lockPortOf } = browserLib;
  const a = join(tmpdir(), 'kolwen-lock-test-a'), b = join(tmpdir(), 'kolwen-lock-test-b');
  assert.equal(lockPortOf(a), lockPortOf(a));
  assert.notEqual(lockPortOf(a), lockPortOf(b));
  for (const p of [a, b, '/', 'C:\\x', '', 'a'.repeat(500)]) assert.ok(lockPortOf(p) >= 49152 && lockPortOf(p) <= 65535, p.slice(0, 20));
  assert.equal(lockPortOf('C:\\Users\\A\\x', 'win32'), lockPortOf('c:\\users\\a\\x', 'win32'), 'Windows paths are case-blind');
  assert.notEqual(lockPortOf('/Home/a', 'linux'), lockPortOf('/home/a', 'linux'), 'POSIX paths are not');
});

const countBrowserFolders = () => readdirSync(dirname(browserLib.profilePath())).filter(n => n.startsWith('kolwen-browser-')).length; // beside the profile: the user's cache folder

test('two launches use the same profile folder, and the second makes no new kolwen-browser-* folder', { skip: SKIP }, async () => {
  const first = browser.profile;
  assert.equal(first, browserLib.profilePath());
  const before = countBrowserFolders();
  await browser.close();
  browser = await launchBrowser({ binary, lifetimeMs: 600000 });
  assert.equal(browser.profile, first, 'the same folder');
  assert.equal(countBrowserFolders(), before, 'no new kolwen-browser-* folder in the OS temp folder');
  assert.ok(existsSync(first));
});

test('a second launch while a browser has the profile fails at once with one line, makes no second profile, and leaves the first browser working', { skip: SKIP }, async () => {
  const before = countBrowserFolders();
  const t0 = Date.now();
  await assert.rejects(launchBrowser({ binary }), e => { assert.match(e.message, /^the browser profile .+ is in use by another run$/); assert.ok(!e.message.includes('\n')); return true; });
  assert.ok(Date.now() - t0 < 10000, 'at once, not a hang: ' + (Date.now() - t0) + ' ms');
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

test('prepareProfile makes the profile folder with mode 0o700 and the marker with mode 0o600', { skip: process.platform === 'win32' ? 'POSIX mode bits: Windows has none (the runner proves this)' : false }, () => {
  const root = mkdtempSync(join(tmpdir(), 'kolwen-test-mode-'));
  copies.push(root);
  const dir = join(root, 'p');
  browserLib.prepareProfile(dir);
  assert.equal(statSync(dir).mode & 0o077, 0, 'no group or other bit on the folder');
  assert.equal(statSync(dir).mode & 0o700, 0o700);
  assert.equal(statSync(join(dir, browserLib.MARKER)).mode & 0o077, 0, 'no group or other bit on the marker');
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
  const server = await serveWeb(join(ROOT, 'web'), { headers: false });
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
  const server = await serveWeb(join(ROOT, 'web'), { headers: false });
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
  assert.equal(pages.length, 14, 'one per page and language (7 x 2): ' + pages.length);
  assert.ok(pages.every(f => f.detail === '1 cookie(s) outside the served 127.0.0.1 origin in the browser context of this page: .bing.com (kwctxbad)'), pages[0].detail);
});

test('the command line: with no browser CI fails and a developer run skips visibly', () => {
  const script = join(ROOT, 'scripts/rendered-check.mjs');
  // the children run with their own HOME and TEMP, in a folder this test made
  const home = mkdtempSync(join(tmpdir(), 'kolwen-cli-home-'));
  copies.push(home);
  const env = { ...process.env, HOME: home, USERPROFILE: home, TEMP: home, TMP: home, TMPDIR: home, XDG_CONFIG_HOME: home, [BROWSER_ENV]: join(tmpdir(), 'no-such-browser-binary') };
  const ci = spawnSync(process.execPath, ['--max-old-space-size=256', script], { encoding: 'utf8', timeout: 60000, env: { ...env, CI: 'true' } });
  assert.equal(ci.status, 1);
  assert.match(ci.stderr, /FAIL rendered-check: no Chrome or Edge was found.*In CI a missing browser is a failure, never a skip/);
  const local = spawnSync(process.execPath, ['--max-old-space-size=256', script], { encoding: 'utf8', timeout: 60000, env: { ...env, CI: '' } });
  assert.equal(local.status, 0);
  assert.match(local.stdout, /SKIPPED rendered-check: no Chrome or Edge was found/);
  const bad = spawnSync(process.execPath, ['--max-old-space-size=256', script, '--nope'], { encoding: 'utf8', timeout: 60000, env });
  assert.equal(bad.status, 2);
  const only = spawnSync(process.execPath, ['--max-old-space-size=256', script, '--only', 'colour'], { encoding: 'utf8', timeout: 60000, env });
  assert.equal(only.status, 2);
});

test('urlPathOf maps a page file to the path the Worker serves', () => {
  assert.equal(urlPathOf('index.html'), '/');
  assert.equal(urlPathOf('pricing.html'), '/pricing');
  assert.equal(urlPathOf('404.html'), '/404');
  assert.equal(urlPathOf('docs/index.html'), '/docs/');
});
