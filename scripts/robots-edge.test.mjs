// robotsVerdict: the served robots.txt may carry Cloudflare's managed block ahead of ours, and only that.
// The edge fixture below keeps the SHAPE read from https://kolwen.com/robots.txt on 2026-10-02 (a comment-only
// content-signals preamble, a fenced managed block, then our file) with a short managed body; the real one is
// about 2,700 characters and Cloudflare's to change. Inputs are already newline-normalised, as the caller passes them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { robotsVerdict } from './lib/headers-file.mjs';

// The site's own robots policy, web/robots.txt, read as text and parsed into groups: a group is its User-agent lines and the rules under them.
const POLICY = readFileSync(new URL('../web/robots.txt', import.meta.url), 'utf8');
const groupsOf = text => {
  const groups = [];
  let cur = null, inRules = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase(), value = m[2].trim();
    if (key === 'user-agent') {
      if (!cur || inRules) { cur = { agents: [], rules: [] }; groups.push(cur); inRules = false; }
      cur.agents.push(value.toLowerCase());
    } else if (cur) {
      inRules = true;
      cur.rules.push([key, value]);
    }
  }
  return groups;
};
const groupsFor = agent => groupsOf(POLICY).filter(g => g.agents.includes(agent.toLowerCase()));
const refusesAll = g => g.rules.some(([k, v]) => k === 'disallow' && v === '/');
const blocked = agent => groupsFor(agent).some(refusesAll);
// Training crawlers the policy refuses the whole site. Every name in the saved Cloudflare list except the two search engines below.
const TRAINING = [
  'Amazonbot', 'Applebot-Extended', 'Bytespider', 'CCBot', 'ClaudeBot', 'Diffbot', 'Google-Extended', 'GPTBot', 'omgili',
  'anthropic-ai', 'Claude-Web', 'cohere-ai', 'MistralAI-Training', 'meta-externalagent', 'GoogleOther', 'AwarioSmartBot',
  'AwarioRssBot', 'Google-CloudVertexBot', 'QualifiedBot', 'Cotoyogi', 'ICC-Crawler', 'atlassian-bot', 'FishBot', 'BorderxBot',
  'NavuBot', 'SemrushBot-SWA', 'WARDBot', 'magpie-crawler', 'KimiBot', 'CitibotSiteCrawler',
];

test('the served policy names its source and carries the Content-Signal line in the group for every visitor', () => {
  assert.match(POLICY, /^# Built 2026-11-01 from the Cloudflare-managed robots\.txt served on kolwen\.com/m);
  assert.ok(groupsFor('*').some(g => g.rules.some(([k, v]) => k === 'content-signal' && v === 'search=yes,ai-train=no,use=reference')), 'the Content-Signal line');
});

test('every training crawler on the list is refused the whole site', () => {
  for (const agent of TRAINING) assert.equal(blocked(agent), true, agent + ' is refused');
});

test('this file alone refuses neither Baiduspider nor PetalBot; the edge block may, and the deploy check says so', () => {
  for (const agent of ['Baiduspider', 'PetalBot']) assert.equal(blocked(agent), false, agent + ' is not refused');
});

test('every other visitor is allowed the whole site, and the sitemap is named', () => {
  assert.ok(groupsFor('*').some(g => g.rules.some(([k, v]) => k === 'allow' && v === '/')), 'the room group allows /');
  for (const g of groupsOf(POLICY).filter(g => g.agents.includes('*'))) assert.equal(refusesAll(g), false, 'no * group refuses the site');
  for (const agent of ['Googlebot', 'Bingbot', 'Yandex']) assert.equal(blocked(agent), false, agent + ' is not refused');
  assert.match(POLICY, /^Sitemap:\s*https:\/\/kolwen\.com\/sitemap\.xml\s*$/m);
});

// Our committed file as it stands: every agent allowed by `*`, and the training crawler GPTBot refused by its own group, as web/robots.txt does.
const OURS = ['User-agent: *', 'Allow: /', 'User-agent: GPTBot', 'Disallow: /', 'Sitemap: https://kolwen.com/sitemap.xml'].join('\n');
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
  // Build the fixture line by line: drop the two fence lines, keep every other line of the edge block.
  const fenceLines = new Set(['# begin cloudflare managed content', '# end cloudflare managed content']);
  const kept = EDGE.split('\n').filter(line => !fenceLines.has(line.toLowerCase()));
  assert.equal(kept.length, EDGE.split('\n').length - 2);
  const noFence = kept.join('\n');
  assert.equal(robotsVerdict(noFence + OURS, OURS).ok, false);
});

test('fails when text is glued to the front of our first line instead of ending the fence', () => {
  assert.equal(robotsVerdict(EDGE + 'X' + OURS, OURS).ok, false);
});

test('fails when the committed file is empty and the served one is not', () => {
  assert.equal(robotsVerdict(EDGE, '').ok, false);
});

// The served edge block with one more refusing group, for an agent named by the test. Our committed file allows every agent it does not name.
const EDGE_REFUSING = agent => EDGE.replace('# END Cloudflare Managed Content', 'User-agent: ' + agent + '\nDisallow: /\n# END Cloudflare Managed Content');

test('a managed block that refuses an agent our file allows, and the list does not name, is refused', () => {
  const v = robotsVerdict(EDGE_REFUSING('ExampleBot') + OURS, OURS);
  assert.equal(v.ok, false, 'accepted: ' + JSON.stringify(v));
});

test('a managed block that refuses Baiduspider or PetalBot is accepted, because the list names them', () => {
  assert.deepEqual(robotsVerdict(EDGE_REFUSING('Baiduspider') + OURS, OURS), { ok: true, edge: true });
  assert.deepEqual(robotsVerdict(EDGE_REFUSING('PetalBot') + OURS, OURS), { ok: true, edge: true });
});

test('an empty list refuses a managed block that refuses an agent our file allows, even a named one', () => {
  assert.equal(robotsVerdict(EDGE_REFUSING('Baiduspider') + OURS, OURS, []).ok, false);
});
