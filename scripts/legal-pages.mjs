#!/usr/bin/env node
// Renders web/terms.html, web/privacy.html and web/refund.html from TERMS.md, PRIVACY.md and legal/thai-7day-clause.md, and checks
// they are the committed pages.
//
//   node scripts/legal-pages.mjs --write    render the three pages into web/ (the default)
//   node scripts/legal-pages.mjs --check    render in memory; exit 1 with a named difference if a committed page differs, or if
//                                           web/pricing.html does not carry the same style block, or the hold list is unsound
//
// WHAT IT RENDERS and what it does not: see the header of scripts/lib/legal-render.mjs (the rules for a held passage, the three
// Markdown shapes it reads, the stated limits). The pages are a pure function of the three sources, the legal-state record
// (legal/legal-state.json), the hold list (scripts/lib/legal-holds.json) and the text in scripts/lib/legal-page-text.mjs, so nobody
// edits a page by hand: a hand edit is a difference this check names.
// Report problems at https://github.com/TheColliery/Kolwen/issues
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'usage: node scripts/legal-pages.mjs [--write | --check]   (--help prints this; no other flag is accepted)';
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

  let inputs;
  try {
    let stateText = read('legal/legal-state.json');
    if (stateText.charCodeAt(0) === 0xfeff) stateText = stateText.slice(1);
    inputs = {
      terms: read('TERMS.md'), privacy: read('PRIVACY.md'), clause: read('legal/thai-7day-clause.md'),
      state: JSON.parse(stateText), holds: JSON.parse(read('scripts/lib/legal-holds.json')),
    };
  } catch (e) { console.error('FAIL a source could not be read: ' + (e.code || e.message)); process.exitCode = 1; return; }

  const { pages, report, problems } = lib.renderPages(inputs);
  for (const l of report) console.log(l);
  const fails = problems.map(p => 'FAIL ' + p);

  if (mode === '--write') {
    if (fails.length) { fails.forEach(f => console.error(f)); process.exitCode = 1; return; }
    for (const [file, html] of Object.entries(pages)) { writeFileSync(resolve(ROOT, file), html); console.log('wrote ' + file); }
    return;
  }

  for (const [file, html] of Object.entries(pages)) {
    if (!existsSync(resolve(ROOT, file))) { fails.push(`FAIL ${file} is missing (run node scripts/legal-pages.mjs --write)`); continue; }
    const have = read(file);
    const d = firstDifference(html, have);
    if (d) fails.push(`FAIL ${file} differs from the render of its sources, ${d} (run node scripts/legal-pages.mjs --write)`);
  }
  // The pricing page shares the legal pages' style block, so the four pages carry one CSP hash.
  if (existsSync(resolve(ROOT, 'web/pricing.html'))) {
    if (styleOf(read('web/pricing.html')) !== lib.STYLE) fails.push('FAIL web/pricing.html does not carry the same <style> block as the legal pages (the block lives in scripts/lib/legal-render.mjs as STYLE)');
  } else fails.push('FAIL web/pricing.html is missing, so its style block could not be compared');

  if (fails.length) { fails.forEach(f => console.log(f)); console.log(`${fails.length} problem(s)`); process.exitCode = 1; return; }
  console.log(`legal pages: ${Object.keys(pages).length} pages match the render of their sources; the pricing page shares their style block`);
}
main().catch(e => { console.error('FAIL legal-pages: ' + (e && e.message)); process.exitCode = 1; });
