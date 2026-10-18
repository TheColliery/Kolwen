// The rendered checks (build-qc.md W-A11Y-07, W-FMT-11, and the CSP the pages are served under), in a real headless browser, over every page of web/ in both languages:
//   reflow   a 320 CSS px wide viewport has no horizontal scroll (WCAG 2.2 SC 1.4.10): documentElement.scrollWidth <= clientWidth.
//   zoom     text at 200% (SC 1.4.4): the root font-size is set to 200%, as the visitor's own setting does, on a 1280 px window, and then
//            - the page does not scroll sideways, and
//            - no element's text is cut: an element with overflow hidden or clip whose content is larger than its box, and a text rectangle that sticks out of an ancestor that clips. Nothing else is
//              measured: a box that grows with its text is not a loss, and text a script moves is not read.
//   csp      the browser reports no Content-Security-Policy violation while the page loads under the real headers (a hash that no longer matches shows here, in a real browser).
// The pages are served by scripts/lib/static-server.mjs and driven by scripts/lib/browser.mjs (DevTools protocol over Node's own WebSocket; no dependency).
//
// With no browser found, CI (CI=true) FAILS; anywhere else the run says it was skipped and exits 0. A silent skip in CI is the one outcome this script refuses.
// Usage: node scripts/rendered-check.mjs [--web <dir>] [--only reflow,zoom,csp] [--no-headers]
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { htmlPages } from './lib/web-files.mjs';
import { findBrowser, launchBrowser, BROWSER_ENV } from './lib/browser.mjs';
import { serveWeb } from './lib/static-server.mjs';

export const ALL_CHECKS = ['reflow', 'zoom', 'csp'];
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

// ── the run ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Returns { failures: [{ page, lang, check, detail }], measured: [{ page, lang, check, ... }] }.
export async function renderedChecks({ webDir, browser, checks = ALL_CHECKS, headers = true }) {
  const failures = [], measured = [];
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
          await page.goto(server.origin + path);
          // The page script remembers the language in localStorage (one key), and every page shares this server's origin: so the language is chosen by pressing its switch on every load, never assumed.
          await page.evaluate(`(() => { const b = document.querySelector('[data-lang-set="${lang}"]'); if (b) b.click(); return document.documentElement.lang; })()`);
        };
        if (checks.includes('reflow')) {
          await open(320);
          const m = await page.evaluate(`(${measureReflow})()`);
          measured.push({ ...tag, check: 'reflow', ...m });
          if (m.scrollWidth > m.clientWidth) failures.push({ ...tag, check: 'reflow', detail: `at 320 px the page scrolls sideways: scrollWidth ${m.scrollWidth} > clientWidth ${m.clientWidth}${m.over.length ? '; wider than the viewport: ' + m.over.join(', ') : ''}` });
        }
        if (checks.includes('zoom') || checks.includes('csp')) {
          await open(1280);
          if (checks.includes('csp')) {
            const bad = page.logs.filter(l => l.source === 'security' || /content security policy/i.test(l.text));
            measured.push({ ...tag, check: 'csp', violations: bad.length });
            for (const l of bad) failures.push({ ...tag, check: 'csp', detail: `the browser reports: ${l.text.slice(0, 200)}` });
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
  return { failures, measured };
}

// ── the command line ─────────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const take = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  if (args.includes('-h') || args.includes('--help')) { console.log('usage: node scripts/rendered-check.mjs [--web <dir>] [--only reflow,zoom,csp] [--no-headers]\n  renders every page of web/ in headless Chrome or Edge, in both languages: 320 px reflow, 200% text, and no CSP violation. KOLWEN_BROWSER names the binary.'); return; }
  const known = new Set(['--web', '--only', '--no-headers', '-h', '--help']);
  const bad = args.find((a, i) => a.startsWith('-') && !known.has(a));
  if (bad) { console.error('unknown argument ' + bad); process.exitCode = 2; return; }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const webDir = resolve(take('--web') ?? resolve(root, 'web'));
  const only = take('--only');
  const checks = only ? only.split(',') : ALL_CHECKS;
  if (checks.some(c => !ALL_CHECKS.includes(c))) { console.error('--only takes reflow, zoom, csp'); process.exitCode = 2; return; }
  const binary = findBrowser();
  if (!binary) {
    const msg = `no Chrome or Edge was found (set ${BROWSER_ENV} to a binary), so the rendered checks (${checks.join(', ')}) did not run`;
    if (process.env.CI === 'true') { console.error('FAIL rendered-check: ' + msg + '. In CI a missing browser is a failure, never a skip.'); process.exitCode = 1; } else console.log('SKIPPED rendered-check: ' + msg + '.');
    return;
  }
  const browser = await launchBrowser({ binary });
  try {
    const { failures, measured } = await renderedChecks({ webDir, browser, checks, headers: !args.includes('--no-headers') });
    for (const f of failures) console.log(`FAIL ${f.page} [${f.lang}] ${f.check}: ${f.detail}`);
    const pages = new Set(measured.map(m => m.page)).size;
    if (failures.length) { console.error(`rendered-check FAILED: ${failures.length} finding(s) over ${pages} page(s)`); process.exitCode = 1; return; }
    console.log(`rendered-check passed: ${pages} page(s) x 2 languages, ${checks.join(' + ')} (${measured.length} measurements) in ${binary}`);
  } finally { await browser.close(); }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(e => { console.error('FAIL rendered-check: ' + (e && e.message ? e.message : e)); process.exitCode = 1; });
