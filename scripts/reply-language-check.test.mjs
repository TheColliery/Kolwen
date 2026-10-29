// Tests for scripts/reply-language-check.mjs in endpoint mode: a reply the endpoint sends back is text this run did not write, so a finding quotes it as one escaped field.
// A local endpoint answers every request with a reply that carries a line break, a carriage return and an escape, the Thai message is answered in English on every path, and
// the report must still give each finding one line with no raw control character. The check runs as a child process, so the endpoint can answer while the child waits.
// Run: node --test scripts/reply-language-check.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTROLS = String.fromCharCode(10, 13, 27); // a line break, a carriage return, an escape

// The child gets a home and a temporary folder of its own (made here, under the OS temp folder, and removed by the caller), a heap cap as the other tests' children
// have, and a kill timer. Nothing it writes or reads reaches this user's home or the shared temporary folder.
const runEndpoint = (url, home) => new Promise(done => {
  const env = { ...process.env, HOME: home, USERPROFILE: home, TEMP: home, TMP: home, TMPDIR: home, KOLWEN_CHAT_ENDPOINT: url };
  execFile(process.execPath, ['--max-old-space-size=512', join(ROOT, 'scripts', 'reply-language-check.mjs')], { env, encoding: 'utf8', timeout: 120000, killSignal: 'SIGKILL', maxBuffer: 1 << 20 },
    (err, stdout, stderr) => done({ code: err ? err.code : 0, stdout, stderr }));
});

test('the endpoint report writes a reply with a line break, a carriage return and an escape as one escaped field, and no raw control character reaches it', async () => {
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ reply: 'Hello' + CONTROLS + '[31mred' })); });
  });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  const home = mkdtempSync(join(tmpdir(), 'kolwen-reply-test-'));
  try {
    const { code, stderr } = await runEndpoint(`http://127.0.0.1:${server.address().port}/chat`, home);
    assert.equal(code, 1, 'a reply in the wrong language is a failure: ' + stderr);
    assert.doesNotMatch(stderr, /[\r\u001b]/, 'no raw carriage return or escape in the report');
    const finding = stderr.split('\n').filter(l => l.includes('th/normal answered in'));
    assert.equal(finding.length, 1, 'one line for the finding: ' + JSON.stringify(finding));
    assert.ok(finding[0].endsWith('answered in en: Hello\\n\\r\\u001b[31mred'), finding[0]);
  } finally {
    server.close();
    rmSync(home, { recursive: true, force: true });
  }
});
