// Tests for worker/index.mjs: the health probes of the six sitemap pages, the alert that composes from them, and the path that ships dark. Every fetch and the email
// binding are stubs: no test reaches the network or sends mail. Nothing here spawns a child process. Run: node --test scripts/worker-monitor.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker, { PATHS, composeAlert, monitor, probe } from '../worker/index.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = 'SECRET-value-7f3a9c';
const HTML = { 'content-type': 'text/html; charset=utf-8' };

// Every path answers 200 HTML unless overridden: overrides maps a path to a Response, or to an Error that the stub throws.
const stubFetch = (overrides = {}) => async (url, init) => {
  const path = new URL(url).pathname;
  const answer = overrides[path];
  if (answer instanceof Error) throw answer;
  return answer ?? new Response('<!doctype html><title>page</title>', { status: 200, headers: HTML });
};
const mailbox = () => {
  const sent = [];
  return { sent, EMAIL: { send: async msg => { sent.push(msg); } } };
};
// Captures what the code logs, so a test can assert that nothing it logs holds an address.
const capture = async fn => {
  const logs = [], log = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  try { await fn(); } finally { console.log = log; }
  return logs;
};

test('the probe list is the sitemap\'s own six URLs', () => {
  const locs = [...readFileSync(join(ROOT, 'web', 'sitemap.xml'), 'utf8').matchAll(/<loc>https:\/\/kolwen\.com(\/[^<]*)<\/loc>/g)].map(m => m[1]);
  assert.deepEqual([...PATHS].sort(), [...locs].sort());
});

test('a run with every probe OK sends nothing', async () => {
  const box = mailbox();
  const out = await monitor({ ALERT_TO: 'owner@example.com', ALERT_FROM: 'info@kolwen.com', EMAIL: box.EMAIL }, { fetchImpl: stubFetch() });
  assert.equal(out.sent, false);
  assert.equal(box.sent.length, 0);
});

test('a failed probe sends one alert whose text holds the path and the status, and no body or header', async () => {
  const bad = new Response('secret body ' + SECRET, { status: 500, headers: { ...HTML, 'x-debug': SECRET } });
  const box = mailbox();
  const out = await monitor({ ALERT_TO: 'owner@example.com', ALERT_FROM: 'info@kolwen.com', EMAIL: box.EMAIL }, { fetchImpl: stubFetch({ '/pricing': bad }) });
  assert.equal(out.sent, true);
  assert.equal(box.sent.length, 1, 'one alert');
  const msg = box.sent[0];
  assert.equal(msg.to, 'owner@example.com');
  assert.match(msg.text, /\/pricing: HTTP 500/);
  assert.doesNotMatch(msg.text, new RegExp(SECRET));
  assert.doesNotMatch(msg.subject, new RegExp(SECRET));
});

test('ALERT_TO unset: the alert path is dark, nothing is sent, and no address reaches a log', async () => {
  const box = mailbox();
  let out;
  const logs = await capture(async () => {
    out = await monitor({ ALERT_FROM: 'info@kolwen.com', EMAIL: box.EMAIL }, { fetchImpl: stubFetch({ '/': new Response('x', { status: 503 }) }) });
  });
  assert.equal(box.sent.length, 0, 'no send');
  assert.equal(out.dark, true);
  assert.equal(logs.filter(l => /alert path dark/.test(l)).length, 1, 'one dark line: ' + logs.join('\n'));
  assert.equal(logs.filter(l => l.startsWith('{"probe":')).length, 6, 'one probe line per path');
  assert.doesNotMatch(logs.join('\n'), /SECRET|body|header/i, 'a probe line holds no body or header');
  assert.doesNotMatch(logs.join('\n'), /@/, 'no address in any log');
});

test('a probe that times out counts as failed, and its request carries a timeout signal', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push(init.signal); if (new URL(url).pathname === '/terms') throw Object.assign(new Error('late'), { name: 'TimeoutError' }); return new Response('<p>ok</p>', { status: 200, headers: HTML }); };
  const r = await probe('/terms', fetchImpl);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'timeout');
  assert.ok(seen.every(s => s instanceof AbortSignal), 'every probe passes an AbortSignal');
});

test('the composer never includes a value from a response header or body', async () => {
  const bad = new Response('body ' + SECRET, { status: 404, headers: { ...HTML, 'set-cookie': 'sid=' + SECRET, 'x-token': SECRET } });
  const results = await Promise.all(PATHS.map(p => probe(p, stubFetch({ '/refund': bad }))));
  const { subject, text } = composeAlert(results, new Date('2026-10-30T03:15:00Z'));
  assert.doesNotMatch(subject + text, new RegExp(SECRET));
  assert.match(text, /\/refund: HTTP 404/);
  assert.match(text, /2026-10-30T03:15:00\.000Z/, 'the time is UTC');
});

test('the fetch handler hands every request to the assets binding unchanged', async () => {
  const req = new Request('https://kolwen.com/nope');
  const env = { ASSETS: { fetch: async r => (r === req ? new Response('404 page', { status: 404 }) : new Response('wrong request')) } };
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 404);
  assert.equal(await res.text(), '404 page');
});

test('a send that throws is caught, and its log line names the error class only, never its message', async () => {
  const env = { ALERT_TO: 'owner@example.com', ALERT_FROM: 'info@kolwen.com', EMAIL: { send: async () => { throw new Error('refused for owner@example.com ' + SECRET); } } };
  let out;
  const logs = await capture(async () => { out = await monitor(env, { fetchImpl: stubFetch({ '/': new Response('x', { status: 503 }) }) }); });
  assert.equal(out.sent, false);
  assert.ok(logs.includes('alert send failed: Error'), logs.join('\n'));
  assert.doesNotMatch(logs.join('\n'), new RegExp(SECRET + '|@'));
});
