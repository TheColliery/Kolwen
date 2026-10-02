// robotsVerdict: the served robots.txt may carry Cloudflare's managed block ahead of ours, and only that.
// The edge fixture below keeps the SHAPE read from https://kolwen.com/robots.txt on 2026-10-02 (a comment-only
// content-signals preamble, a fenced managed block, then our file) with a short managed body; the real one is
// about 2,700 characters and Cloudflare's to change. Inputs are already newline-normalised, as the caller passes them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { robotsVerdict } from './lib/headers-file.mjs';

const OURS = ['User-agent: *', 'Allow: /', 'Sitemap: https://kolwen.com/sitemap.xml'].join('\n');
const EDGE = [
  '# As a condition of accessing this website, you agree to abide by the following',
  '# content signals:',
  '# BEGIN Cloudflare Managed content',
  'User-agent: *',
  'Content-Signal: search=yes,ai-train=no,use=reference',
  'Allow: /',
  '# Training crawlers',
  'User-agent: GPTBot',
  'Disallow: /',
  '# END Cloudflare Managed Content',
].join('\n') + '\n';

test('passes, no edge flag, when served is exactly the committed file', () => {
  assert.deepEqual(robotsVerdict(OURS, OURS), { ok: true, edge: false });
});

test('passes, edge flag set, when the served file is the managed block then the committed file', () => {
  assert.deepEqual(robotsVerdict(EDGE + OURS, OURS), { ok: true, edge: true });
});

test('fails when only the managed block is served and ours is absent', () => {
  assert.equal(robotsVerdict(EDGE.trim(), OURS).ok, false);
});

test('fails when one of our lines is changed behind the managed block', () => {
  assert.equal(robotsVerdict(EDGE + OURS.replace('Allow: /', 'Disallow: /'), OURS).ok, false);
});

test('fails when one of our lines is changed to text of the SAME length behind the managed block', () => {
  const altered = OURS.replace('Allow: /', 'Allow: .');
  assert.equal(altered.length, OURS.length);
  assert.equal(robotsVerdict(EDGE + altered, OURS).ok, false);
});

test('fails when our final line is missing behind the managed block', () => {
  assert.equal(robotsVerdict(EDGE + OURS.split('\n').slice(0, 2).join('\n'), OURS).ok, false);
});

test('fails when our file comes first and the managed block is appended after it', () => {
  assert.equal(robotsVerdict(OURS + '\n' + EDGE.trim(), OURS).ok, false);
});

test('fails when a non-comment line sits ahead of the managed block', () => {
  assert.equal(robotsVerdict('User-agent: *\nDisallow: /\n' + EDGE + OURS, OURS).ok, false);
});

test('fails when the fences are gone, so anything prepended is not accepted as the managed block', () => {
  const noFence = EDGE.replace(/# (BEGIN|END) Cloudflare Managed [Cc]ontent\n/g, '');
  assert.equal(robotsVerdict(noFence + OURS, OURS).ok, false);
});

test('fails when text is glued to the front of our first line instead of ending the fence', () => {
  assert.equal(robotsVerdict(EDGE + 'X' + OURS, OURS).ok, false);
});

test('fails when the committed file is empty and the served one is not', () => {
  assert.equal(robotsVerdict(EDGE, '').ok, false);
});
