// The descriptive titles, the Open Graph and Twitter tags, and the canonicals of the public pages, read from the committed web/ pages, so each
// page is judged as shipped. The public list is every page a visitor can reach from the site and the sitemap, minus the 404; the two dark pages
// (/legal and /subprocessors) are outside it: they are not linked, carry noindex, and no SEO text was written for them. Run: node --test scripts/seo-tags.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PUBLIC = ['index', 'pricing', 'terms', 'privacy', 'refund', 'changelog', 'status', 'accessibility'];
const page = name => readFileSync(new URL('../web/' + name + '.html', import.meta.url), 'utf8');
const metas = html => [...html.matchAll(/<meta\b[^>]*>/gi)].map(m => Object.fromEntries([...m[0].matchAll(/([\w:-]+)="([^"]*)"/g)].map(a => [a[1].toLowerCase(), a[2]])));
const metaByProperty = (html, property) => metas(html).find(m => m.property === property)?.content;
const metaByName = (html, name) => metas(html).find(m => m.name === name)?.content;
const titleOf = html => (html.match(/<title>([^<]*)<\/title>/) || [])[1];
const canonicalOf = html => (html.match(/<link\b[^>]*rel="canonical"[^>]*>/i) || [])[0]?.match(/href="([^"]*)"/)?.[1];

test('every public page carries og:title, og:description and a summary_large_image twitter card', () => {
  for (const name of PUBLIC) {
    const html = page(name);
    assert.ok(metaByProperty(html, 'og:title'), name + ': og:title');
    assert.ok(metaByProperty(html, 'og:description'), name + ': og:description');
    assert.equal(metaByName(html, 'twitter:card'), 'summary_large_image', name + ': twitter:card');
  }
});

test('the og:title of every public page is the page title, and its og:description is the meta description (the home page keeps its own pair)', () => {
  for (const name of PUBLIC) {
    const html = page(name);
    assert.equal(metaByProperty(html, 'og:title'), titleOf(html), name + ': og:title is the <title>');
    if (name !== 'index') assert.equal(metaByProperty(html, 'og:description'), metaByName(html, 'description'), name + ': og:description is the meta description');
  }
});

test('/accessibility and /status carry a canonical on their own address', () => {
  assert.equal(canonicalOf(page('accessibility')), 'https://kolwen.com/accessibility');
  assert.equal(canonicalOf(page('status')), 'https://kolwen.com/status');
});

test('/status carries the meta description the SEO text gives it', () => {
  assert.equal(metaByName(page('status'), 'description'), 'Kolwen checks its public pages every 15 minutes; this page shows the last stored check result.');
});
