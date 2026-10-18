#!/usr/bin/env node
// Renders web/terms.html, web/privacy.html and web/refund.html from TERMS.md, PRIVACY.md and legal/thai-7day-clause.md, and
// web/changelog.html from the repository's own CHANGELOG.md (every passage shown as written, no hold), and web/index.html, web/pricing.html and web/404.html from their templates
// (web-src/pages/<home|pricing|notfound>.html) and the language catalogue (web-src/i18n/<bcp47>.json), and checks they are the committed pages: all seven pages are generated and none has a part
// kept by hand (build-qc.md C-FMT-02). It also owns the SHARED BLOCKS: the header and its CSS, the footer of each language and its CSS, the rules for a reader without script and
// the page script (eight marker pairs, the link to the font manifest first) are written once in scripts/lib/legal-render.mjs (SYNC_BLOCKS) and come into every page between fixed markers, so one
// edit reaches all seven pages in one run. It keeps the style-src and script-src hashes of web/_headers in step with the pages' inline <style> and <script> blocks, with the one hash routine
// surface-check uses (scripts/lib/csp-hashes.mjs), so a footer CSS edit needs no hand-typed hash. And it judges the catalogue and the templates (scripts/lib/i18n-catalogue.mjs,
// scripts/lib/page-template.mjs): a visible string that is not a catalogue slot, a key present in one language and absent in another, a bad BCP 47 tag, a split sara am, a plain space before the
// Thai repetition mark, joined keys.
//
//   node scripts/legal-pages.mjs --write    render the seven pages into web/ (the default) and update the style-src and script-src hashes in web/_headers (never a -elem directive). A catalogue,
//                                           template or marker problem makes it refuse: exit 1, loud, nothing written anywhere.
//   node scripts/legal-pages.mjs --check    render in memory; exit 1 with a named difference if a committed page differs, or if the catalogue or a template has a problem, or
//                                           web/pricing.html does not carry the same style block, a shared block of a site page differs from the shared one or has a marker missing,
//                                           doubled or out of order, or pairs that overlap or nest, a style-src or script-src hash of web/_headers no longer
//                                           matches the pages (or a style-src-elem or script-src-elem, when the policy has one, lacks one), or the hold list is unsound
//
// WHAT IT RENDERS and what it does not: see the header of scripts/lib/legal-render.mjs (the rules for a held passage, the three
// Markdown shapes it reads, the stated limits). The pages are a pure function of their sources (TERMS.md, PRIVACY.md, the clause file, CHANGELOG.md), the legal-state record
// (legal/legal-state.json), the hold list (scripts/lib/legal-holds.json) and the text in scripts/lib/legal-page-text.mjs, so nobody
// edits a page by hand: a hand edit is a difference this check names.
// Report problems at https://github.com/TheColliery/Kolwen/issues
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HEADERS = 'web/_headers';
const USAGE ='usage: node scripts/legal-pages.mjs [--write | --check]   (--help prints this; no other flag is accepted)';
const lf = s => s.replace(/\r\n/g, '\n');
const read = rel => lf(readFileSync(resolve(ROOT, rel), 'utf8'));

// The first difference between two page texts, named by line, so a failing check says where.
export function firstDifference(want, have) {
  const a = want.split('\n'), b = have.split('\n');
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      const cut = s => (s === undefined ? '(no line)' : s.length > 140 ? s.slice(0, 140) + '...' : s);
      return `line ${i + 1}: rendered \`${cut(a[i])}\` but the file has \`${cut(b[i])}\``;
    }
  }
  return null;
}

// The text between <style> and </style> of a page, or null.
export const styleOf = html => { const m = /<style>([\s\S]*?)<\/style>/.exec(html); return m ? m[1] : null; };

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) { console.log(USAGE); return; }
  const mode = args.length === 0 ? '--write' : args[0];
  if (args.length > 1 || !['--write', '--check'].includes(mode)) { console.error('unknown argument: ' + args.join(' ')); console.error(USAGE); process.exitCode = 2; return; }

  let lib;
  try { lib = await import(pathToFileURL(resolve(ROOT, 'scripts/lib/legal-render.mjs')).href); }
  catch (e) { console.error('FAIL scripts/lib/legal-render.mjs could not be loaded (' + (e.code || 'import failed') + '); restore it from the repository'); process.exitCode = 1; return; }

  let sync, cat, tpl;
  for (const [name, set] of [['page-sync', m => { sync = m; }], ['i18n-catalogue', m => { cat = m; }], ['page-template', m => { tpl = m; }]]) {
    try { set(await import(pathToFileURL(resolve(ROOT, `scripts/lib/${name}.mjs`)).href)); }
    catch (e) { console.error(`FAIL scripts/lib/${name}.mjs could not be loaded (` + (e.code || 'import failed') + '); restore it from the repository'); process.exitCode = 1; return; }
  }

  let inputs;
  try {
    let stateText = read('legal/legal-state.json');
    if (stateText.charCodeAt(0) === 0xfeff) stateText = stateText.slice(1);
    inputs = {
      terms: read('TERMS.md'), privacy: read('PRIVACY.md'), clause: read('legal/thai-7day-clause.md'), changelog: read('CHANGELOG.md'),
      state: JSON.parse(stateText), holds: JSON.parse(read('scripts/lib/legal-holds.json')),
    };
  } catch (e) { console.error('FAIL a source could not be read: ' + (e.code || e.message)); process.exitCode = 1; return; }

  // The legal pages read the shared blocks, which read the catalogue: a key the catalogue lacks throws here. That is a problem to report, with the catalogue check below beside it, never a stack trace.
  let legal;
  try { legal = lib.renderPages(inputs); }
  catch (e) { legal = { pages: {}, report: [], problems: [`the legal pages could not be rendered: ${e.message}`] }; }
  const report = legal.report;
  const fails = legal.problems.map(p => 'FAIL ' + p);

  // The language catalogue and the three templates are judged before anything is rendered from them: a visible string that is not a slot, a key missing in a language, a bad tag, a split sara am.
  const SITE_FILES = lib.SITE_PAGES.map(p => p.file);
  const catalogue = cat.loadCatalogue(ROOT);
  const templates = Object.fromEntries(lib.SITE_PAGES.map(p => [p.group, existsSync(resolve(ROOT, p.template)) ? read(p.template) : null]));
  const siteFails = catalogue.problems.map(p => 'FAIL catalogue ' + p);
  for (const p of lib.SITE_PAGES) {
    if (templates[p.group] === null) siteFails.push(`FAIL ${p.template} is missing`);
    else siteFails.push(...tpl.templateProblems(templates[p.group], p.group).map(x => 'FAIL ' + x));
  }
  if (!siteFails.length) {
    let codeKeys = new Set();
    try { codeKeys = cat.usedKeys(() => { for (const b of lib.SYNC_BLOCKS) b.render(); for (const l of Object.keys(catalogue.messages)) lib.pageNoteHtml(l); }); }
    catch (e) { siteFails.push('FAIL the shared blocks could not be rendered: ' + e.message); }
    if (!siteFails.length) siteFails.push(...tpl.usageProblems({ templates, messages: catalogue.messages, codeKeys }).map(x => 'FAIL ' + x));
  }
  const pages = { ...legal.pages };
  if (!siteFails.length) {
    const site = lib.renderSitePages({ templates, messages: catalogue.messages });
    siteFails.push(...site.problems.map(p => 'FAIL ' + p));
    Object.assign(pages, site.pages);
    const langs = Object.keys(catalogue.messages);
    for (const p of lib.SITE_PAGES) report.push(`${p.file}: template ${p.template} + the catalogue (${Object.keys(catalogue.messages[langs[0]]).length} keys in each of ${langs.map(l => l + '.json').join(', ')})`);
  }
  fails.push(...siteFails);
  for (const l of report) console.log(l);

  // Every HTML page on disk under web/, as text (LF), in name order.
  const webPages = () => Object.fromEntries(readdirSync(resolve(ROOT, 'web')).filter(f => f.endsWith('.html')).sort().map(f => ['web/' + f, read('web/' + f)]));
  const headersText = () => (existsSync(resolve(ROOT, HEADERS)) ? readFileSync(resolve(ROOT, HEADERS), 'utf8') : null);

  if (mode === '--write') {
    // Plan everything before any byte is written: a refusal anywhere leaves the whole tree as it was.
    let headersNew = null;
    if (!fails.length) {
      // The hashes the pages carry now (on disk) and the ones they will carry once the render is written.
      const disk = webPages(), after = { ...disk, ...Object.fromEntries(Object.entries(pages).map(([f, h]) => [f, lf(h)])) };
      const hashesOf = (set, of) => Object.fromEntries(Object.entries(set).map(([f, h]) => [f, of(h)]));
      const old = headersText();
      if (old === null) fails.push(`FAIL ${HEADERS} is missing, so its style-src hashes could not be updated`);
      else {
        // The style-src hashes, then the script-src hashes, each planned on the text the one before left.
        let text = old; const note = [];
        for (const [dir, plan, of] of [['style-src', sync.planStyleSrc, sync.styleHashes], ['script-src', sync.planScriptSrc, sync.scriptHashes]]) {
          const r = plan(text, hashesOf(disk, of), hashesOf(after, of));
          if (r.problem) { fails.push('FAIL ' + r.problem); break; }
          text = r.text; note.push(`${dir}: ${r.replaced} replaced, ${r.removed} removed, ${r.added} added`);
        }
        if (!fails.length && text !== old) headersNew = { text, note: note.join('; ') };
      }
    }
    if (fails.length) { fails.forEach(f => console.error(f)); console.error('nothing was written'); process.exitCode = 1; return; }
    for (const [file, html] of Object.entries(pages)) { writeFileSync(resolve(ROOT, file), html); console.log('wrote ' + file); }
    if (headersNew) { writeFileSync(resolve(ROOT, HEADERS), headersNew.text); console.log(`wrote ${HEADERS} (${headersNew.note})`); }
    return;
  }

  for (const [file, html] of Object.entries(pages)) {
    if (!existsSync(resolve(ROOT, file))) { fails.push(`FAIL ${file} is missing (run node scripts/legal-pages.mjs --write)`); continue; }
    const have = read(file);
    const d = firstDifference(html, have);
    if (d) fails.push(`FAIL ${file} differs from the render of its sources, ${d} (run node scripts/legal-pages.mjs --write)`);
  }
  // The pricing page shares the legal pages' style block, so the five pages (terms, privacy, refund, changelog, pricing) carry one CSP hash.
  if (existsSync(resolve(ROOT, 'web/pricing.html'))) {
    if (styleOf(read('web/pricing.html')) !== lib.STYLE) fails.push('FAIL web/pricing.html does not carry the same <style> block as the legal pages (the block lives in scripts/lib/legal-render.mjs as STYLE)');
  } else fails.push('FAIL web/pricing.html is missing, so its style block could not be compared');

  // The shared blocks have one source (SYNC_BLOCKS). Each site page holds each block between its markers, compared byte for byte, so a drift is named by block as well as by line (the whole page is
  // compared above); a marker that is missing, doubled or out of order is named, never worked around.
  for (const f of SITE_FILES) {
    if (!existsSync(resolve(ROOT, f))) { fails.push(`FAIL ${f} is missing, so its shared blocks could not be compared`); continue; }
    let inspected;
    try { inspected = sync.inspect(read(f), lib.SYNC_BLOCKS); }
    catch (e) { fails.push(`FAIL ${f}: its shared blocks could not be compared (${e.message})`); continue; }
    for (const r of inspected) {
      if (r.problem) { fails.push(`FAIL ${f} ${r.block.label}: ${r.problem} (restore the marker, then run node scripts/legal-pages.mjs --write)`); continue; }
      const d = r.same ? null : firstDifference(r.want, r.have);
      if (d) fails.push(`FAIL ${f} ${r.block.label} differs from the shared ${r.block.shared}, ${d} (the block is written in scripts/lib/legal-render.mjs; run node scripts/legal-pages.mjs --write)`);
    }
  }
  // The style-src hashes of _headers are the hashes of the pages' inline <style> blocks, no more and no fewer.
  const headers = headersText();
  if (headers === null) fails.push(`FAIL ${HEADERS} is missing, so its style-src hashes could not be compared`);
  else for (const p of sync.hashProblems(webPages(), headers).map(p => 'FAIL ' + p)) fails.push(p + ' (run node scripts/legal-pages.mjs --write)');

  if (fails.length) { fails.forEach(f => console.log(f)); console.log(`${fails.length} problem(s)`); process.exitCode = 1; return; }
  console.log(`legal pages: ${Object.keys(pages).length} pages match the render of their sources (${SITE_FILES.length} of them from templates and the language catalogue); the shared footer is identical on all of them; the pricing page shares their style block`);
}
main().catch(e => { console.error('FAIL legal-pages: ' + (e && e.message)); process.exitCode = 1; });
