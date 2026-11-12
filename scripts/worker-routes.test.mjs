// The paths the Worker answers itself are listed twice: WORKER_ROUTES in worker/index.mjs, and assets.run_worker_first in wrangler.jsonc. A browser's navigation to a path no asset matches
// is answered by the assets pipeline (the 404 page) unless the path runs the Worker first, so the two lists must be equal, and every path in them must get the Worker's own answer.
// The config is read with the room's reader (scripts/lib/wrangler-jsonc.mjs). No test reaches the network or a real store. Run: node --test scripts/worker-routes.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { jsoncWithoutComments } from './lib/wrangler-jsonc.mjs';
import * as worker from '../worker/index.mjs';

const config = (() => {
  const text = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  return JSON.parse(jsoncWithoutComments(text));
})();

// The assets stub: every request it is asked for is marked, so a test can tell the Worker's answer from the assets pipeline's.
const ASSETS = { fetch: async () => new Response('from assets', { status: 200, headers: { 'x-answered-by': 'assets' } }) };
const kv = () => ({ get: async () => null, put: async () => {}, delete: async () => {} });

test('wrangler.jsonc lists the Worker\'s own routes in assets.run_worker_first, and only those', () => {
  const listed = config.assets?.run_worker_first;
  assert.ok(Array.isArray(listed), 'assets.run_worker_first is an array of paths');
  assert.ok(Array.isArray(worker.WORKER_ROUTES), 'worker/index.mjs exports WORKER_ROUTES, the list the Worker answers itself');
  assert.deepEqual([...listed].sort(), [...worker.WORKER_ROUTES].sort(), 'run_worker_first equals WORKER_ROUTES, as sets');
  assert.equal(new Set(listed).size, listed.length, 'no path is listed twice');
});

test('every path in WORKER_ROUTES gets the Worker\'s own answer from fetch, never the assets stub', async () => {
  for (const path of worker.WORKER_ROUTES) {
    const res = await worker.default.fetch(new Request('https://kolwen.com' + path, { headers: { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', accept: 'text/html' } }), { ASSETS, STATUS: kv(), SUBSCRIBE: 'off', SUBSCRIBERS: kv() });
    assert.equal(res.headers.get('x-answered-by'), null, path + ' was answered by the assets, not by the Worker');
  }
});

test('a path outside WORKER_ROUTES still goes to the assets, so the 404 page and the static files are unchanged', async () => {
  const res = await worker.default.fetch(new Request('https://kolwen.com/no-such-page'), { ASSETS, STATUS: kv() });
  assert.equal(res.headers.get('x-answered-by'), 'assets');
});
