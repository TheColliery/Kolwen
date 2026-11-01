// Tests for the state, the change-only alert, /status.json and the subscription endpoints in worker/index.mjs. KV, the email binding and fetch are stubs:
// no test reaches the network, sends mail or writes a real store. Nothing here spawns a child process. Run: node --test scripts/worker-status.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { buildState, handleSubscription, monitor, statusResponse, transition } from '../worker/index.mjs';

const HTML = { 'content-type': 'text/html; charset=utf-8' };
const fetchWith = (failing = new Set()) => async url => (failing.has(new URL(url).pathname)
  ? new Response('down', { status: 503 })
  : new Response('<!doctype html>', { status: 200, headers: HTML }));
const mailbox = () => {
  const sent = [];
  return { sent, EMAIL: { send: async msg => { sent.push(msg); } } };
};
const kv = () => {
  const m = new Map(), ops = [];
  return {
    ops, m,
    get: async k => { ops.push(['get', k]); return m.has(k) ? m.get(k) : null; },
    put: async (k, v) => { ops.push(['put', k]); m.set(k, v); },
    delete: async k => { ops.push(['delete', k]); m.delete(k); },
  };
};
const results = (failing = []) => ['/', '/pricing', '/terms', '/privacy', '/refund', '/changelog'].map(path => (
  failing.includes(path) ? { path, status: 503, ms: 4, ok: false } : { path, status: 200, ms: 3, ok: true }));
const form = email => new Request('https://kolwen.com/subscribe', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email }) });

test('the stored state holds the time and, per probe, only path, status, time and ok', () => {
  const state = buildState(results(['/pricing']), new Date('2026-10-30T04:00:00Z'));
  assert.deepEqual(Object.keys(state).sort(), ['checked', 'notified', 'probes']);
  assert.equal(state.notified, 'ok', 'the default: the owner was last told all OK');
  assert.equal(state.checked, '2026-10-30T04:00:00.000Z');
  for (const p of state.probes) assert.deepEqual(Object.keys(p).sort(), ['ms', 'ok', 'path', 'status']);
});

test('a change is one event: all-OK to failing alerts, a repeat failure does not, and a return to OK is one recovery', () => {
  const ok = results(), bad = results(['/']);
  assert.equal(transition(buildState(ok, new Date()), bad), 'failing');
  assert.equal(transition(buildState(bad, new Date()), bad), null);
  assert.equal(transition(buildState(bad, new Date()), ok), 'recovered');
  assert.equal(transition(buildState(ok, new Date()), ok), null);
  assert.equal(transition(null, ok), null, 'no earlier state and all OK: nothing to say');
  assert.equal(transition(null, bad), 'failing', 'no earlier state and a failure: say so');
});

test('a failing run alerts once, and the next failing run sends nothing', async () => {
  const box = mailbox(), store = kv();
  const env = { ALERT_TO: 'owner@example.com', ALERT_FROM: 'info@kolwen.com', EMAIL: box.EMAIL, STATUS: store };
  await monitor(env, { fetchImpl: fetchWith(new Set(['/'])) });
  await monitor(env, { fetchImpl: fetchWith(new Set(['/'])) });
  assert.equal(box.sent.length, 1, 'one alert for the change, none for the repeat');
});

test('a recovery sends one note, and a run after it sends nothing', async () => {
  const box = mailbox(), store = kv();
  const env = { ALERT_TO: 'owner@example.com', ALERT_FROM: 'info@kolwen.com', EMAIL: box.EMAIL, STATUS: store };
  await monitor(env, { fetchImpl: fetchWith(new Set(['/'])) });
  await monitor(env, { fetchImpl: fetchWith() });
  await monitor(env, { fetchImpl: fetchWith() });
  assert.equal(box.sent.length, 2, 'the failure and the one recovery note');
  assert.match(box.sent[1].subject, /pass again/);
});

test('a send that throws is not counted as sent: the next run, still finding the result failing, sends the alert', async () => {
  const box = mailbox(), store = kv();
  let down = true;
  const EMAIL = { send: async msg => { if (down) throw new Error('send refused'); box.sent.push(msg); } };
  const env = { ALERT_TO: 'owner@example.com', ALERT_FROM: 'info@kolwen.com', EMAIL, STATUS: store };
  await monitor(env, { fetchImpl: fetchWith(new Set(['/'])) });
  assert.equal(box.sent.length, 0, 'run 1: the send threw, nothing was sent');
  down = false;
  await monitor(env, { fetchImpl: fetchWith(new Set(['/'])) });
  assert.equal(box.sent.length, 1, 'run 2: the failure is alerted once the send works');
});

test('a failure seen while ALERT_TO is unset is alerted by the first run after it is set, while the result is still failing', async () => {
  const box = mailbox(), store = kv();
  const env = { ALERT_FROM: 'info@kolwen.com', EMAIL: box.EMAIL, STATUS: store };
  await monitor(env, { fetchImpl: fetchWith(new Set(['/'])) });
  assert.equal(box.sent.length, 0, 'run 1: no address, nothing sent');
  env.ALERT_TO = 'owner@example.com';
  await monitor(env, { fetchImpl: fetchWith(new Set(['/'])) });
  assert.equal(box.sent.length, 1, 'run 2: the alert is sent');
});

test('each run writes the state once, and what it writes holds only the allowed fields', async () => {
  const box = mailbox(), store = kv();
  const env = { ALERT_TO: 'owner@example.com', ALERT_FROM: 'info@kolwen.com', EMAIL: box.EMAIL, STATUS: store };
  await monitor(env, { fetchImpl: fetchWith(new Set(['/terms'])) });
  assert.equal(store.ops.filter(([op]) => op === 'put').length, 1, 'one write for the run');
  const saved = JSON.parse(store.m.get('state'));
  assert.deepEqual(Object.keys(saved).sort(), ['checked', 'notified', 'probes']);
  for (const p of saved.probes) assert.deepEqual(Object.keys(p).sort(), ['ms', 'ok', 'path', 'status']);
});

test('/status.json answers "No stored check result is available yet." when the store is empty, and the stored state after a run', async () => {
  const store = kv(), env = { STATUS: store };
  const empty = await statusResponse(env);
  assert.equal(empty.status, 200);
  const emptyBody = await empty.json();
  assert.equal(emptyBody.checked, null);
  assert.equal(emptyBody.message, 'No stored check result is available yet.');
  await monitor({ STATUS: store, EMAIL: mailbox().EMAIL }, { fetchImpl: fetchWith() });
  const after = await worker.fetch(new Request('https://kolwen.com/status.json'), env);
  const body = await after.json();
  assert.equal(typeof body.checked, 'string');
  assert.equal(body.probes.length, 7);
  assert.equal(after.headers.get('x-robots-tag'), 'noindex');
});

test('with SUBSCRIBE off both subscription endpoints answer 404, and the store is never written', async () => {
  const subs = kv();
  const env = { SUBSCRIBE: 'off', SUBSCRIBERS: subs };
  const post = await handleSubscription(form('owner@example.com'), env);
  const del = await handleSubscription(new Request('https://kolwen.com/subscribe?token=' + 'a'.repeat(48), { method: 'DELETE' }), env);
  assert.equal(post.status, 404);
  assert.equal(del.status, 404);
  assert.equal(subs.ops.length, 0, 'no read and no write of the store');
});

test('with SUBSCRIBE on (test only): a subscribe stores verified false and a token; delete by that token removes it', async () => {
  const subs = kv();
  const env = { SUBSCRIBE: 'on', SUBSCRIBERS: subs };
  const res = await handleSubscription(form('reader@example.com'), env);
  assert.equal(res.status, 200);
  const [[, token]] = subs.ops.filter(([op]) => op === 'put');
  assert.match(token, /^[0-9a-f]{48}$/);
  const stored = JSON.parse(subs.m.get(token));
  assert.equal(stored.verified, false);
  assert.equal(stored.email, 'reader@example.com');
  const gone = await handleSubscription(new Request('https://kolwen.com/subscribe?token=' + token, { method: 'DELETE' }), env);
  assert.equal(gone.status, 200);
  assert.equal(subs.m.size, 0);
});
