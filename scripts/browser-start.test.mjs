// Tests for the native start of the browser (scripts/lib/browser.mjs, startNative): a start that answers nothing while its child lives gets one more start on a fresh port, a child
// that exits is not retried, and the browser's own words reach a failed start's line in one line. An attempt ends at its deadline however slow the probe is, and no probe is ever given
// a negative timeout; a child that ignores its kill is killed again and its exit confirmed before the next start; a child that never exits fails the start. The children and the probe are
// fakes: no browser starts, nothing reaches the network. Every fake is bounded by the test's own timings, and no assertion reads the wall clock. Run: node --test scripts/browser-start.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { startNative } from './lib/browser.mjs';

const LF = String.fromCharCode(10), CR = String.fromCharCode(13), ESC = String.fromCharCode(27);
const BREAKS_AND_ESC = new RegExp('[' + CR + LF + ESC + ']');

// Fake children and a fake probe. A spawn, a kill (with its signal, if any), and the exit of a child killed by `exitsOnKill(port, signal)` are logged in order; a killed child exits
// `exitDelayMs` after its kill (under the test's settleMs, so no forced kill follows). A child answers `exits(port)` by exiting on its own (not logged). `stderr` is a string written to
// every child, or a function of the port. `answers(port)` says whether the probe answers for that port.
function harness({ answers = () => false, exits = () => false, stderr = '', exitsOnKill = () => true, exitDelayMs = 10 } = {}) {
  const log = [];
  let ports = 40000;
  const words = typeof stderr === 'function' ? stderr : () => stderr;
  const spawnChild = port => {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = signal => {
      log.push(`kill ${port}${signal ? ' ' + signal : ''}`);
      if (exitsOnKill(port, signal)) setTimeout(() => { log.push(`exit ${port}`); child.emit('exit', null); }, exitDelayMs);
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

test('(a) a first start that answers nothing and stays alive is killed, and the second start on a fresh port answers: two spawns, the first killed and exited before the second', async () => {
  const h = harness({ answers: port => port === 40002 });
  const got = await startNative(h.opts);
  assert.equal(got.endpoint, 'ws://127.0.0.1:40002/devtools/browser/abc123');
  assert.deepEqual(h.log, ['spawn 40001', 'kill 40001', 'exit 40001', 'spawn 40002']);
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

test('(f) a probe that takes its whole timeout on every call ends each attempt by the deadline, not after tries probes; each timeout it is given is within the deadline', async () => {
  const h = harness();
  const given = [];
  // a controlled clock: each probe takes 5 ms of it, past the 3 ms deadline, so every attempt makes exactly one probe whatever the scheduler does
  const realNow = Date.now;
  let clock = 1000;
  Date.now = () => clock;
  const slowProbe = (port, timeoutMs) => { given.push(timeoutMs); clock += 5; return Promise.resolve(null); };
  try {
    await assert.rejects(startNative({ ...h.opts, probeVersion: slowProbe }));
  } finally {
    Date.now = realNow;
  }
  assert.equal(given.length, 2, 'one probe per attempt: the first probe uses up the 3 ms deadline, so tries (3 per attempt) is not reached: ' + given.length);
  assert.ok(given.every(t => t >= 0 && t <= 3), 'every timeout is between 0 and the 3 ms deadline: ' + JSON.stringify(given));
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
  assert.deepEqual(h.log, ['spawn 40001', 'kill 40001', 'kill 40001 SIGKILL', 'exit 40001', 'spawn 40002']);
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

test('(j) no probe is given a negative timeout, even when the clock moves past the deadline between the loop\'s check and the probe\'s argument', async () => {
  // a clock that moves 2 ms on every read: with a 3 ms deadline the second read of each iteration is already past it
  const h = harness();
  const given = [];
  const probe = async (port, timeoutMs) => { given.push(timeoutMs); await new Promise(r => setTimeout(r, Math.max(0, timeoutMs))); return null; };
  const realNow = Date.now;
  let clock = 1000;
  Date.now = () => (clock += 2);
  try {
    await assert.rejects(startNative({ ...h.opts, probeVersion: probe }));
  } finally {
    Date.now = realNow;
  }
  assert.ok(given.length > 0, 'the probe was called');
  assert.ok(given.every(t => t >= 0), 'no negative timeout: ' + JSON.stringify(given));
});
