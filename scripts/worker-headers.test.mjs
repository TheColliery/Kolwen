// Every response the Worker builds itself carries the site's security headers: web/_headers sets them on asset responses only. The four values are the `/*` rule's, read from that file
// and compared, so the two cannot drift; the CSP is the Worker's own, for bodies that load nothing and frame nothing. No test reaches the network or a real store.
// Run: node --test scripts/worker-headers.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../worker/index.mjs';

const WORKER_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";
const SAME_AS_SITE = ['referrer-policy', 'permissions-policy', 'cross-origin-opener-policy', 'cross-origin-resource-policy'];

// The `/*` rule of web/_headers: the header lines that follow the line `/*`, up to the first line that is not indented.
const SITE_RULE = (() => {
  const lines = readFileSync(new URL('../web/_headers', import.meta.url), 'utf8').split(/\r?\n/);
  const at = lines.indexOf('/*');
  assert.ok(at >= 0, 'web/_headers has the /* rule');
  const rule = {};
  for (const line of lines.slice(at + 1)) {
    if (!line.startsWith('  ')) break;
    const colon = line.indexOf(':');
    rule[line.slice(2, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return rule;
})();

const kv = (initial = {}) => {
  const m = new Map(Object.entries(initial));
  return { m, get: async k => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); } };
};
const STATE = JSON.stringify({ checked: '2026-11-11T00:00:00.000Z', notified: 'ok', probes: [{ path: '/', status: 200, ms: 3, ok: true }] });
const form = email => new Request('https://kolwen.com/subscribe', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email }) });
const TOKEN = 'a'.repeat(48);

// Every response the Worker builds itself, with the environment that reaches each of its branches.
const BUILT = [
  ['GET /status.json, no store bound', new Request('https://kolwen.com/status.json'), {}],
  ['GET /status.json, empty store', new Request('https://kolwen.com/status.json'), { STATUS: kv() }],
  ['GET /status.json, stored state', new Request('https://kolwen.com/status.json'), { STATUS: kv({ state: STATE }) }],
  ['POST /subscribe, switched off', form('reader@example.com'), { SUBSCRIBE: 'off', SUBSCRIBERS: kv() }],
  ['GET /subscribe, switched on', new Request('https://kolwen.com/subscribe'), { SUBSCRIBE: 'on', SUBSCRIBERS: kv() }],
  ['POST /subscribe, switched on, valid address', form('reader@example.com'), { SUBSCRIBE: 'on', SUBSCRIBERS: kv() }],
  ['POST /subscribe, switched on, malformed address', form('not-an-address'), { SUBSCRIBE: 'on', SUBSCRIBERS: kv() }],
  ['DELETE /subscribe, malformed token', new Request('https://kolwen.com/subscribe?token=x', { method: 'DELETE' }), { SUBSCRIBE: 'on', SUBSCRIBERS: kv() }],
  ['DELETE /subscribe, token', new Request('https://kolwen.com/subscribe?token=' + TOKEN, { method: 'DELETE' }), { SUBSCRIBE: 'on', SUBSCRIBERS: kv({ [TOKEN]: '{}' }) }],
  ['PUT /subscribe, switched on', new Request('https://kolwen.com/subscribe', { method: 'PUT' }), { SUBSCRIBE: 'on', SUBSCRIBERS: kv() }],
];

for (const [label, request, env] of BUILT) {
  test(`${label}: carries the five site headers, the four shared values equal to the /* rule of web/_headers`, async () => {
    const res = await worker.fetch(request, env);
    for (const name of ['content-security-policy', ...SAME_AS_SITE]) assert.ok(res.headers.get(name), `${name} is missing`);
    assert.equal(res.headers.get('content-security-policy'), WORKER_CSP);
    for (const name of SAME_AS_SITE) assert.equal(res.headers.get(name), SITE_RULE[name], `${name} differs from the /* rule`);
  });
}

test('the Worker keeps the headers its responses already send: /status.json keeps no-store and noindex, the text answers keep their type', async () => {
  const status = await worker.fetch(new Request('https://kolwen.com/status.json'), { STATUS: kv({ state: STATE }) });
  assert.equal(status.headers.get('cache-control'), 'no-store');
  assert.equal(status.headers.get('x-robots-tag'), 'noindex');
  const text = await worker.fetch(form('not-an-address'), { SUBSCRIBE: 'on', SUBSCRIBERS: kv() });
  assert.equal(text.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(text.headers.get('cache-control'), 'no-store');
});

// One place: every response the source builds goes through secured(), so a new constructor cannot skip the headers unnoticed.
test('every new Response in worker/index.mjs is passed through secured()', () => {
  const src = readFileSync(new URL('../worker/index.mjs', import.meta.url), 'utf8');
  const built = src.match(/new Response\(/g) ?? [];
  const passed = src.match(/secured\(new Response\(/g) ?? [];
  assert.ok(built.length >= 4, 'the test sees the Worker\'s responses');
  assert.equal(passed.length, built.length, `${built.length - passed.length} response constructor(s) bypass secured()`);
});
