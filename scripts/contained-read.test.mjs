// Witnesses for the CI file reads (scripts/lib/contained-read.mjs): a path that resolves outside the root is refused, a file over the
// read cap is refused before it is read, and a directory alias that loops back into the root ends, with each real file read once.
// The directory links need no elevation where a junction can be made; where neither a junction nor a symlink can be made, the tests
// that need one skip visibly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { measurePage } from './page-weight.mjs';
import { check } from './sitemap-lastmod.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const roots = [];
const tree = () => { const d = mkdtempSync(join(tmpdir(), 'contained-read-')); roots.push(d); mkdirSync(join(d, 'web')); return d; };
// A directory link: a junction first (no elevation on Windows), then a symlink. False when neither can be made here.
function linkDir(target, link) {
  for (const type of ['junction', 'dir']) { try { symlinkSync(target, link, type); return true; } catch { /* the next kind */ } }
  return false;
}
const probe = tree();
const SKIP = linkDir(join(probe, 'web'), join(probe, 'probe-link')) ? false : 'no directory link (junction or symlink) can be made here';
test.after(() => { for (const d of roots) rmSync(d, { recursive: true, force: true }); });

const page = (d, head) => writeFileSync(join(d, 'web', 'index.html'), '<!doctype html><html><head>' + head + '</head><body><main>A</main></body></html>');
const sheetLink = href => '<link rel="stylesheet" href="' + href + '">';
const CPS = new Set([65]);

test('a stylesheet that resolves outside the web root is refused, not read', { skip: SKIP }, () => {
  const d = tree();
  const outside = mkdtempSync(join(tmpdir(), 'contained-outside-')); roots.push(outside);
  writeFileSync(join(outside, 'x.css'), 'body{}');
  assert.ok(linkDir(outside, join(d, 'web', 'css')));
  page(d, sheetLink('/css/x.css'));
  assert.throws(() => measurePage(join(d, 'web'), 'index.html', CPS), /loads \/css\/x\.css, leads outside the root/);
});

test('a stylesheet over the read cap is refused before it is read', () => {
  const d = tree();
  writeFileSync(join(d, 'web', 'big.css'), Buffer.alloc(9 << 20, 0x20));
  page(d, sheetLink('/big.css'));
  assert.throws(() => measurePage(join(d, 'web'), 'index.html', CPS), /loads \/big\.css, is \d+ bytes, over the \d+ byte read cap/);
});

test('a directory alias that loops back into the web root ends, and the page is measured', { skip: SKIP }, () => {
  const d = tree();
  assert.ok(linkDir(join(d, 'web'), join(d, 'web', 'loop')));
  writeFileSync(join(d, 'web', 'a.css'), '@import url("./loop/a.css");\nbody{}');
  page(d, sheetLink('/a.css'));
  const code = 'import { measurePage } from ' + JSON.stringify(pathToFileURL(join(HERE, 'page-weight.mjs')).href)
    + '; const r = measurePage(' + JSON.stringify(join(d, 'web')) + ", 'index.html', new Set([65])); console.log('DONE ' + r.requests);";
  const r = spawnSync(process.execPath, ['--max-old-space-size=1024', '--input-type=module', '-e', code], { encoding: 'utf8', timeout: 30000, killSignal: 'SIGKILL' });
  assert.equal(r.signal, null, 'the measure was ended by a signal, so the alias chain did not end: ' + (r.stderr || '').slice(0, 200));
  assert.equal(r.stdout.trim(), 'DONE 3', 'the one file under two urls is read at most twice: ' + r.stdout.trim());
});

function siteRecord(d, pagePath) {
  writeFileSync(join(d, 'web', 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset><url><loc>https://kolwen.com/o.html</loc><lastmod>2026-01-01</lastmod></url></urlset>\n');
  mkdirSync(join(d, 'scripts', 'lib'), { recursive: true });
  writeFileSync(join(d, 'scripts', 'lib', 'sitemap-content.json'), JSON.stringify({ 'https://kolwen.com/o.html': { page: pagePath, sha256: 'a'.repeat(64), lastmod: '2026-01-01' } }));
}

test('a sitemap record whose page resolves outside the root is refused, not read', { skip: SKIP }, () => {
  const d = tree();
  const outside = mkdtempSync(join(tmpdir(), 'contained-outside-')); roots.push(outside);
  writeFileSync(join(outside, 'page.html'), '<main>x</main>');
  assert.ok(linkDir(outside, join(d, 'web', 'o')));
  siteRecord(d, 'web/o/page.html');
  const { problems } = check(d, { today: '2026-02-01' });
  assert.ok(problems.some(p => /names web\/o\/page\.html, which leads outside the root/.test(p)), problems.join('\n'));
});

test('a sitemap record whose page is over the read cap is refused before it is read', () => {
  const d = tree();
  writeFileSync(join(d, 'web', 'big.html'), Buffer.alloc(9 << 20, 0x20));
  siteRecord(d, 'web/big.html');
  const { problems } = check(d, { today: '2026-02-01' });
  assert.ok(problems.some(p => /names web\/big\.html, which is \d+ bytes, over the \d+ byte read cap/.test(p)), problems.join('\n'));
});
