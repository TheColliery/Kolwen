// Witnesses for the page-weight reader gaps: a refused read does not stop the other pages; a file reached under a second url keeps its own
// imports; a page reads each file once, whichever url names it; the rendered-characters reader holds the same read cap. The directory
// alias needs a junction (or a symlink); a test that needs one skips visibly where neither can be made.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkTree, measurePage, assetsOf, report } from './page-weight.mjs';
import { renderedChars } from './lib/rendered-text.mjs';
import { reads } from './lib/contained-read.mjs';

const roots = [];
const tree = () => { const d = mkdtempSync(join(tmpdir(), 'page-weight-gaps-')); roots.push(d); mkdirSync(join(d, 'web')); return d; };
function linkDir(target, link) {
  for (const type of ['junction', 'dir']) { try { symlinkSync(target, link, type); return true; } catch { /* the next kind */ } }
  return false;
}
const page = (d, name, head, body = 'A') => writeFileSync(join(d, 'web', name), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>t</title>' + head + '</head><body><main>' + body + '</main></body></html>');
const CPS = new Set([65]);
test.after(() => { for (const d of roots) rmSync(d, { recursive: true, force: true }); });

test('a refused read on one page does not stop the other pages: the refused page is a failed row and the rest are measured', t => {
  const d = tree();
  const outside = mkdtempSync(join(tmpdir(), 'page-weight-outside-')); roots.push(outside);
  writeFileSync(join(outside, 'x.css'), 'body{}');
  if (!linkDir(outside, join(d, 'web', 'o'))) return t.skip('no directory link (junction or symlink) can be made here');
  page(d, 'a.html', '<link rel="stylesheet" href="/o/x.css">');
  page(d, 'b.html', '');
  const rows = checkTree(join(d, 'web'));
  const bad = rows.find(r => r.page === 'a.html'), good = rows.find(r => r.page === 'b.html');
  assert.ok(good && good.requests > 0, 'the good page is measured: ' + JSON.stringify(rows.map(r => r.page)));
  assert.equal(bad.level, 'fail');
  assert.match(bad.notes.join(' '), /leads outside the root/);
});

test('a file reached under a second url keeps its own imports, so the alias loads the imports it names', t => {
  const d = tree();
  if (!linkDir(join(d, 'web'), join(d, 'web', 'loop'))) return t.skip('no directory link (junction or symlink) can be made here');
  writeFileSync(join(d, 'web', 'a.css'), '@import url("./b.css");\nbody{}');
  writeFileSync(join(d, 'web', 'b.css'), 'p{}');
  page(d, 'index.html', '<link rel="stylesheet" href="/a.css"><link rel="stylesheet" href="/loop/a.css">');
  const found = assetsOf(join(d, 'web'), 'index.html', CPS);
  assert.ok(found.has('/loop/b.css'), 'the alias keeps its own import: ' + [...found.keys()].join(' '));
});

test('a page reads each file once, whichever url names it', () => {
  const d = tree();
  writeFileSync(join(d, 'web', 'a.css'), 'body{}');
  page(d, 'index.html', '<link rel="stylesheet" href="/a.css">');
  reads.n = 0;
  measurePage(join(d, 'web'), 'index.html', CPS);
  assert.equal(reads.n, 2, 'the page and its one stylesheet, each read once; the reads made: ' + reads.n);
});

test('the rendered-characters reader refuses a page over the read cap, as the page measure does', () => {
  const d = tree();
  writeFileSync(join(d, 'web', 'big.html'), Buffer.alloc(9 << 20, 0x20));
  assert.throws(() => renderedChars(join(d, 'web')), /over the \d+ byte read cap/);
});
test('a missing asset is the page\'s own failed row, and a good page after it is still measured', () => {
  const d = tree();
  page(d, 'a.html', '<img src="/nope.png">');
  page(d, 'b.html', '');
  const rows = checkTree(join(d, 'web'));
  const bad = rows.find(r => r.page === 'a.html'), good = rows.find(r => r.page === 'b.html');
  assert.equal(bad.level, 'fail');
  assert.match(bad.notes.join(' '), /loads \/nope\.png, which is not in the built tree/);
  assert.ok(good && good.requests > 0, 'the good page is measured: ' + JSON.stringify(rows.map(r => r.page)));
});

test('an oversized page is its own failed row, and the pages after it are still measured', () => {
  const d = tree();
  writeFileSync(join(d, 'web', 'a.html'), Buffer.alloc(9 << 20, 0x20));
  page(d, 'b.html', '');
  const rows = checkTree(join(d, 'web'));
  const bad = rows.find(r => r.page === 'a.html'), good = rows.find(r => r.page === 'b.html');
  assert.equal(bad.level, 'fail');
  assert.match(bad.notes.join(' '), /over the \d+ byte read cap/);
  assert.ok(good && good.requests > 0, 'the good page is measured: ' + JSON.stringify(rows.map(r => r.page)));
});

test('a page whose text cannot be parsed is its own failed row, and the page after it is still measured', () => {
  const d = tree();
  page(d, 'a.html', '<p>&notarealentity;</p>');
  page(d, 'b.html', '');
  const rows = checkTree(join(d, 'web'));
  const bad = rows.find(r => r.page === 'a.html'), good = rows.find(r => r.page === 'b.html');
  assert.equal(bad.level, 'fail');
  assert.ok(good && good.requests > 0, 'the good page is measured: ' + JSON.stringify(rows.map(r => r.page)));
});

test('a failed page prints its own FAIL line on the report, with its reason once', () => {
  const d = tree();
  page(d, 'a.html', '<img src="/nope.png">');
  page(d, 'b.html', '');
  const out = report(checkTree(join(d, 'web')));
  assert.match(out, /^FAIL a\.html: loads \/nope\.png, which is not in the built tree/m);
  assert.doesNotMatch(out, /a\.html: a\.html:/);
});
