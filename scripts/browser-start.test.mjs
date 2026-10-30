// Tests for the native start of the browser (scripts/lib/browser.mjs, startNative): a start that answers nothing while its child lives gets one more start on a fresh port, a child
// that exits is not retried, and the browser's own words reach a failed start's line in one line. The children and the probe are fakes: no browser starts, nothing reaches the network.
// Every fake is bounded by the test's own timings. Run: node --test scripts/browser-start.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { startNative } from './lib/browser.mjs';

const LF = String.fromCharCode(10), CR = String.fromCharCode(13), ESC = String.fromCharCode(27);
const BREAKS_AND_ESC = new RegExp('[' + CR + LF + ESC + ']');

// Fake children and a fake probe. A spawn, a kill and a fresh port are logged in order; a child that is killed exits on the next turn; a child that answers `exits(port)` exits on
// its own; `stderr` is written to every child at once. `answers(port)` says whether the probe answers for that port.
function harness({ answers = () => false, exits = () => false, stderr = '' } = {}) {
  const log = [];
  let ports = 40000;
  const spawnChild = port => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => { log.push(`kill ${port}`); setImmediate(() => child.emit('exit', null)); };
    log.push(`spawn ${port}`);
    if (stderr) setImmediate(() => child.stderr.emit('data', stderr));
    if (exits(port)) setImmediate(() => child.emit('exit', 1));
    return child;
  };
  const probeVersion = async port => (answers(port) ? { webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/abc123` } : null);
  const freePort = async () => ++ports;
  return { log, opts: { spawnChild, probeVersion, freePort, profile: 'test-profile', tries: 3, stepMs: 1, settleMs: 50 } };
}

test('(a) a first start that answers nothing and stays alive is killed, and the second start on a fresh port answers: two spawns, the first killed before the second', async () => {
  const h = harness({ answers: port => port === 40002 });
  const got = await startNative(h.opts);
  assert.equal(got.endpoint, 'ws://127.0.0.1:40002/devtools/browser/abc123');
  assert.deepEqual(h.log, ['spawn 40001', 'kill 40001', 'spawn 40002']);
});

test('(b) both starts answer nothing: it rejects with one line naming both starts, after exactly two spawns, never three', async () => {
  const h = harness();
  await assert.rejects(startNative(h.opts), err => {
    assert.match(err.message, /^the browser answered nothing on its DevTools port in \d+ s, on both of 2 starts/);
    assert.equal(err.message.split(LF).length, 1, 'one line: ' + JSON.stringify(err.message));
    assert.doesNotMatch(err.message, /the browser said/, 'nothing said, nothing added');
    return true;
  });
  assert.equal(h.log.filter(l => l.startsWith('spawn')).length, 2, 'exactly two spawns: ' + h.log.join(', '));
});

test('(c) a child that exits before it answers is not retried: one spawn, the in-use or exited message', async () => {
  const h = harness({ exits: port => port === 40001 });
  await assert.rejects(startNative(h.opts), err => {
    assert.match(err.message, /exited before it answered on its DevTools port/);
    return true;
  });
  assert.deepEqual(h.log, ['spawn 40001'], 'one spawn, no kill, no second start');
});

test('(d) the stderr tail reaches a failed start as one line with the browser\'s words, and no CR, LF or ESC is left in it', async () => {
  const h = harness({ stderr: 'line one' + CR + LF + 'FAIL forged' + ESC + '[0m' });
  await assert.rejects(startNative(h.opts), err => {
    assert.match(err.message, /\(the browser said: line one FAIL forged \[0m\)$/);
    assert.doesNotMatch(err.message, BREAKS_AND_ESC);
    assert.equal(err.message.split(LF).length, 1, 'one line');
    return true;
  });
  assert.equal(h.log.filter(l => l.startsWith('spawn')).length, 2, 'the words came from a start that answered nothing, both times');
});
