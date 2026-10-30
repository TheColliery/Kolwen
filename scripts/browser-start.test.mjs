// Tests for the native start of the browser (scripts/lib/browser.mjs, startNative): a start that answers nothing while its child lives gets one more start on a fresh port, a child
// that exits is not retried, and the browser's own words reach a failed start's line in one line. An attempt ends at its deadline however slow the probe is; a child that ignores
// its kill is killed again and its exit confirmed before the next start; a child that never exits fails the start. The children and the probe are fakes: no browser starts, nothing
// reaches the network. Every fake is bounded by the test's own timings. Run: node --test scripts/browser-start.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { startNative } from './lib/browser.mjs';

const LF = String.fromCharCode(10), CR = String.fromCharCode(13), ESC = String.fromCharCode(27);
const BREAKS_AND_ESC = new RegExp('[' + CR + LF + ESC + ']');

// Fake children and a fake probe. A spawn, a kill (with its signal, if any) and a fresh port are logged in order. A child exits on a kill when `exitsOnKill(port, signal)` says so
// (by default on any kill); a child answers `exits(port)` by exiting on its own. `stderr` is a string written to every child, or a function of the port. `answers(port)` says whether
// the probe answers for that port.
function harness({ answers = () => false, exits = () => false, stderr = '', exitsOnKill = () => true } = {}) {
  const log = [];
  let ports = 40000;
  const words = typeof stderr === 'function' ? stderr : () => stderr;
  const spawnChild = port => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = signal => {
      log.push(`kill ${port}${signal ? ' ' + signal : ''}`);
      if (exitsOnKill(port, signal)) setImmediate(() => child.emit('exit', null));
    };
    log.push(`spawn ${port}`);
    if (words(port)) setImmediate(() => child.stderr.emit('data', words(port)));
    if (exits(port)) setImmediate(() => child.emit('exit', 1));
    return child;
  };
  const probeVersion = async port => (answers(port) ? { webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/abc123` } : null);
  const freePort = async () => ++ports;
  return { log, opts: { spawnChild, probeVersion, freePort, profile: 'test-profile', tries: 3, stepMs: 1, settleMs: 50, forceMs: 50 } };
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

test('(f) a probe that takes its whole timeout on every call ends each attempt by the deadline, not after tries probes', async () => {
  const h = harness();
  let calls = 0;
  const slowProbe = (port, timeoutMs = 200) => { calls++; return new Promise(r => setTimeout(() => r(null), timeoutMs)); };
  const t0 = Date.now();
  await assert.rejects(startNative({ ...h.opts, probeVersion: slowProbe }));
  const took = Date.now() - t0;
  assert.equal(calls, 2, 'one probe per attempt: the first probe uses up the 3 ms deadline, so tries (3 per attempt) is not reached: ' + calls);
  assert.ok(took < 600, 'both attempts end at their deadlines, in ' + took + ' ms');
});

test('(g) the first start\'s words survive a second start that says nothing: the final line carries the first start\'s tail', async () => {
  const h = harness({ stderr: port => (port === 40001 ? 'first words' : '') });
  await assert.rejects(startNative(h.opts), err => {
    assert.match(err.message, /\(the browser said: first words\)$/);
    return true;
  });
  assert.equal(h.log.filter(l => l.startsWith('spawn')).length, 2);
});

test('(h) a child that ignores its first kill is killed once more, exits, and only then the second start runs', async () => {
  const h = harness({ answers: port => port === 40002, exitsOnKill: (port, signal) => signal === 'SIGKILL' });
  const got = await startNative(h.opts);
  assert.equal(got.endpoint, 'ws://127.0.0.1:40002/devtools/browser/abc123');
  assert.deepEqual(h.log, ['spawn 40001', 'kill 40001', 'kill 40001 SIGKILL', 'spawn 40002']);
});

test('(i) a child that never exits, even to the forced kill, fails the start with its own line, and no second browser is spawned', async () => {
  const h = harness({ exitsOnKill: () => false });
  await assert.rejects(startNative(h.opts), err => {
    assert.match(err.message, /did not exit after a forced kill, so no second start was made on its profile/);
    assert.equal(err.message.split(LF).length, 1, 'one line: ' + JSON.stringify(err.message));
    return true;
  });
  assert.deepEqual(h.log, ['spawn 40001', 'kill 40001', 'kill 40001 SIGKILL'], 'one spawn, two kills, no second spawn');
});
