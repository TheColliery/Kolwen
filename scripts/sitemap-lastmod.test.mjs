// Tests for scripts/sitemap-lastmod.mjs. Every fixture is a small web/ tree in a folder under the OS temp folder; the check runs as a child with --root pointing at that
// folder, so no test reads or writes this repository's web/. Each child has a kill timer. Run: node --test scripts/sitemap-lastmod.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentHash, contentOf } from './sitemap-lastmod.mjs';

const CHECK = join(dirname(fileURLToPath(import.meta.url)), 'sitemap-lastmod.mjs');
const PAST = '2026-10-01';
const ORIGIN = 'https://kolwen.com';

// One page: a title, a description, a header and footer outside <main>, a style block, and the two language sections inside <main>.
const page = ({ title = 'Home', desc = 'About Kolwen', en = 'Hello there.', th = 'สวัสดี', chrome = 'Footer v1', style = 'a{color:red}', mainAttrs = '' } = {}) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><meta name="description" content="${desc}"><style>${style}</style></head>` +
  `<body><header>Nav</header><main${mainAttrs}><section data-lang="en"><p>${en}</p></section><section data-lang="th"><p>${th}</p></section></main><footer>${chrome}</footer></body></html>\n`;

// urls: [{ path, lastmod }] (path '/' or '/pricing'); the page file is index.html or <name>.html. pages: { 'index.html': html }.
// record: 'auto' writes the record from `recordPages` (default: the same pages); null writes none; an object is written as given.
function fixture({ pages, urls, changefreq = false, record = 'auto', recordPages = pages, recordUrls = urls }) {
  const root = mkdtempSync(join(tmpdir(), 'sitemap-lastmod-'));
  mkdirSync(join(root, 'web'), { recursive: true });
  mkdirSync(join(root, 'scripts', 'lib'), { recursive: true });
  for (const [file, html] of Object.entries(pages)) writeFileSync(join(root, 'web', file), html);
  writeFileSync(join(root, 'web', 'sitemap.xml'), sitemapXml(urls, changefreq));
  if (record === 'auto') {
    const r = {};
    for (const u of recordUrls) { const file = u.path === '/' ? 'index.html' : u.path.slice(1) + '.html'; r[ORIGIN + u.path] = { page: 'web/' + file, sha256: contentHash(recordPages[file]), lastmod: u.lastmod }; }
    writeFileSync(join(root, 'scripts', 'lib', 'sitemap-content.json'), JSON.stringify(r, null, 2) + '\n');
  } else if (record) writeFileSync(join(root, 'scripts', 'lib', 'sitemap-content.json'), JSON.stringify(record, null, 2) + '\n');
  return root;
}
function sitemapXml(urls, changefreq) {
  const rows = urls.map(u => `\t<url>\n\t\t<loc>${ORIGIN}${u.path}</loc>\n\t\t<lastmod>${u.lastmod}</lastmod>${changefreq ? '\n\t\t<changefreq>weekly</changefreq>' : ''}\n\t</url>\n`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows}</urlset>\n`;
}
// Each child gets HOME and TEMP folders of its own, inside its fixture, and a heap cap; the kill timer is the one every spawned child here has.
const run = (root, ...args) => {
  const home = join(root, 'home'), tmp = join(root, 'tmp');
  mkdirSync(home, { recursive: true });
  mkdirSync(tmp, { recursive: true });
  const env = { ...process.env, HOME: home, USERPROFILE: home, TEMP: tmp, TMP: tmp, TMPDIR: tmp };
  const r = spawnSync(process.execPath, ['--max-old-space-size=256', CHECK, '--root', root, ...args], { encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL', env });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const cleanup = roots => { for (const d of roots) rmSync(d, { recursive: true, force: true }); };

const HOME = [{ path: '/', lastmod: PAST }];

test('a tree whose record and sitemap agree with its pages passes', () => {
  const root = fixture({ pages: { 'index.html': page() }, urls: HOME });
  try { assert.equal(run(root).status, 0, run(root).out); } finally { cleanup([root]); }
});

test('an English sentence inside main changed without its lastmod moving fails, and names the page and the fix', () => {
  const old = page(), root = fixture({ pages: { 'index.html': page({ en: 'Hello, again.' }) }, urls: HOME, recordPages: { 'index.html': old } });
  try {
    const r = run(root);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /web\/index\.html/);
    assert.match(r.out, /sitemap-lastmod\.mjs --write/);
  } finally { cleanup([root]); }
});

test('a Thai sentence inside main changed without its lastmod moving fails', () => {
  const old = page(), root = fixture({ pages: { 'index.html': page({ th: 'สวัสดีครับ' }) }, urls: HOME, recordPages: { 'index.html': old } });
  try { const r = run(root); assert.equal(r.status, 1, r.out); assert.match(r.out, /web\/index\.html/); } finally { cleanup([root]); }
});

test('a footer and a style change, outside main, pass without moving lastmod', () => {
  const old = page(), root = fixture({ pages: { 'index.html': page({ chrome: 'Footer v2 with new links', style: 'a{color:blue}' }) }, urls: HOME, recordPages: { 'index.html': old } });
  try { const r = run(root); assert.equal(r.status, 0, r.out); } finally { cleanup([root]); }
});

test('a description in single quotes is read: its change without a lastmod move fails', () => {
  const single = desc => `<!doctype html><html lang="en"><head><title>Home</title><meta name='description' content='${desc}'></head><body><main><p>Body.</p></main></body></html>\n`;
  assert.notEqual(contentHash(single('About Kolwen')), contentHash(single('About Kolwen, reworded')), 'the single-quoted description is part of the hash');
  const root = fixture({ pages: { 'index.html': single('About Kolwen, reworded') }, urls: HOME, recordPages: { 'index.html': single('About Kolwen') } });
  try { const r = run(root); assert.equal(r.status, 1, r.out); assert.match(r.out, /web\/index\.html: its content changed/); } finally { cleanup([root]); }
});

test('a record without a page is one FAIL line that names the record, and the loop still checks the other URLs', () => {
  const pricing = page({ title: 'Plans' });
  // the bad record comes FIRST in the sitemap and the record, so a checker that stops at the first failure never reaches the home URL below
  const record = {
    [ORIGIN + '/pricing']: { sha256: contentHash(pricing), lastmod: PAST }, // no page
    [ORIGIN + '/']: { page: 'web/index.html', sha256: contentHash(page()), lastmod: PAST },
  };
  const root = fixture({ pages: { 'index.html': page({ en: 'Changed.' }), 'pricing.html': pricing }, urls: [{ path: '/pricing', lastmod: PAST }, { path: '/', lastmod: PAST }], record });
  try {
    const r = run(root);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /sitemap-content\.json: https:\/\/kolwen\.com\/pricing has no page/);
    assert.match(r.out, /web\/index\.html: its content changed/, 'the home URL after the bad record was still checked');
    assert.doesNotMatch(r.out, /\n\s+at /, 'no stack trace');
    assert.match(r.out, /2 of 2 URL record\(s\) failed/);
  } finally { cleanup([root]); }
});

test('a split script block leaves no tag and no script text in the content', () => {
  const c = contentOf(page({ en: '<scr<script></script>ipt>alert(1)</script>' }));
  assert.doesNotMatch(c, /</, 'no tag survives');
  assert.doesNotMatch(c, /script\(/, 'no script text survives');
});

test('a class or style attribute inside main is not content: its change passes', () => {
  assert.equal(contentHash(page({ mainAttrs: ' class="a"' })), contentHash(page({ mainAttrs: ' class="b" style="color:red"' })));
});

test('a changefreq in the sitemap fails and names the element to remove', () => {
  const root = fixture({ pages: { 'index.html': page() }, urls: HOME, changefreq: true });
  try { const r = run(root); assert.equal(r.status, 1, r.out); assert.match(r.out, /changefreq/); } finally { cleanup([root]); }
});

test('a sitemap URL with no record fails', () => {
  const root = fixture({ pages: { 'index.html': page() }, urls: HOME, record: {} });
  try { const r = run(root); assert.equal(r.status, 1, r.out); assert.match(r.out, /has no record/); } finally { cleanup([root]); }
});

test('a record with no sitemap URL fails', () => {
  const root = fixture({ pages: { 'index.html': page() }, urls: HOME, recordUrls: [...HOME, { path: '/pricing', lastmod: PAST }], recordPages: { 'index.html': page(), 'pricing.html': page({ title: 'Plans' }) } });
  try { const r = run(root); assert.equal(r.status, 1, r.out); assert.match(r.out, /no sitemap URL/); } finally { cleanup([root]); }
});

test('a page with no main element fails and names the page, even when its record was taken from the same page', () => {
  // the body changed on a page with no <main>: the content rule reads nothing in the body, so the check must refuse the page rather than pass it
  const old = page().replace(/<main[\s\S]*<\/main>/, '<div><p>Old body text.</p></div>');
  const now = old.replace('Old body text.', 'An entirely new body.');
  const root = fixture({ pages: { 'index.html': now }, urls: HOME, recordPages: { 'index.html': old } });
  try { const r = run(root); assert.equal(r.status, 1, r.out); assert.match(r.out, /web\/index\.html: needs exactly one <main>/); } finally { cleanup([root]); }
});

test('a sitemap with no url rows fails, even when its record is empty', () => {
  const root = fixture({ pages: { 'index.html': page() }, urls: [], record: {} });
  try { const r = run(root); assert.equal(r.status, 1, r.out); assert.match(r.out, /no <url> rows/); } finally { cleanup([root]); }
});

test('a missing record file fails, even when the sitemap has no url rows', () => {
  const root = fixture({ pages: { 'index.html': page() }, urls: [], record: null });
  try { const r = run(root); assert.equal(r.status, 1, r.out); assert.match(r.out, /sitemap-content\.json: missing/); } finally { cleanup([root]); }
});

test('a lastmod later than today fails', () => {
  const root = fixture({ pages: { 'index.html': page() }, urls: [{ path: '/', lastmod: '2999-01-01' }] });
  try { const r = run(root); assert.equal(r.status, 1, r.out); assert.match(r.out, /later than today/); } finally { cleanup([root]); }
});

test('a lastmod that is not a real YYYY-MM-DD date fails', () => {
  for (const bad of ['29-10-2026', '2026-02-30', '2026-13-01']) {
    const root = fixture({ pages: { 'index.html': page() }, urls: [{ path: '/', lastmod: bad }] });
    try { const r = run(root); assert.equal(r.status, 1, bad + ': ' + r.out); assert.match(r.out, /YYYY-MM-DD/); } finally { cleanup([root]); }
  }
});

test('--write moves exactly the changed page: its hash, its lastmod to today, in the record and the sitemap; nothing else changes', () => {
  const oldIndex = page(), oldPricing = page({ title: 'Plans', desc: 'Plans' });
  const urls = [{ path: '/', lastmod: PAST }, { path: '/pricing', lastmod: PAST }];
  const root = fixture({ pages: { 'index.html': page({ en: 'Changed.' }), 'pricing.html': oldPricing }, urls, recordPages: { 'index.html': oldIndex, 'pricing.html': oldPricing }, recordUrls: urls });
  const recPath = join(root, 'scripts', 'lib', 'sitemap-content.json'), smPath = join(root, 'web', 'sitemap.xml');
  try {
    const before = JSON.parse(readFileSync(recPath, 'utf8')), smBefore = readFileSync(smPath, 'utf8');
    assert.equal(run(root).status, 1, 'the stale index fails before --write');
    const w = run(root, '--write');
    assert.equal(w.status, 0, w.out);
    const after = JSON.parse(readFileSync(recPath, 'utf8'));
    assert.deepEqual(after[ORIGIN + '/pricing'], before[ORIGIN + '/pricing'], 'the unchanged page keeps its record');
    assert.equal(after[ORIGIN + '/'].sha256, contentHash(page({ en: 'Changed.' })));
    // no clock in the assertion: the date --write set in the record must be the one it set in the sitemap, and must be a real date
    const stamp = after[ORIGIN + '/'].lastmod;
    assert.match(stamp, /^\d{4}-\d{2}-\d{2}$/);
    const smAfter = readFileSync(smPath, 'utf8');
    assert.equal(smAfter, smBefore.replace(/(<loc>https:\/\/kolwen\.com\/<\/loc>\s*<lastmod>)[^<]*/, '$1' + stamp), 'the sitemap carries the record\'s date, and only that lastmod differs');
    assert.equal(run(root).status, 0, 'the tree passes after --write');
  } finally { cleanup([root]); }
});
