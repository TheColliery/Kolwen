// Tests for the one reader of web/_headers (scripts/lib/headers-file.mjs): a detach line (`! Name`) is a removal of a header from its rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHeadersFile, declarations } from './lib/headers-file.mjs';

test('a detach line in a rule is kept as a removal of that header, and never as one of the rule\'s headers', () => {
  const rules = parseHeadersFile('/*\n  X-Frame-Options: DENY\n  ! Content-Security-Policy\n');
  assert.deepEqual(rules[0].removes, [{ name: 'Content-Security-Policy', line: 3 }]);
  assert.deepEqual(rules[0].headers.map(h => h.name), ['X-Frame-Options']);
  assert.deepEqual(declarations(rules, 'Content-Security-Policy'), []);
});

test('a rule with no detach line has no removals, and its headers are read as before', () => {
  const rules = parseHeadersFile('/a\n  Cache-Control: no-store\n');
  assert.deepEqual(rules[0].removes, []);
  assert.deepEqual(rules[0].headers, [{ name: 'Cache-Control', value: 'no-store', line: 2 }]);
});
