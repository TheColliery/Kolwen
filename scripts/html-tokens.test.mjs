// Tests for the one HTML scan (scripts/lib/html-tokens.mjs) that the font checks and the transfer-size budget share. Pure functions, no files, node builtins only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlTokens, attrsOf } from './lib/html-tokens.mjs';

const kinds = html => htmlTokens(html).map(t => (t.type === 'text' ? 'text:' + t.text : t.type === 'tag' ? (t.closing ? '/' : '<') + t.name : t.type === 'raw' ? 'raw:' + t.name + ':' + t.body : t.type));

test('a comment ends where the tokenizer ends it: -->, --!>, <!-->, <!---> and the end of the input; what follows a comment is live', () => {
  for (const [what, comment] of [['-->', '<!-- x -->'], ['--!>', '<!-- x --!>'], ['<!-->', '<!-->'], ['<!--->', '<!--->'], ['an empty comment', '<!---->']]) {
    assert.deepEqual(kinds(comment + '<p>a</p><!-- z -->'), ['comment', '<p', 'text:a', '/p', 'comment'], what);
  }
  assert.deepEqual(kinds('a<!-- never closed <p>'), ['text:a', 'comment'], 'to the end of the input');
  assert.deepEqual(kinds('<!-- a --> <!-- b -->'), ['comment', 'text: ', 'comment']);
});

test('"<!--" opens a comment in the data state only: in an attribute value, a script, a style, a textarea or a title it is plain characters', () => {
  assert.deepEqual(kinds('<a title="<!--">x</a><p>'), ['<a', 'text:x', '/a', '<p']);
  assert.deepEqual(kinds('<a title=\'<!--\'>x</a>'), ['<a', 'text:x', '/a']);
  assert.deepEqual(kinds('<script>var s = "<!--";</script><p>'), ['<script', 'raw:script:var s = "<!--";', '/script', '<p']);
  assert.deepEqual(kinds('<style>/* <!-- */</style><p>'), ['<style', 'raw:style:/* <!-- */', '/style', '<p']);
  assert.deepEqual(kinds('<textarea><!--</textarea><p>'), ['<textarea', 'text:<!--', '/textarea', '<p']);
  assert.deepEqual(kinds('<title><!-- t</title>'), ['<title', 'text:<!-- t', '/title']);
});

test('the body of a script or a style is raw text ended only by its own end tag (any case, then a space, slash or >), and nothing in it is a tag', () => {
  assert.deepEqual(kinds('<script>var m = \'<img src="/x.png">\'; </scripts> </SCRIPT ></script>'), ['<script', 'raw:script:var m = \'<img src="/x.png">\'; </scripts> ', '/script', '/script']);
  assert.deepEqual(kinds('<script src="/a.js"></script>'), ['<script', '/script'], 'an empty body is no token');
  assert.deepEqual(kinds('<style>a{}'), ['<style', 'raw:style:a{}'], 'a body never closed runs to the end');
  assert.deepEqual(kinds('<STYLE>a{}</STYLE>'), ['<style', 'raw:style:a{}', '/style']);
});

test('the opening tag of a script or a style keeps its attributes; a textarea or title body is text (tags in it are not)', () => {
  const [open] = htmlTokens('<script src="/a.js" async></script>');
  assert.equal(open.type, 'tag');
  assert.equal(open.attrs.get('src'), '/a.js');
  assert.equal(open.attrs.get('async'), '');
  assert.deepEqual(kinds('<textarea>a <b>c</b></textarea>'), ['<textarea', 'text:a <b>c</b>', '/textarea']);
});

test('attributes are read in order: a whole name, three value forms, the first of a repeated name wins, a > inside a quoted value does not end the tag', () => {
  const a = attrsOf(' title="see href=/f.svg" rel=\'stylesheet\' href=/s.css data-href="/no" xlink:href="/no" href="/second" async');
  assert.equal(a.get('title'), 'see href=/f.svg');
  assert.equal(a.get('rel'), 'stylesheet');
  assert.equal(a.get('href'), '/s.css');
  assert.equal(a.get('data-href'), '/no');
  assert.equal(a.get('xlink:href'), '/no');
  assert.equal(a.get('async'), '');
  const [img] = htmlTokens('<img alt="a > b, src=/no" SRC=/yes.png>');
  assert.equal(img.attrs.get('src'), '/yes.png');
  assert.equal(img.attrs.get('alt'), 'a > b, src=/no');
});

test('what is not a tag: a "<" that starts nothing is text, a bogus comment (<!doctype>, <?x>, </ >) is a comment, and a tag never ended is dropped with the rest', () => {
  assert.deepEqual(kinds('a < b <3 c'), ['text:a < b <3 c']);
  assert.deepEqual(kinds('<!doctype html><p>'), ['comment', '<p']);
  assert.deepEqual(kinds('<?xml version="1.0"?><p>'), ['comment', '<p']);
  assert.deepEqual(kinds('x</ 3><p>'), ['text:x', 'comment', '<p']);
  assert.deepEqual(kinds('ok<p>t</p>tail <a title="x'), ['text:ok', '<p', 'text:t', '/p', 'text:tail ']);
  assert.deepEqual(kinds('ok <img src="/a.png"'), ['text:ok ']);
  assert.deepEqual(kinds(''), []);
});
