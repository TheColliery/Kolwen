// The sitemap's lastmod says when each page's content last changed (sitemaps.org protocol 0.9: lastmod is "the date the page was last modified"). This check keeps it true.
//
// WHAT COUNTS AS A CONTENT CHANGE (the rule the record is kept by; contentOf() implements exactly this):
//   - the page's <title>, its <meta name="description"> content, and the TEXT inside its <main>...</main>, in both languages;
//   - tags stripped, character references decoded (lib/rendered-text.mjs, the shared decoder), whitespace collapsed to single spaces;
//   - NOT content: anything outside <main> except the title and the description (the shared header and footer, <head> styles and scripts, fonts), tag names, class and style attributes.
// So a pure style or shared-chrome change does not move lastmod; a reworded sentence in either language does.
//
// THE CHECK fails when: a page's content hash differs from its record; a sitemap lastmod differs from its record; a sitemap URL has no record, or a record has no sitemap URL;
// a lastmod is not a real YYYY-MM-DD date or is later than today (UTC); or the sitemap carries a <changefreq> (optional, and "weekly" is a claim these pages do not keep).
// THE RECORD is scripts/lib/sitemap-content.json (never served): per sitemap URL, the page file, the sha256 of its normalized content, and the lastmod.
// --write moves, for each page whose content hash changed, the record's hash and lastmod and the sitemap's lastmod to today's UTC date, and nothing else.
// --root <dir> runs the check on another tree (the tests use it). Zero dependencies: node builtins and the shared decoder only.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeAttribute, decodeEntities } from './lib/rendered-text.mjs';
import { isMainModule } from './lib/entry-guard.mjs';

const RECORD = join('scripts', 'lib', 'sitemap-content.json');
const SITEMAP = join('web', 'sitemap.xml');

// The normalized content of a page, the four parts of the rule above, one per line.
export function contentOf(html) {
  const text = s => decodeEntities(s.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
  const title = text((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1] ?? '');
  const meta = (html.match(/<meta\b[^>]*name="description"[^>]*>/i) || [])[0] ?? '';
  const desc = decodeAttribute((meta.match(/\scontent="([^"]*)"/i) || [])[1] ?? '').replace(/\s+/g, ' ').trim();
  const main = text((html.match(/<main\b[^>]*>([\s\S]*)<\/main>/i) || [])[1] ?? '');
  return [title, desc, main].join('\n');
}
export const contentHash = html => createHash('sha256').update(contentOf(html), 'utf8').digest('hex');

const isRealDate = s => { if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const t = new Date(s + 'T00:00:00Z'); return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === s; };
const sitemapRows = xml => [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(m => ({
  loc: (m[1].match(/<loc>\s*([^<\s]+)\s*<\/loc>/) || [])[1],
  lastmod: (m[1].match(/<lastmod>([^<]*)<\/lastmod>/) || [])[1],
}));
// The <lastmod> of one URL, moved to a date. The loc is escaped for the pattern.
const setLastmod = (xml, loc, date) => {
  const re = new RegExp('(<loc>\\s*' + loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*</loc>\\s*<lastmod>)[^<]*(</lastmod>)');
  if (!re.test(xml)) throw new Error(`web/sitemap.xml: no <lastmod> for ${loc} to move`);
  return xml.replace(re, '$1' + date + '$2');
};

// Returns { problems, changed }: the failures as text (empty when the tree passes), and the URLs --write moved.
export function check(root, { write = false, today = new Date().toISOString().slice(0, 10) } = {}) {
  const recPath = join(root, RECORD), smPath = join(root, SITEMAP);
  const xml = readFileSync(smPath, 'utf8');
  const record = existsSync(recPath) ? JSON.parse(readFileSync(recPath, 'utf8')) : {};
  const problems = [], changed = [], seen = new Set();
  if (/<changefreq\b/i.test(xml)) problems.push(`web/sitemap.xml: remove every <changefreq> (optional in the protocol, and "weekly" is a claim these pages do not keep)`);
  for (const row of sitemapRows(xml)) {
    seen.add(row.loc);
    const rec = record[row.loc];
    if (!rec) { problems.push(`web/sitemap.xml: ${row.loc} has no record in ${RECORD}; add its page, the sha256 of its content and its lastmod there`); continue; }
    if (row.lastmod === undefined) problems.push(`web/sitemap.xml: ${row.loc} has no <lastmod>; set it to the date its content last changed`);
    else if (!isRealDate(row.lastmod)) problems.push(`web/sitemap.xml: ${row.loc} lastmod "${row.lastmod}" is not a real YYYY-MM-DD date; set the date its content last changed`);
    else if (row.lastmod > today) problems.push(`web/sitemap.xml: ${row.loc} lastmod ${row.lastmod} is later than today (UTC) ${today}; set the date its content last changed`);
    const file = join(root, rec.page);
    if (!existsSync(file)) { problems.push(`${RECORD}: ${row.loc} names ${rec.page}, which does not exist`); continue; }
    const html = readFileSync(file, 'utf8');
    if ((html.match(/<main\b/gi) || []).length !== 1 || (html.match(/<\/main>/gi) || []).length !== 1) { problems.push(`${rec.page}: needs exactly one <main>...</main>; the content rule reads the text inside it`); continue; }
    const hash = contentHash(html);
    if (hash !== rec.sha256) {
      if (write) { changed.push({ loc: row.loc, hash }); continue; }
      problems.push(`${rec.page}: its content changed and its record was not updated; run: node scripts/sitemap-lastmod.mjs --write`);
      continue;
    }
    if (row.lastmod !== rec.lastmod) problems.push(`web/sitemap.xml: ${row.loc} lastmod ${row.lastmod} differs from its record ${rec.lastmod}; set it to the record's date (if the content changed, run: node scripts/sitemap-lastmod.mjs --write)`);
  }
  for (const loc of Object.keys(record)) if (!seen.has(loc)) problems.push(`${RECORD}: ${loc} has no sitemap URL; remove the record or add the URL to web/sitemap.xml`);
  if (!seen.size) problems.push('web/sitemap.xml: no <url> rows; the check has nothing to read');
  if (!existsSync(recPath)) problems.push(`${RECORD}: missing; it holds each page's content hash and lastmod`);
  if (write && changed.length) {
    let out = xml;
    for (const c of changed) {
      record[c.loc] = { ...record[c.loc], sha256: c.hash, lastmod: today };
      out = setLastmod(out, c.loc, today);
    }
    writeFileSync(recPath, JSON.stringify(record, null, 2) + '\n');
    writeFileSync(smPath, out);
    return { ...check(root, { today }), changed: changed.map(c => c.loc) };
  }
  return { problems, changed: [] };
}

function main(argv) {
  const at = argv.indexOf('--root');
  const root = at >= 0 ? resolve(argv[at + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const write = argv.includes('--write');
  const { problems, changed } = check(root, { write });
  for (const loc of changed) console.log(`WROTE ${loc}: record hash and lastmod, and the sitemap's lastmod, set to today's UTC date`);
  if (problems.length) { for (const p of problems) console.error('FAIL sitemap-lastmod: ' + p); process.exitCode = 1; return; }
  console.log(`PASS sitemap-lastmod: every sitemap lastmod matches its page's content record`);
}
if (isMainModule(import.meta.url)) main(process.argv.slice(2));
