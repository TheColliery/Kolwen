// Tests for the rendered checks (scripts/rendered-check.mjs): the clean pages pass, and each defect the checks exist for is PLANTED in a copy of web/ and must be found by the real browser.
//   - a 400 px wide element fails the 320 px reflow check (SC 1.4.10);
//   - a box that clips its text fails the 200% text check (SC 1.4.4), both a box that cuts its own content and a text that sticks out of a clipping parent;
//   - an inline style whose hash is not in the Content-Security-Policy is reported by the browser.
// These tests need Chrome or Edge. Locally, with none found, they are SKIPPED and the skip names why; in CI (CI=true) a missing browser FAILS the first test below, so CI never goes green without them.
// Every child has a bound: the browser has a heap cap and a kill timer (scripts/lib/browser.mjs). Run: node --test scripts/rendered-check.test.mjs
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findBrowser, launchBrowser, BROWSER_ENV } from './lib/browser.mjs';
import * as browserLib from './lib/browser.mjs'; // devToolsEndpoint, removeProfile, runDir are used through the namespace
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
  assert.equal(r.notes.length, 14, 'one note per page and language (7 pages x 2): ' + r.notes.length);
  assert.ok(r.notes.every(n => n.kind === 'permissions-policy' && /Unrecognized feature: 'kolwen-no-such-feature'/.test(n.text)), JSON.stringify(r.notes[0]));
  assert.ok(r.measured.filter(m => m.check === 'csp').every(m => m.violations === 0 && m.notes === 1));
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

test('a page whose language switch does not set the wanted lang fails, instead of being measured in the language the last page left behind', { skip: SKIP }, async () => {
  // pricing comes after a page whose Thai pass left "th" in localStorage; with no working switch its English pass would be measured in Thai and the run would say 2 languages
  const web = copyWeb(w => editPage(w, 'pricing.html', h => h.split('data-lang-set=').join('data-lang-x=')));
  const { failures } = await run(web, ['reflow']);
  const lang = failures.filter(f => f.check === 'language');
  assert.deepEqual(lang.map(f => [f.page, f.lang]), [['pricing.html', 'en']], JSON.stringify(failures));
  assert.match(lang[0].detail, /the language switch did not set lang="en" \(the page reports lang="th"\)/);
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

test('devToolsEndpoint: the file the browser writes is checked before it opens a connection (port 1 to 65535, path /devtools/browser/<id>, a fixed host)', () => {
  const devToolsEndpoint = browserLib.devToolsEndpoint;
  const good = 'ws://127.0.0.1:9222/devtools/browser/0f3a-4B1c-9d';
  assert.equal(devToolsEndpoint('9222\n/devtools/browser/0f3a-4B1c-9d'), good);
  assert.equal(devToolsEndpoint('9222\r\n/devtools/browser/0f3a-4B1c-9d'), good);
  assert.equal(devToolsEndpoint('1\n/devtools/browser/a'), 'ws://127.0.0.1:1/devtools/browser/a');
  assert.equal(devToolsEndpoint('65535\n/devtools/browser/a'), 'ws://127.0.0.1:65535/devtools/browser/a');
  for (const unfinished of ['', '9222', '9222\n', '\n/devtools/browser/a']) assert.equal(devToolsEndpoint(unfinished), null, JSON.stringify(unfinished));
  const path = '/devtools/browser/a';
  for (const port of ['0', '65536', '99999', '123456', '-1', '12a', '9222.5', ' 9222', '9222 ', '1e3', '9222@evil.example', '0x50', String.fromCharCode(0x0663).repeat(4)]) // the last: four Arabic-Indic digits, which are not the decimal digits 0 to 9
    assert.throws(() => devToolsEndpoint(port + '\n' + path), /DevToolsActivePort names the port/, JSON.stringify(port));
  for (const bad of ['/devtools/browser/', '/devtools/browser/../x', '/devtools/page/abc', '/devtools/browser/a/b', '/devtools/browser/a b', '//evil.example/x', 'evil', '@evil.example/devtools/browser/a', '/devtools/browser/a?x=1', '/devtools/browser/a#h', '/DEVTOOLS/browser/a'])
    assert.throws(() => devToolsEndpoint('9222\n' + bad), /DevToolsActivePort names the path/, JSON.stringify(bad));
  assert.match(devToolsEndpoint('9222\n/devtools/browser/x'), /^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[A-Za-z0-9-]+$/);
});

test('removeProfile deletes a profile inside the run folder and nothing else; a refusal by the OS is one line naming the path, never silence', () => {
  const root = mkdtempSync(join(tmpdir(), 'kolwen-test-run-'));
  copies.push(root);
  const profile = join(root, 'profile-a');
  mkdirSync(join(profile, 'Default'), { recursive: true });
  writeFileSync(join(profile, 'Default', 'Preferences'), '{}');
  assert.equal(browserLib.removeProfile(profile, root), null);
  assert.equal(existsSync(profile), false, 'the profile is gone');
  assert.equal(browserLib.removeProfile(profile, root), null, 'a profile that is already gone is not a problem');
  // the run folder itself, a folder beside it and a folder above it are refused and left alone
  const beside = mkdtempSync(join(tmpdir(), 'kolwen-test-beside-'));
  copies.push(beside);
  writeFileSync(join(beside, 'keep.txt'), 'x');
  for (const target of [root, beside, tmpdir()]) {
    assert.match(browserLib.removeProfile(target, root), /did not delete .*: it is not inside the folder this run made/, target);
    assert.ok(existsSync(target), target + ' is still there');
  }
  assert.ok(existsSync(join(beside, 'keep.txt')));
  // the OS refuses: one line, the path in it
  const stuck = join(root, 'profile-b');
  mkdirSync(stuck);
  const eperm = () => { throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' }); };
  const line = browserLib.removeProfile(stuck, root, eperm);
  assert.match(line, /could not delete the browser profile .*profile-b \(EPERM\); it is a throwaway headless-browser profile, safe to delete by hand/);
  assert.ok(!line.includes('\n'), 'one line');
  assert.ok(existsSync(stuck), 'and the folder is left as it was');
});

test('a browser run leaves no profile behind, or names the one it could not delete', { skip: SKIP }, async () => {
  const said = [];
  const orig = console.error;
  const root = browserLib.runDir(); // the shared browser of this file already made it, and holds a profile in it
  const before = new Set(readdirSync(root));
  console.error = (...a) => { said.push(a.join(' ')); };
  try {
    const b = await launchBrowser({ binary, lifetimeMs: 60000 });
    const p = await b.newPage();
    await p.close();
    await b.close();
  } finally { console.error = orig; }
  const left = readdirSync(root).filter(n => !before.has(n)).map(n => join(root, n));
  for (const dir of left) assert.ok(said.some(s => s.includes(dir)), `a profile left behind is named on stderr: ${dir} / said: ${said.join(' | ')}`);
  if (left.length === 0) assert.deepEqual(said, [], 'and when it was deleted nothing was said');
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
