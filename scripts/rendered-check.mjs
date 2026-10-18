// The rendered checks (build-qc.md W-A11Y-07, W-FMT-11, and the CSP the pages are served under), in a real headless browser, over every page of web/ in both languages:
//   reflow   a 320 CSS px wide viewport has no horizontal scroll (WCAG 2.2 SC 1.4.10): documentElement.scrollWidth <= clientWidth.
//   zoom     text at 200% (SC 1.4.4): the root font-size is set to 200%, as the visitor's own setting does, on a 1280 px window, and then
//            - the page does not scroll sideways, and
//            - no element's text is cut: an element with overflow hidden or clip whose content is larger than its box, and a text rectangle that sticks out of an ancestor that clips. Nothing else is
//              measured: a box that grows with its text is not a loss, and text a script moves is not read.
//   csp      the browser reports no Content-Security-Policy violation while the page loads under the real headers (a hash that no longer matches shows here, in a real browser). Only a CSP violation
//            fails it. What the browser says about the Permissions-Policy header (a feature name it does not know) is printed on a separate NOTE line and never fails the run.
// Before any check, the language of the page is set by pressing its switch, and a page whose switch does not set the wanted lang fails (check name: language).
// And for the reading theme (layout-tokens.mjs), on the pages that declare data-job="prose", in the light and the dark colour scheme, each emulated on its own:
//   theme      the ground is the solid colour of the scheme (no background image), and the page says it supports both schemes;
//   contrast   every element that holds text has a computed text colour against the colour it really sits on of at least 4.5:1, or 3:1 for large text (SC 1.4.3). A translucent colour is composited
//              over what lies beneath it, up to the first opaque ground; the element's own opacity counts; a disabled control is exempt, as the standard exempts it. A background IMAGE is not
//              read (the reading theme has none; the default pages' faint gradient is outside this check);
//   lineheight the computed line height of the text of a prose page is at least 1.5 times its font size in the English document, and 1.65 in the Thai one (W-I18N-09, SC 1.4.8 as a target).
//   measure    no rendered line of Latin text in a prose page holds more than 80 characters (SC 1.4.8 as a target, never claimed as met). The line is read from the browser: each word of a text node is
//              asked for its box, the boxes are grouped into lines by their top, and the characters of a line are its words and the spaces between them. The Thai document is MEASURED, never failed:
//              Thai sets no spaces between words, so the WCAG character count does not transfer (W-I18N-14); its words are the ICU word segments (Intl.Segmenter, a dictionary), and what is recorded is the
//              column width in em of the Thai font size, and the characters per line, so a measure is taken from the rendered column and never borrowed from the Latin number.
// And for every page, the other way: a page that declares data-job="default" does not carry the reading theme's color-scheme, so the theme has not leaked into it (that the default pages
// render as they did is shown by comparing their screenshots, not by this check).
// The pages are served by scripts/lib/static-server.mjs and driven by scripts/lib/browser.mjs (DevTools protocol over Node's own WebSocket; no dependency).
//
// With no browser found, CI (CI=true) FAILS; anywhere else the run says it was skipped and exits 0. A silent skip in CI is the one outcome this script refuses.
// Usage: node scripts/rendered-check.mjs [--web <dir>] [--only reflow,zoom,csp,theme,contrast,lineheight,measure] [--no-headers]
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { htmlPages } from './lib/web-files.mjs';
import { findBrowser, launchBrowser, BROWSER_ENV } from './lib/browser.mjs';
import { serveWeb } from './lib/static-server.mjs';
import { READING } from './lib/layout-tokens.mjs';
import { parseColor } from './lib/contrast.mjs';

export const ALL_CHECKS = ['reflow', 'zoom', 'csp', 'theme', 'contrast', 'lineheight', 'measure'];
const READING_CHECKS = ['theme', 'contrast', 'lineheight', 'measure'];
export const MAX_LATIN_CHARS = 80; // SC 1.4.8 (AAA), the target the reading theme holds itself to
export const urlPathOf = file => (file === 'index.html' ? '/' : '/' + file.replace(/\.html$/, '').replace(/\/index$/, '/'));

// ── page-side measurements, as functions whose source is sent to the page ────────────────────────────────────────
function measureReflow() {
  const de = document.documentElement;
  const over = [];
  if (de.scrollWidth > de.clientWidth) {
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > de.clientWidth + 1) over.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : '') + ' ends at ' + Math.round(r.right));
      if (over.length >= 4) break;
    }
  }
  return { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, over };
}

function measureZoom() {
  const issues = [];
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 1) issues.push('the page scrolls sideways: scrollWidth ' + de.scrollWidth + ' > clientWidth ' + de.clientWidth);
  const clips = v => v === 'hidden' || v === 'clip';
  const name = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : '');
  const textRects = el => {
    const rects = [];
    for (const n of el.childNodes) {
      if (n.nodeType === 3 && n.nodeValue.trim()) {
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const rc of range.getClientRects()) if (rc.width > 0 && rc.height > 0) rects.push(rc);
      }
    }
    return rects;
  };
  let read = 0;
  for (const el of document.body.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const rects = textRects(el);
    if (!rects.length) continue;
    read++;
    if ((clips(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) || (clips(cs.overflowY) && el.scrollHeight > el.clientHeight + 1)) {
      issues.push('text is cut by its own box: ' + name(el) + ' (content ' + el.scrollWidth + 'x' + el.scrollHeight + ' in a box of ' + el.clientWidth + 'x' + el.clientHeight + ')');
    }
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const ac = getComputedStyle(a);
      if (!clips(ac.overflowX) && !clips(ac.overflowY)) continue;
      const box = a.getBoundingClientRect();
      const left = box.left + a.clientLeft, top = box.top + a.clientTop, right = left + a.clientWidth, bottom = top + a.clientHeight;
      if (rects.some(rc => (clips(ac.overflowX) && (rc.left < left - 1 || rc.right > right + 1)) || (clips(ac.overflowY) && (rc.top < top - 1 || rc.bottom > bottom + 1)))) {
        issues.push('text of ' + name(el) + ' is cut by ' + name(a));
        break;
      }
    }
  }
  return { issues: issues.slice(0, 6), read };
}

function measureContrast() {
  const parse = s => { const m = /rgba?\(([^)]+)\)/.exec(s); if (!m) return null; const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lin = c => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = c => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const over = (t, u) => ({ r: t.r * t.a + u.r * (1 - t.a), g: t.g * t.a + u.g * (1 - t.a), b: t.b * t.a + u.b * (1 - t.a), a: 1 });
  const ratio = (f, b) => { const x = lum(over(f, b)), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const groundOf = el => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a === 1) break; } }
    let base = layers.length && layers[layers.length - 1].a === 1 ? layers.pop() : { r: 255, g: 255, b: 255, a: 1 };
    while (layers.length) base = over(layers.pop(), base);
    return base;
  };
  const opacityOf = el => { let o = 1; for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity); return o; };
  const name = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : '');
  let read = 0, worst = Infinity;
  const fails = [];
  for (const el of document.body.querySelectorAll('*')) {
    let own = false;
    for (const n of el.childNodes) if (n.nodeType === 3 && n.nodeValue.trim()) own = true;
    if (!own) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest(':disabled')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const fg = parse(cs.color);
    if (!fg) continue;
    fg.a *= opacityOf(el);
    const bg = groundOf(el);
    const fontPx = parseFloat(cs.fontSize), large = fontPx >= 24 || (fontPx >= 18.66 && Number(cs.fontWeight) >= 700);
    const value = ratio(fg, bg), floor = large ? 3 : 4.5;
    read++;
    worst = Math.min(worst, value);
    if (value < floor) fails.push(name(el) + ' ' + value.toFixed(2) + ':1 (floor ' + floor + ') ' + cs.color + ' on rgb(' + Math.round(bg.r) + ', ' + Math.round(bg.g) + ', ' + Math.round(bg.b) + ')');
  }
  return { read, worst: Number.isFinite(worst) ? worst : null, fails: fails.slice(0, 6), failCount: fails.length };
}

function measureLineHeights(rootSelector) {
  const root = document.querySelector(rootSelector);
  const rows = [];
  for (const el of root.querySelectorAll('h1, h2, h3, p, li')) {
    let own = false;
    for (const n of el.childNodes) if (n.nodeType === 3 && n.nodeValue.trim()) own = true;
    if (!own) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none') continue;
    const lh = parseFloat(cs.lineHeight), fs = parseFloat(cs.fontSize);
    rows.push({ tag: el.tagName.toLowerCase(), cls: typeof el.className === 'string' ? el.className : '', ratio: Number.isFinite(lh) ? lh / fs : null });
  }
  return rows;
}

function measureLines(rootSelector, locale) {
  const root = document.querySelector(rootSelector);
  const seg = locale === 'th' ? new Intl.Segmenter('th', { granularity: 'word' }) : null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const blocks = new Map();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || getComputedStyle(el).display === 'none') continue;
    const block = el.closest('p, li, h1, h2, h3');
    if (!block || (block.classList.contains('pending') && !seg)) continue;
    // the Thai document holds Thai sentences and, where a source is English, English ones: the Thai measure is taken from the blocks that are Thai script
    if (seg && !/\p{Script=Thai}/u.test(block.textContent)) continue;
    const text = n.nodeValue;
    const pieces = seg ? [...seg.segment(text)].filter(s => s.isWordLike).map(s => [s.index, s.index + s.segment.length]) : [...text.matchAll(/\S+/g)].map(m => [m.index, m.index + m[0].length]);
    for (const [a, b] of pieces) {
      const range = document.createRange();
      range.setStart(n, a);
      range.setEnd(n, b);
      // a word that the browser breaks across lines has one box per line: its characters are shared between them by the width of each box
      const rects = [...range.getClientRects()].filter(r => r.width >= 1);
      if (!rects.length) continue;
      if (!blocks.has(block)) blocks.set(block, []);
      const total = rects.reduce((s, r) => s + r.width, 0);
      rects.forEach((rect, i) => blocks.get(block).push({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, chars: (b - a) * (rect.width / total), first: i === 0 }));
    }
  }
  const lines = []; // { chars, block }
  let tall = 0;
  for (const [block, words] of blocks) {
    words.sort((x, y) => x.top - y.top || x.left - y.left);
    let cur = null;
    const lh = parseFloat(getComputedStyle(block).lineHeight) || 20;
    for (const w of words) {
      if (cur && w.top - cur.top < lh * 0.6) { cur.chars += w.chars + (seg || !w.first ? 0 : 1); cur.left = Math.min(cur.left, w.left); cur.right = Math.max(cur.right, w.right); } else { cur = { top: w.top, chars: w.chars, left: w.left, right: w.right, block }; lines.push(cur); }
    }
    tall += words.length ? 1 : 0;
  }
  // a line that is the last of its block is short by nature and is left out of the average, not out of the maximum
  const last = new Set();
  for (const [block] of blocks) { const mine = lines.filter(l => l.block === block); if (mine.length) last.add(mine[mine.length - 1]); }
  const full = lines.filter(l => !last.has(l));
  const col = root.getBoundingClientRect().width;
  const fontPx = parseFloat(getComputedStyle(root.querySelector('p, li')).fontSize);
  return { lines: lines.length, max: lines.reduce((m, l) => Math.max(m, l.chars), 0), average: full.length ? full.reduce((s, l) => s + l.chars, 0) / full.length : null, columnPx: col, fontPx, columnEm: col / fontPx };
}

function measureTheme() {
  const cs = getComputedStyle(document.body);
  return { job: document.documentElement.dataset.job ?? null, image: cs.backgroundImage, color: cs.backgroundColor, scheme: getComputedStyle(document.documentElement).colorScheme };
}

// What the browser's own log says about a page's response headers, sorted. A Content-Security-Policy violation is what the csp check is for and fails it. A message about the Permissions-Policy
// header (the browser does not know a feature name that another engine, or a later version of the same one, does) is not a CSP violation: it is returned as a note and never fails the check, so
// the run is not red on the version of the browser the runner happens to ship. Any other message the browser files under 'security' (mixed content, say) is a note too: not this check's to fail.
export function classifyLogs(logs) {
  const violations = [], notes = [];
  for (const l of logs) {
    if (/permissions[- ]policy|feature[- ]policy/i.test(l.text)) notes.push({ kind: 'permissions-policy', text: l.text });
    else if (/content security policy/i.test(l.text)) violations.push(l);
    else if (l.source === 'security') notes.push({ kind: 'security', text: l.text });
  }
  return { violations, notes };
}

// ── the run ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Returns { failures: [{ page, lang, check, detail }], measured: [{ page, lang, check, ... }], notes: [{ page, lang, kind, text }] }. A note is something the browser said that is not a failure.
export async function renderedChecks({ webDir, browser, checks = ALL_CHECKS, headers = true }) {
  const failures = [], measured = [], notes = [], languageFailed = new Set();
  const server = await serveWeb(webDir, { headers });
  const page = await browser.newPage();
  try {
    for (const file of htmlPages(webDir)) {
      const path = urlPathOf(file);
      for (const lang of ['en', 'th']) {
        const tag = { page: file, lang };
        const open = async width => {
          page.logs.length = 0;
          await page.setViewport(width, 800);
          // The browser profile is the same one on every run and its storage outlives a page: the cookies, the storage of this origin and the cache are cleared over the protocol before every load.
          await page.clearState(server.origin);
          await page.goto(server.origin + path);
          // The page script remembers the language in localStorage (one key), and every page shares this server's origin: so the language is chosen by pressing its switch on every load, never assumed.
          const got = await page.evaluate(`(() => { const b = document.querySelector('[data-lang-set="${lang}"]'); if (b) b.click(); return document.documentElement.lang; })()`);
          // a page whose switch is missing, or does not set the language, would be measured in the language it opens in, not the one asked for: say so, once
          if (got !== lang && !languageFailed.has(file + ' ' + lang)) {
            languageFailed.add(file + ' ' + lang);
            failures.push({ ...tag, check: 'language', detail: `the language switch did not set lang="${lang}" (the page reports lang="${got}"), so the measurements of this page in ${lang} would be those of another language` });
          }
        };
        if (checks.includes('reflow')) {
          await open(320);
          const m = await page.evaluate(`(${measureReflow})()`);
          measured.push({ ...tag, check: 'reflow', ...m });
          if (m.scrollWidth > m.clientWidth) failures.push({ ...tag, check: 'reflow', detail: `at 320 px the page scrolls sideways: scrollWidth ${m.scrollWidth} > clientWidth ${m.clientWidth}${m.over.length ? '; wider than the viewport: ' + m.over.join(', ') : ''}` });
        }
        if (READING_CHECKS.some(c => checks.includes(c))) {
          // the reading theme: per colour scheme, each emulated on its own (a prose page is light for a light device and dark for a dark one)
          for (const scheme of ['light', 'dark']) {
            await page.setColorScheme(scheme);
            await open(1280);
            const th = await page.evaluate(`(${measureTheme})()`);
            const stag = { ...tag, scheme };
            const wantBg = scheme === 'light' ? READING.light.bg : READING.dark.bg;
            if (checks.includes('theme') && lang === 'en') {
              measured.push({ ...stag, check: 'theme', job: th.job, image: th.image, color: th.color, colorScheme: th.scheme });
              if (th.job === 'prose') {
                if (th.image !== 'none') failures.push({ ...stag, check: 'theme', detail: `a prose page has a background image (${th.image.slice(0, 60)}): the reading theme's ground is solid` });
                const got = parseColor(th.color), want = parseColor(wantBg);
                if (!got || got.r !== want.r || got.g !== want.g || got.b !== want.b) failures.push({ ...stag, check: 'theme', detail: `in the ${scheme} scheme the ground is ${th.color}, expected ${wantBg}` });
                if (!/light/.test(th.scheme) || !/dark/.test(th.scheme)) failures.push({ ...stag, check: 'theme', detail: `color-scheme is "${th.scheme}", expected light and dark` });
              } else if (th.job === 'default') {
                if (/light/.test(th.scheme) && /dark/.test(th.scheme)) failures.push({ ...stag, check: 'theme', detail: 'a default page carries the color-scheme of the reading theme (light dark): the theme leaked into it' });
              } else failures.push({ ...stag, check: 'theme', detail: `the page declares no job (data-job is ${th.job})` });
            }
            if (th.job === 'prose') {
              if (checks.includes('contrast')) {
                const m = await page.evaluate(`(${measureContrast})()`);
                measured.push({ ...stag, check: 'contrast', read: m.read, worst: m.worst });
                if (m.read < 5) failures.push({ ...stag, check: 'contrast', detail: `only ${m.read} text elements were read, so the contrast check measured too little` });
                for (const x of m.fails) failures.push({ ...stag, check: 'contrast', detail: `under the floor in the ${scheme} scheme: ${x}${m.failCount > m.fails.length ? ` (and ${m.failCount - m.fails.length} more)` : ''}` });
              }
              if (checks.includes('measure') && scheme === 'light') {
                const m = await page.evaluate(`(${measureLines})(${JSON.stringify(lang === 'th' ? '#doc-th' : '#doc-en')}, ${JSON.stringify(lang)})`);
                measured.push({ ...tag, check: 'measure', ...m });
                if (m.lines < (lang === 'th' ? 2 : 5)) failures.push({ ...tag, check: 'measure', detail: `only ${m.lines} lines were read` });
                if (lang === 'en' && m.max > MAX_LATIN_CHARS) failures.push({ ...tag, check: 'measure', detail: `a rendered line holds ${m.max} characters; the reading measure is at most ${MAX_LATIN_CHARS} (SC 1.4.8, as a target)` });
              }
              if (checks.includes('lineheight') && scheme === 'light') {
                const rows = await page.evaluate(`(${measureLineHeights})(${JSON.stringify(lang === 'th' ? '#doc-th' : '#doc-en')})`);
                const want = lang === 'th' ? [1.65, 1.65] : [1.5, Infinity];
                const off = rows.filter(r => r.ratio === null || r.ratio < want[0] - 0.005 || r.ratio > want[1] + 0.005);
                const ratios = rows.map(r => r.ratio).filter(x => x !== null);
                measured.push({ ...tag, check: 'lineheight', read: rows.length, min: Math.min(...ratios), max: Math.max(...ratios) });
                if (rows.length < 5) failures.push({ ...tag, check: 'lineheight', detail: `only ${rows.length} text elements were read` });
                for (const r of off.slice(0, 4)) failures.push({ ...tag, check: 'lineheight', detail: `${r.tag}${r.cls ? '.' + r.cls : ''} has a line height of ${r.ratio === null ? 'normal' : r.ratio.toFixed(3)} times its size; the ${lang === 'th' ? 'Thai text is 1.65' : 'Latin text is at least 1.5'}` });
              }
            }
          }
          await page.setColorScheme('');
        }
        if (checks.includes('zoom') || checks.includes('csp')) {
          await open(1280);
          if (checks.includes('csp')) {
            const { violations, notes: said } = classifyLogs(page.logs);
            measured.push({ ...tag, check: 'csp', violations: violations.length, notes: said.length });
            for (const l of violations) failures.push({ ...tag, check: 'csp', detail: `the browser reports: ${l.text.slice(0, 200)}` });
            for (const n of said) notes.push({ ...tag, kind: n.kind, text: n.text });
          }
          if (checks.includes('zoom')) {
            await page.evaluate(`document.documentElement.style.setProperty('font-size', '200%', 'important')`);
            await page.evaluate('document.fonts.ready.then(() => true)');
            const m = await page.evaluate(`(${measureZoom})()`);
            const rootPx = await page.evaluate('parseFloat(getComputedStyle(document.documentElement).fontSize)');
            measured.push({ ...tag, check: 'zoom', rootPx, textElementsRead: m.read, issues: m.issues.length });
            for (const issue of m.issues) failures.push({ ...tag, check: 'zoom', detail: `at 200% text: ${issue}` });
            if (m.read === 0) failures.push({ ...tag, check: 'zoom', detail: 'no text element was read, so the zoom check measured nothing' });
          }
        }
      }
    }
  } finally { await page.close(); await server.close(); }
  return { failures, measured, notes };
}

// ── the command line ─────────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const take = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  if (args.includes('-h') || args.includes('--help')) { console.log('usage: node scripts/rendered-check.mjs [--web <dir>] [--only ' + ALL_CHECKS.join(',') + '] [--no-headers]\n  renders every page of web/ in headless Chrome or Edge, in both languages: 320 px reflow, 200% text, no CSP violation, and the reading theme (ground, contrast per colour scheme, line heights, line length). KOLWEN_BROWSER names the binary.'); return; }
  const known = new Set(['--web', '--only', '--no-headers', '-h', '--help']);
  const bad = args.find((a, i) => a.startsWith('-') && !known.has(a));
  if (bad) { console.error('unknown argument ' + bad); process.exitCode = 2; return; }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const webDir = resolve(take('--web') ?? resolve(root, 'web'));
  const only = take('--only');
  const checks = only ? only.split(',') : ALL_CHECKS;
  if (checks.some(c => !ALL_CHECKS.includes(c))) { console.error('--only takes ' + ALL_CHECKS.join(', ')); process.exitCode = 2; return; }
  const binary = findBrowser();
  if (!binary) {
    const msg = `no Chrome or Edge was found (set ${BROWSER_ENV} to a binary), so the rendered checks (${checks.join(', ')}) did not run`;
    if (process.env.CI === 'true') { console.error('FAIL rendered-check: ' + msg + '. In CI a missing browser is a failure, never a skip.'); process.exitCode = 1; } else console.log('SKIPPED rendered-check: ' + msg + '.');
    return;
  }
  const browser = await launchBrowser({ binary });
  try {
    const { failures, measured, notes } = await renderedChecks({ webDir, browser, checks, headers: !args.includes('--no-headers') });
    for (const f of failures) console.log(`FAIL ${f.page} [${f.lang}] ${f.check}: ${f.detail}`);
    if (notes.length) {
      const texts = [...new Set(notes.map(n => n.text.slice(0, 160)))].sort();
      console.log(`NOTE rendered-check: the browser reported ${notes.length} message(s) about the response headers on ${new Set(notes.map(n => n.page)).size} page(s) that are not a CSP violation and do not fail this run: ${texts.join(' | ')}`);
    }
    const pages = new Set(measured.map(m => m.page)).size;
    if (failures.length) { console.error(`rendered-check FAILED: ${failures.length} finding(s) over ${pages} page(s)`); process.exitCode = 1; return; }
    console.log(`rendered-check passed: ${pages} page(s) x 2 languages, ${checks.join(' + ')} (${measured.length} measurements) in ${binary}`);
  } finally { await browser.close(); }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(e => { console.error('FAIL rendered-check: ' + (e && e.message ? e.message : e)); process.exitCode = 1; });
