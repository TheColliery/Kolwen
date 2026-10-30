// Tests for the language catalogue (web-src/i18n/<bcp47>.json), the page templates (web-src/pages/*.html) and the build that renders the site's pages from them
// (scripts/lib/i18n-catalogue.mjs, scripts/lib/page-template.mjs, scripts/lib/legal-render.mjs, scripts/legal-pages.mjs). The rows they answer are named in each test
// (build-qc.md C-I18N-01, -03, -05, -06, -16, -17; W-I18N-12; C-FMT-02). Node builtins only. A test that needs a changed tree works on a copy in a temp folder; every child has a heap cap and a kill timeout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { htmlTokens } from './lib/html-tokens.mjs';
import { catalogueProblems, bcp47Problem, loadCatalogue, parseValue, valueJson, withCatalogue, usedKeys, MARKUP } from './lib/i18n-catalogue.mjs';
import { templateProblems, usageProblems, renderTemplate, slotsOf } from './lib/page-template.mjs';
import { renderSitePages, SITE_PAGES, SYNC_BLOCKS, pageNoteHtml, siteFooterHtml, siteHeaderHtml } from './lib/legal-render.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const bytes = rel => readFileSync(join(ROOT, rel));
const enc = s => Buffer.from(s, 'utf8');
const CAT = loadCatalogue(ROOT);
const TEMPLATES = Object.fromEntries(SITE_PAGES.map(p => [p.group, read(p.template)]));
const NBSP = String.fromCharCode(0xa0);
const AFTER_MATH = String.fromCharCode(0xe46); // the Thai repetition mark, written as a code point so the file holds no invisible text
const files = () => Object.fromEntries(readdirSync(join(ROOT, 'web-src/i18n')).sort().map(f => [f, bytes('web-src/i18n/' + f)]));
const withFile = (name, text) => ({ ...files(), [name]: enc(text) });
const edited = (lang, fn) => { const o = JSON.parse(files()[lang + '.json'].toString('utf8')); fn(o); return { ...files(), [lang + '.json']: enc(JSON.stringify(o, null, 2) + '\n') }; };

// ── the catalogue: shape, and the answer to "is every page string in it" ─────────────────────────────────────────
test('the catalogue is one file per language, en and th at least (a third is checked and renders no page), whose top-level keys are the page names and one shared group', () => {
  for (const f of ['en.json', 'th.json']) assert.ok(Object.keys(files()).includes(f), f + ' is present');
  for (const [name, b] of Object.entries(files())) {
    const top = Object.keys(JSON.parse(b.toString('utf8'))).sort();
    assert.deepEqual(top, ['home', 'notfound', 'pricing', 'shared', 'status'], name + ': keyed by page (home, pricing, notfound, status) plus shared, never by domain');
  }
  assert.deepEqual(SITE_PAGES.map(p => p.group), ['home', 'pricing', 'notfound', 'status']);
  const n = { en: Object.keys(CAT.messages.en).length, th: Object.keys(CAT.messages.th).length };
  assert.equal(n.en, n.th, 'one key set');
  assert.ok(n.en > 100 && n.en < 400, 'keys per file: ' + n.en);
});

test('the real catalogue, the real templates and their use have no problem', () => {
  assert.deepEqual(catalogueProblems(files()), []);
  for (const [group, src] of Object.entries(TEMPLATES)) assert.deepEqual(templateProblems(src, group), [], group);
  assert.deepEqual(usageProblems({ templates: TEMPLATES, messages: CAT.messages, codeKeys: usedKeysOfShared() }), []);
});

// The keys the shared blocks of legal-render.mjs read (the header, the footers, the page note): they are rendered once with a recording catalogue.
function usedKeysOfShared() {
  const seen = usedKeys(() => { for (const b of SYNC_BLOCKS) b.render(); for (const l of ['en', 'th']) pageNoteHtml(l); });
  return seen;
}

test('(a) the four pages are rendered from the templates and the catalogue, and the committed pages are that render, byte for byte', () => {
  const { pages, problems } = renderSitePages({ templates: TEMPLATES, messages: CAT.messages });
  assert.deepEqual(problems, []);
  assert.deepEqual(Object.keys(pages).sort(), ['web/404.html', 'web/index.html', 'web/pricing.html', 'web/status.html']);
  for (const [file, html] of Object.entries(pages)) assert.equal(html, read(file), file + ' is the render of its template');
});

// The visible strings of a page that carry no mark. The walk reads the page as a visitor WITHOUT script does (`scripting: false`): a <noscript> body is markup there, so its text, attributes and styles
// are walked; with the default (scripting on) a <noscript> body is one raw token and a literal inside it would pass.
function strayStrings(html, MARK) {
  const stray = [];
  let last = null, ld = false;
  for (const t of htmlTokens(html, { scripting: false })) {
    if (t.type === 'tag' && !t.closing) {
      last = t;
      // an EMPTY alt is the decorative form (WCAG 1.1.1), not a visible string: it is exempt, and only it; a non-empty alt still has to carry its mark
      for (const a of ['aria-label', 'title', 'alt', 'placeholder']) if (t.attrs.has(a) && !(a === 'alt' && t.attrs.get(a) === '') && !t.attrs.get(a).includes(MARK)) stray.push(`${t.name} ${a}="${t.attrs.get(a)}"`);
      if (t.name === 'meta' && /^(description|og:title|og:description|twitter:title|twitter:description)$/.test(t.attrs.get('name') ?? t.attrs.get('property') ?? '') && !t.attrs.get('content').includes(MARK)) stray.push(`meta ${t.attrs.get('name') ?? t.attrs.get('property')} content`);
    } else if (t.type === 'text' && t.text.trim() !== '' && !t.text.includes(MARK)) stray.push('text ' + JSON.stringify(t.text.trim().slice(0, 60)));
    else if (t.type === 'raw' && t.name === 'script' && last && last.attrs.get('type') === 'application/ld+json') {
      ld = true;
      for (const m of t.body.matchAll(/"([^"]+)"\s*:\s*"([^"]*)"/g)) if (!/^(@context|@type|url|image|email)$/.test(m[1]) && !m[2].includes(MARK)) stray.push(`ld+json ${m[1]}`);
    }
  }
  return { stray, ld };
}

test('(b) the stray-string walk reads a <noscript> body as a visitor without script does: a literal in it is found', () => {
  const MARK = '§';
  const page = body => `<!DOCTYPE html><html lang="en"><head><title>T${MARK}</title></head><body><p>ok${MARK}</p>${body}</body></html>`;
  assert.deepEqual(strayString(page('')), []);
  assert.deepEqual(strayString(page(`<noscript><p>fine${MARK}</p></noscript>`)), []);
  assert.ok(strayString(page('<noscript><p>Plain words</p></noscript>')).some(s => /Plain words/.test(s)), 'text in a noscript');
  assert.ok(strayString(page('<noscript><img alt="Plain alt" src="/a.png"></noscript>')).some(s => /Plain alt/.test(s)), 'an attribute in a noscript');
  function strayString(html) { return strayStrings(html, MARK).stray; }
});

test('(b) an empty alt is decorative, not a visible string: the band as the templates place it passes', () => {
  const MARK = '§';
  const page = img => `<!DOCTYPE html><html lang="en"><head><title>T${MARK}</title></head><body><p>ok${MARK}</p>${img}</body></html>`;
  assert.deepEqual(strayStrings(page('<img class="band" src="/band-404.svg" width="600" height="300" alt="" decoding="async">'), MARK).stray, []);
});

test('(b) a non-empty alt that is not from the catalogue is still found', () => {
  const MARK = '§';
  const page = img => `<!DOCTYPE html><html lang="en"><head><title>T${MARK}</title></head><body><p>ok${MARK}</p>${img}</body></html>`;
  assert.ok(strayStrings(page('<img src="/a.png" alt="Some English">'), MARK).stray.some(s => /Some English/.test(s)));
});

test('(b) the exemption is the empty value and nothing else: a space-only alt and an empty aria-label are both found', () => {
  const MARK = '§';
  const page = el => `<!DOCTYPE html><html lang="en"><head><title>T${MARK}</title></head><body><p>ok${MARK}</p>${el}</body></html>`;
  assert.ok(strayStrings(page('<img src="/a.png" alt=" ">'), MARK).stray.some(s => /alt=" "/.test(s)));
  assert.ok(strayStrings(page('<button type="button" aria-label="">Go</button>'), MARK).stray.some(s => /aria-label=""/.test(s)));
});

test('(b) every visible string of the four pages comes from the catalogue: each stretch of text in a value carries a mark, and no visible text or attribute lacks it', () => {
  const MARK = '§';
  // a mark at the end of every stretch of text of a value (the text between its markup tags), so a piece of text the page shows that is not from a value has none
  const mark = v => parseValue(v).map(t => (t.kind === 'text' ? t.text + MARK : `{${t.kind === 'open' ? '#' : '/'}${t.name}}`)).join('');
  const marked = Object.fromEntries(Object.entries(CAT.messages).map(([l, m]) => [l, Object.fromEntries(Object.entries(m).map(([k, v]) => [k, mark(v)]))]));
  withCatalogue(marked, () => {
    const { pages, problems } = renderSitePages({ templates: TEMPLATES, messages: marked });
    assert.deepEqual(problems, []);
    for (const [file, html] of Object.entries(pages)) {
      const { stray, ld } = strayStrings(html, MARK);
      assert.deepEqual(stray, [], file + ': strings that did not come from the catalogue');
      if (file === 'web/index.html') assert.ok(ld, 'the home page carries its structured data');
      assert.ok(html.includes(MARK), file + ' shows catalogue values');
    }
  });
});

test('(b) a catalogue value that changes changes the page, in the English document and in the Thai one', () => {
  const o = structuredClone(CAT.messages);
  o.en['pricing.title'] = 'Prices, changed';
  o.th['pricing.title'] = 'ราคา เปลี่ยน';
  const { pages } = renderSitePages({ templates: TEMPLATES, messages: o });
  const html = pages['web/pricing.html'];
  assert.ok(html.includes('<h1>Prices, changed</h1>') && html.includes('<h1>ราคา เปลี่ยน</h1>'));
  assert.notEqual(html, read('web/pricing.html'));
});

test('(b) a template that holds a literal visible string fails: a text node, a visible attribute, a meta text and a structured-data value', () => {
  const base = '<!DOCTYPE html>\n<html lang="en"><head><title>{{home.meta.title}}</title></head><body>\n';
  const ok = base + '<p>{{home.origin}}</p>\n<div aria-label="{{=home.mark.reading}}"></div>\n</body></html>\n';
  assert.deepEqual(templateProblems(ok, 'home'), []);
  const bad = [
    ['a literal paragraph', ok.replace('<p>{{home.origin}}</p>', '<p>Hello there</p>'), /literal text "Hello there"/],
    ['a literal beside a slot', ok.replace('<p>{{home.origin}}</p>', '<p>Hello {{home.origin}}</p>'), /literal text|joins/],
    ['a literal aria-label', ok.replace('aria-label="{{=home.mark.reading}}"', 'aria-label="Menu"'), /attribute aria-label holds the literal "Menu"/],
    ['a literal title attribute', ok.replace('<div aria-label', '<div title="Tip" aria-label'), /attribute title holds the literal "Tip"/],
    ['a literal alt', ok.replace('<div aria-label', '<img alt="Logo" aria-label'), /attribute alt holds the literal "Logo"/],
    ['a literal meta description', ok.replace('</head>', '<meta name="description" content="Plain text"></head>'), /attribute content of the meta description holds the literal "Plain text"/],
    ['a literal og:title', ok.replace('</head>', '<meta property="og:title" content="Plain text"></head>'), /og:title holds the literal "Plain text"/],
    ['a literal title element', ok.replace('<title>{{home.meta.title}}</title>', '<title>Kolwen home</title>'), /literal text "Kolwen home"/],
    ['a literal in structured data', ok.replace('</head>', '<script type="application/ld+json">{"@type": "Organization", "description": "A plain sentence."}</script></head>'), /structured data value "A plain sentence\."/],
  ];
  for (const [what, src, re] of bad) assert.ok(templateProblems(src, 'home').some(p => re.test(p)), what + ': ' + JSON.stringify(templateProblems(src, 'home')));
  const fine = ok.replace('</head>', '<script type="application/ld+json">{"@type": "Organization", "name": "{{j:shared.brand}}", "url": "https://kolwen.com", "email": "info@kolwen.com", "sameAs": ["https://github.com/x"]}</script><style>.a{color:red}</style></head>');
  assert.deepEqual(templateProblems(fine, 'home'), [], 'urls, an email, a type and a style block with no content string are not visible strings');
});

// ── (c) key parity, both directions (C-I18N-17) ─────────────────────────────────────────────────────────────────
test('(c) a key in one language and not in the other fails, both directions, and names the key and the file', () => {
  const noTh = edited('th', o => { delete o.pricing.title; });
  assert.ok(catalogueProblems(noTh).some(p => /pricing\.title/.test(p) && /th\.json/.test(p) && /missing/.test(p)), JSON.stringify(catalogueProblems(noTh)));
  const noEn = edited('en', o => { delete o.shared.brand; });
  assert.ok(catalogueProblems(noEn).some(p => /shared\.brand/.test(p) && /en\.json/.test(p) && /missing/.test(p)));
  const extraTh = edited('th', o => { o.pricing.invented = 'ใหม่'; });
  assert.ok(catalogueProblems(extraTh).some(p => /pricing\.invented/.test(p) && /en\.json/.test(p) && /missing/.test(p)), 'an extra key in th fails too');
  const extraEn = edited('en', o => { o.home.invented = 'New'; });
  assert.ok(catalogueProblems(extraEn).some(p => /home\.invented/.test(p) && /th\.json/.test(p) && /missing/.test(p)), 'an extra key in en fails too');
});

test('(c) the markup of a value must be the same in every language, and balanced and known', () => {
  const lost = edited('th', o => { o.home.hero.title = o.home.hero.title.replace('{#hl}', '').replace('{/hl}', ''); });
  assert.ok(catalogueProblems(lost).some(p => /home\.hero\.title/.test(p) && /markup/.test(p)), JSON.stringify(catalogueProblems(lost)));
  const open = edited('en', o => { o.home.hero.title = 'A {#hl}verifiable AI'; });
  assert.ok(catalogueProblems(open).some(p => /home\.hero\.title/.test(p) && /never closed|unbalanced/.test(p)));
  const unknown = edited('en', o => { o.home.hero.title = 'A {#blink}verifiable{/blink} AI'; });
  assert.ok(catalogueProblems(unknown).some(p => /home\.hero\.title/.test(p) && /unknown markup/.test(p)));
  const stray = edited('en', o => { o.home.hero.title = 'A {verifiable} AI'; });
  assert.ok(catalogueProblems(stray).some(p => /home\.hero\.title/.test(p) && /brace/.test(p)));
  assert.deepEqual(parseValue('a {#b}b{/b} c').map(t => t.kind), ['text', 'open', 'text', 'close', 'text']);
  assert.ok(Object.keys(MARKUP).includes('hl'));
});

test('the keys are lowercase ASCII dot-paths, the values are strings, no key repeats in a file, and an empty value is only where no slot shows it', () => {
  assert.ok(catalogueProblems(edited('en', o => { o.home.Title = 'x'; })).some(p => /home\.Title/.test(p) && /lowercase/.test(p)));
  assert.ok(catalogueProblems(edited('en', o => { o.home.ไทย = 'x'; })).some(p => /lowercase/.test(p)));
  assert.ok(catalogueProblems(edited('en', o => { o.home.count = 5; })).some(p => /home\.count/.test(p) && /string/.test(p)));
  assert.ok(catalogueProblems(edited('en', o => { o.home.list = ['a']; })).some(p => /home\.list/.test(p) && /string/.test(p)));
  const dup = withFile('en.json', files()['en.json'].toString('utf8').replace('"brand": "Kolwen"', '"brand": "Kolwen",\n    "brand": "Kolwen"'));
  assert.ok(catalogueProblems(dup).some(p => /en\.json/.test(p) && /repeats the key brand/.test(p)), JSON.stringify(catalogueProblems(dup)));
  assert.ok(catalogueProblems(withFile('en.json', '{"home": ')).some(p => /en\.json/.test(p) && /JSON/.test(p)));
  assert.ok(catalogueProblems(edited('en', o => { o.home.hero.title = ' padded '; })).some(p => /home\.hero\.title/.test(p) && /leading or trailing/.test(p)));
  // an empty value: shown by a slot is a problem, shown by none is fine (home.hero.sub is the English document's alone)
  const m = structuredClone(CAT.messages);
  assert.equal(m.th['home.hero.sub'], '', 'the Thai document has no sub paragraph today');
  assert.deepEqual(usageProblems({ templates: TEMPLATES, messages: m, codeKeys: usedKeysOfShared() }), []);
  m.en['pricing.title'] = '';
  assert.ok(usageProblems({ templates: TEMPLATES, messages: m, codeKeys: usedKeysOfShared() }).some(p => /pricing\.title/.test(p) && /empty string in en/.test(p)), 'empty where the English region shows it');
  const th = structuredClone(CAT.messages);
  th.th['pricing.title'] = '';
  assert.ok(usageProblems({ templates: TEMPLATES, messages: th, codeKeys: usedKeysOfShared() }).some(p => /pricing\.title/.test(p) && /empty string in th/.test(p)), 'empty where the Thai region shows it');
  const sub = structuredClone(CAT.messages);
  sub.en['home.hero.sub'] = '';
  assert.ok(usageProblems({ templates: TEMPLATES, messages: sub, codeKeys: usedKeysOfShared() }).some(p => /home\.hero\.sub/.test(p) && /empty string in en/.test(p)), 'the English document does show the sub line');
});

test('a name that is not translated is the same in every language, and the default language must have a catalogue', () => {
  assert.ok(catalogueProblems(edited('th', o => { o.shared.brand = 'Kolwen2'; })).some(p => /shared\.brand/.test(p) && /same in every language/.test(p)), 'the brand');
  assert.ok(catalogueProblems(edited('th', o => { o.shared.switch.th = 'Thai'; })).some(p => /shared\.switch\.th/.test(p) && /same in every language/.test(p)), 'a language named in its own language');
  assert.ok(catalogueProblems(edited('en', o => { o.shared.names.github = 'Git Hub'; })).some(p => /shared\.names\.github/.test(p) && /same in every language/.test(p)), 'a product name');
  assert.ok(catalogueProblems({ 'th.json': files()['th.json'] }).some(p => /en\.json is missing/.test(p) && /default language/.test(p)));
});

// ── (d) BCP 47 (C-I18N-03) ──────────────────────────────────────────────────────────────────────────────────────
test('(d) every catalogue file name and every lang value is a valid BCP 47 tag: th and en pass; th-Thai, th_TH, TH, a made-up word and an empty tag fail', () => {
  for (const ok of ['en', 'th', 'th-TH', 'zh-Hant', 'en-GB', 'sr-Latn']) assert.equal(bcp47Problem(ok), null, ok);
  for (const [bad, re] of [['th-Thai', /suppress/i], ['en-Latn', /suppress/i], ['th_TH', /not a valid/], ['TH', /canonical/], ['english', /not a valid/], ['', /empty/], ['th-', /not a valid/], ['zh-hant', /canonical/]]) {
    assert.match(bcp47Problem(bad) ?? 'no problem', re, JSON.stringify(bad));
  }
  const badName = { ...files(), 'th_TH.json': files()['th.json'] };
  assert.ok(catalogueProblems(badName).some(p => /th_TH\.json/.test(p) && /not a valid/.test(p)), JSON.stringify(catalogueProblems(badName)));
  assert.ok(catalogueProblems({ ...files(), 'th-Thai.json': files()['th.json'] }).some(p => /th-Thai\.json/.test(p) && /suppress/i.test(p)));
  assert.ok(catalogueProblems({ ...files(), 'readme.txt': enc('x') }).some(p => /readme\.txt/.test(p)), 'a file that is not <tag>.json');
});

test('(d) the lang values the build writes are valid BCP 47: every region of a template and every lang attribute of a rendered page', () => {
  for (const [group, src] of Object.entries(TEMPLATES)) for (const s of slotsOf(src).filter(x => x.kind === 'lang')) assert.equal(bcp47Problem(s.lang), null, group + ' ' + s.lang);
  assert.ok(templateProblems('{{lang th_TH}}\n<p>{{home.origin}}</p>\n{{/lang}}\n', 'home').some(p => /th_TH/.test(p) && /not a valid/.test(p)));
  const { pages } = renderSitePages({ templates: TEMPLATES, messages: CAT.messages });
  for (const [file, html] of Object.entries(pages)) for (const t of htmlTokens(html, { scripting: false })) if (t.type === 'tag' && t.attrs?.has('lang')) assert.equal(bcp47Problem(t.attrs.get('lang')), null, file + ' lang=' + t.attrs.get('lang'));
});

// ── (e) text hygiene (C-I18N-01, -05, -06) ──────────────────────────────────────────────────────────────────────
test('(e) a U+0E4D U+0E32 pair, a BOM, invalid UTF-8 and a replacement character in the catalogue each fail', () => {
  const bad = String.fromCharCode(0xe4d, 0xe32);
  assert.ok(catalogueProblems(edited('th', o => { o.notfound.title = 'ก' + bad; })).some(p => /notfound\.title/.test(p) && /U\+0E4D U\+0E32/.test(p)), 'the split sara am');
  const joined = String.fromCharCode(0xe33);
  assert.deepEqual(catalogueProblems(edited('th', o => { o.notfound.title = 'ก' + joined; })).filter(p => /U\+0E4D/.test(p)), [], 'the joined U+0E33 is right');
  const text = files()['en.json'];
  assert.ok(catalogueProblems({ ...files(), 'en.json': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), text]) }).some(p => /en\.json/.test(p) && /byte order mark/.test(p)));
  assert.ok(catalogueProblems({ ...files(), 'en.json': Buffer.concat([text.subarray(0, 20), Buffer.from([0xff, 0xfe]), text.subarray(20)]) }).some(p => /en\.json/.test(p) && /not valid UTF-8/.test(p)));
  assert.ok(catalogueProblems(edited('en', o => { o.notfound.title = 'x' + String.fromCharCode(0xfffd); })).some(p => /notfound\.title/.test(p) && /U\+FFFD/.test(p)));
  assert.ok(catalogueProblems(edited('en', o => { o.notfound.title = 'x' + String.fromCharCode(0xfeff); })).some(p => /notfound\.title/.test(p) && /U\+FEFF/.test(p)));
  assert.ok(catalogueProblems(edited('en', o => { o.notfound.title = 'x' + String.fromCharCode(7); })).some(p => /notfound\.title/.test(p) && /control/.test(p)));
});

test('(e) the real catalogue files are UTF-8 without a BOM and use LF, and no source calls the compatibility normalisation forms', () => {
  for (const [name, b] of Object.entries(files())) {
    assert.notDeepEqual([...b.subarray(0, 3)], [0xef, 0xbb, 0xbf], name + ' has no BOM');
    assert.doesNotThrow(() => new TextDecoder('utf-8', { fatal: true }).decode(b), name);
    assert.ok(!b.includes(13), name + ' uses LF');
  }
  const forms = ['NFK' + 'C', 'NFK' + 'D'];
  const sources = [];
  const walk = d => { for (const e of readdirSync(join(ROOT, d), { withFileTypes: true })) { const p = d + '/' + e.name; if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); } else if (/\.(mjs|js)$/.test(e.name)) sources.push(p); } };
  walk('scripts'); walk('web-src');
  for (const f of sources) {
    if (f === 'scripts/i18n-catalogue.test.mjs') continue;
    const text = read(f);
    for (const form of forms) assert.ok(!new RegExp(`normalize\\(\\s*['"\`]${form}['"\`]`).test(text), `${f} normalises to ${form}`);
  }
});

// ── (f) concatenation of keys in a template (C-I18N-16) ─────────────────────────────────────────────────────────
test('(f) a template that joins catalogue keys fails: two slots in one text node, two in one attribute, a slot beside literal text, a key built in a slot', () => {
  const ok = '<html lang="en"><body>\n<p>{{home.origin}}</p>\n<p>{{home.disclosure}}</p>\n</body></html>\n';
  assert.deepEqual(templateProblems(ok, 'home'), []);
  for (const [what, src, re] of [
    ['two slots in a text node', ok.replace('<p>{{home.origin}}</p>', '<p>{{home.origin}} {{home.disclosure}}</p>'), /joins 2 catalogue keys in one text/],
    ['two slots with a separator', ok.replace('<p>{{home.origin}}</p>', '<p>{{home.origin}}, {{home.disclosure}}</p>'), /joins|literal/],
    ['two slots in an attribute', ok.replace('<p>', '<p aria-label="{{=home.origin}}{{=home.disclosure}}">'), /joins 2 catalogue keys in one attribute/],
    ['a key built from parts', ok.replace('{{home.origin}}', '{{home.{{x}}}}'), /a slot that is not \{\{key\}\}/],
    ['an expression in a slot', ok.replace('{{home.origin}}', '{{home.origin + x}}'), /a slot that is not \{\{key\}\}/],
    ['an unclosed slot', ok.replace('{{home.origin}}', '{{home.origin'), /a slot that is not \{\{key\}\}/],
  ]) assert.ok(templateProblems(src, 'home').some(p => re.test(p)), what + ': ' + JSON.stringify(templateProblems(src, 'home')));
  // two slots in different elements are not a join, and nor are the same key used twice
  assert.deepEqual(templateProblems('<html lang="en"><body>\n<p>{{home.origin}}</p><p>{{home.origin}}</p>\n</body></html>\n', 'home'), []);
});

test('(f) a template reads its own page group and the shared one only, and a missing or unused key is named', () => {
  const m = CAT.messages;
  const t = { ...TEMPLATES, home: TEMPLATES.home.replace('{{home.origin}}', '{{pricing.title}}') };
  assert.ok(usageProblems({ templates: t, messages: m, codeKeys: usedKeysOfShared() }).some(p => /home/.test(p) && /pricing\.title/.test(p) && /own group/.test(p)));
  const missing = { ...TEMPLATES, home: TEMPLATES.home.replace('{{home.origin}}', '{{home.nope}}') };
  assert.ok(usageProblems({ templates: missing, messages: m, codeKeys: usedKeysOfShared() }).some(p => /home\.nope/.test(p) && /en\.json/.test(p) && /th\.json/.test(p)));
  const unused = { ...TEMPLATES, home: TEMPLATES.home.split('{{home.origin}}').join('{{home.disclosure}}') };
  assert.ok(usageProblems({ templates: unused, messages: m, codeKeys: usedKeysOfShared() }).some(p => /home\.origin/.test(p) && /used by no template/.test(p)));
  const region = { ...TEMPLATES, home: TEMPLATES.home.replace('{{lang th}}', '{{lang fr}}') };
  assert.ok(usageProblems({ templates: region, messages: m, codeKeys: usedKeysOfShared() }).some(p => /fr/.test(p) && /no catalogue/.test(p)));
});

// ── (g) the non-breaking space before the Thai repetition mark (W-I18N-12) ───────────────────────────────────────
test('(g) a plain space before the Thai repetition mark fails; a no-break space passes; the shipped Thai text carries the no-break space', () => {
  const plain = ' ' + AFTER_MATH;
  assert.ok(catalogueProblems(edited('th', o => { o.pricing.soon = 'เร็ว' + plain + ' นี้'; })).some(p => /pricing\.soon/.test(p) && /no-break space/.test(p)), 'a plain space');
  assert.deepEqual(catalogueProblems(edited('th', o => { o.pricing.soon = 'เร็ว' + NBSP + AFTER_MATH + ' นี้'; })), [], 'a no-break space');
  assert.equal(CAT.messages.th['pricing.soon'], 'เร็ว' + NBSP + AFTER_MATH + ' นี้');
  for (const [k, v] of Object.entries(CAT.messages.th)) assert.ok(!v.includes(plain), k + ' has a plain space before the repetition mark');
});

// ── the shared blocks come from the catalogue too ────────────────────────────────────────────────────────────────
test('the header, the footers and the page note read the shared group, so one edit of the catalogue reaches every page that carries them', () => {
  const o = structuredClone(CAT.messages);
  o.en['shared.header.pricing'] = 'Plans!';
  o.th['shared.footer.terms'] = 'ข้อกำหนด!';
  withCatalogue(o, () => {
    assert.ok(siteHeaderHtml().includes('<a href="/pricing">Plans!</a>'));
    assert.ok(siteFooterHtml('th').includes('<a href="/terms">ข้อกำหนด!</a>'));
  });
  assert.ok(siteHeaderHtml().includes('<a href="/pricing">Pricing</a>'), 'and the override ends with the call');
  const used = usedKeysOfShared();
  assert.ok(used.has('shared.brand') && used.has('shared.footer.terms') && used.has('shared.page.note'));
  assert.ok([...used].every(k => k.startsWith('shared.')), 'the shared blocks read only the shared group');
});

test('the render is a pure function of the templates, the catalogue and the shared blocks: the same inputs give the same pages', () => {
  const a = renderSitePages({ templates: TEMPLATES, messages: CAT.messages }).pages;
  const b = renderSitePages({ templates: TEMPLATES, messages: structuredClone(CAT.messages) }).pages;
  assert.deepEqual(a, b);
  assert.ok(renderTemplate('{{lang th}}\n<p>{{home.origin}}</p>\n{{/lang}}\n<p>{{home.origin}}</p>\n', { messages: CAT.messages, blocks: {}, raw: {} }).includes('<p>สร้างในประเทศไทย</p>\n<p>Made in Thailand'), 'a region sets the language of its slots, and outside one the default (en) applies');
});

// ── the CLI, against a throwaway copy of the tree ────────────────────────────────────────────────────────────────
const TREE = ['scripts/legal-pages.mjs', 'scripts/lib/legal-render.mjs', 'scripts/lib/layout-tokens.mjs', 'scripts/lib/legal-page-text.mjs', 'scripts/lib/legal-state.mjs', 'scripts/lib/legal-holds.json', 'scripts/lib/headers-file.mjs', 'scripts/lib/page-sync.mjs', 'scripts/lib/csp-hashes.mjs', 'scripts/lib/page-claims.mjs',
  'scripts/lib/i18n-catalogue.mjs', 'scripts/lib/page-template.mjs', 'scripts/lib/html-tokens.mjs', 'scripts/lib/rendered-text.mjs', 'scripts/lib/web-files.mjs', 'scripts/lib/html-entities.json', 'TERMS.md', 'PRIVACY.md', 'legal/thai-7day-clause.md', 'legal/legal-state.json', 'legal/controller.json', 'scripts/lib/controller-slot.mjs', 'CHANGELOG.md', 'web/_headers',
  'web/terms.html', 'web/privacy.html', 'web/refund.html', 'web/changelog.html', 'web/index.html', 'web/pricing.html', 'web/404.html', 'web/status.html', 'web/band-404.svg', 'web/band-home.svg', 'web-src/i18n/en.json', 'web-src/i18n/th.json', ...SITE_PAGES.map(p => p.template)];
function copyTree() {
  const dir = mkdtempSync(join(tmpdir(), 'i18n-catalogue-'));
  for (const f of TREE) { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), readFileSync(join(ROOT, f))); }
  return dir;
}
const childEnv = dir => { const home = join(dir, '.sandbox-home'); mkdirSync(home, { recursive: true }); return { ...process.env, HOME: home, USERPROFILE: home, TEMP: home, TMP: home, TMPDIR: home, XDG_CONFIG_HOME: home }; };
const run = (dir, ...args) => spawnSync(process.execPath, ['--max-old-space-size=2048', join(dir, 'scripts/legal-pages.mjs'), ...(args.length ? args : ['--check'])], { encoding: 'utf8', timeout: 60000, cwd: dir, env: childEnv(dir) });
const edit = (dir, f, fn) => writeFileSync(join(dir, f), fn(readFileSync(join(dir, f), 'utf8')));

test('the CLI: --check passes on the committed tree; a hand edit of a generated page fails it naming the page; --write restores the page byte for byte', () => {
  const dir = copyTree();
  try {
    const r = run(dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /8 pages match/);
    for (const f of ['web/index.html', 'web/pricing.html', 'web/404.html', 'web/status.html']) {
      const before = readFileSync(join(dir, f), 'utf8');
      edit(dir, f, s => s.replace('</main>', '<p>hand edit</p></main>'));
      const bad = run(dir);
      assert.equal(bad.status, 1, f + '\n' + bad.stdout + bad.stderr);
      assert.ok(bad.stdout.includes(`FAIL ${f} differs from the render of its sources`), f + '\n' + bad.stdout);
      assert.equal(run(dir, '--write').status, 0);
      assert.equal(readFileSync(join(dir, f), 'utf8'), before, f + ' restored');
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the CLI: a catalogue value that changes makes --check fail on the page it reaches, and --write carries it to the page and to the CSP hashes when a style moved', () => {
  const dir = copyTree();
  try {
    edit(dir, 'web-src/i18n/en.json', s => s.replace('Nothing here can be bought yet.', 'Nothing here can be bought today.'));
    const r = run(dir);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /FAIL web\/pricing\.html differs from the render of its sources/);
    assert.equal(run(dir, '--write').status, 0);
    assert.ok(readFileSync(join(dir, 'web/pricing.html'), 'utf8').includes('Nothing here can be bought today.'));
    assert.equal(run(dir).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the CLI: a catalogue or template problem fails --check and stops --write before any page is written', () => {
  for (const [what, fn, re] of [
    ['a missing Thai key', dir => edit(dir, 'web-src/i18n/th.json', s => { const o = JSON.parse(s); delete o.notfound.title; return JSON.stringify(o, null, 2); }), /notfound\.title.*th\.json|th\.json.*notfound\.title/],
    ['a literal in a template', dir => edit(dir, 'web-src/pages/notfound.html', s => s.replace('{{notfound.title}}', 'This page does not exist.')), /literal text "This page does not exist\."/],
    ['a key no template reads', dir => edit(dir, 'web-src/pages/notfound.html', s => s.split('{{notfound.home}}').join('')), /notfound\.home is used by no template/],
    ['a BOM', dir => edit(dir, 'web-src/i18n/en.json', s => String.fromCharCode(0xfeff) + s), /byte order mark/],
    ['a bad file name', dir => { writeFileSync(join(dir, 'web-src/i18n/th_TH.json'), readFileSync(join(dir, 'web-src/i18n/th.json'))); }, /th_TH\.json.*not a valid/],
  ]) {
    const dir = copyTree();
    try {
      fn(dir);
      const before = readFileSync(join(dir, 'web/404.html'), 'utf8');
      const c = run(dir);
      assert.equal(c.status, 1, what + '\n' + c.stdout + c.stderr);
      assert.match(c.stdout + c.stderr, re, what);
      const w = run(dir, '--write');
      assert.equal(w.status, 1, what + ' --write');
      assert.equal(readFileSync(join(dir, 'web/404.html'), 'utf8'), before, what + ': nothing written');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('the CLI: a third language file is checked and renders no page', () => {
  const dir = copyTree();
  try {
    const before = readdirSync(join(dir, 'web')).sort();
    writeFileSync(join(dir, 'web-src/i18n/fr.json'), readFileSync(join(dir, 'web-src/i18n/en.json')));
    const c = run(dir);
    assert.equal(c.status, 0, c.stdout + c.stderr);
    assert.match(c.stdout, /en\.json, fr\.json, th\.json/, 'the file is read with the others');
    assert.equal(run(dir, '--write').status, 0);
    assert.deepEqual(readdirSync(join(dir, 'web')).sort(), before, 'and no page appears for it');
    writeFileSync(join(dir, 'web-src/i18n/fr.json'), '{"home": {}}');
    const bad = run(dir);
    assert.equal(bad.status, 1, 'a third file is held to the same checks (here: its keys are missing)');
    assert.match(bad.stdout, /fr\.json: key .* is missing/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the CLI: a catalogue the code cannot read is reported as the catalogue, never as a module that could not be loaded or a stack trace', () => {
  for (const [what, fn, re] of [
    ['a key the shared blocks need, missing from both languages', dir => { for (const l of ['en', 'th']) edit(dir, `web-src/i18n/${l}.json`, s => { const o = JSON.parse(s); delete o.shared.footer.note; return JSON.stringify(o, null, 2); }); }, /FAIL the legal pages could not be rendered: .*shared\.footer\.note/],
    ['an en.json that is not JSON', dir => writeFileSync(join(dir, 'web-src/i18n/en.json'), '{'), /FAIL catalogue en\.json: is not valid JSON/],
  ]) {
    const dir = copyTree();
    try {
      fn(dir);
      const c = run(dir);
      assert.equal(c.status, 1, what + '\n' + c.stdout + c.stderr);
      assert.match(c.stdout + c.stderr, re, what);
      assert.doesNotMatch(c.stdout + c.stderr, /could not be loaded|\n\s+at /, what + ': no wrong file blamed, no stack trace');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

// ── the JSON slot cannot leave its block (CodeRabbit 4306866360) ────────────────────────────────────
test('a {{j:}} slot writes < > & U+2028 and U+2029 as \\u escapes, so a catalogue value cannot close the structured-data block, and the text decodes to the same', () => {
  const BS = String.fromCharCode(92), LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
  const nasty = 'a</script><p id=inj>x</p><script>b & c ' + LS + PS + ' "q" ' + BS + ' end';
  const j = valueJson(nasty);
  for (const raw of ['<', '>', '&', LS, PS]) assert.ok(!j.includes(raw), JSON.stringify(raw) + ' is written as an escape');
  for (const hex of ['003c', '003e', '0026', '2028', '2029']) assert.ok(j.includes(BS + 'u' + hex), hex);
  assert.equal(JSON.parse('"' + j + '"'), nasty, 'and it decodes to the same text');
  const planted = structuredClone(CAT.messages);
  planted.en['home.ld.description'] = nasty;
  const html = renderSitePages({ templates: TEMPLATES, messages: planted }).pages['web/index.html'];
  assert.ok(!html.includes('<p id=inj>'), 'no tag of the value reached the page');
  const tokens = htmlTokens(html, { scripting: false });
  const ld = tokens.find(t => t.type === 'raw' && t.name === 'script' && t.body.includes('"@type"'));
  assert.ok(ld, 'the structured-data block is whole');
  assert.equal(JSON.parse(ld.body).description, nasty, 'and holds the value');
  assert.equal(tokens.filter(t => t.type === 'tag' && t.name === 'script' && !t.closing).length, 2, 'two script elements: the data and the page script');
});

// ── the literal lint reads every channel a visitor sees or hears ───────────────────────────────────
test('(b) the literal lint reads the value of a button input, the label of an option or track, the ARIA role description, value text and placeholder, the app-name metas, a CSS content string, an inline script or handler, and a JSON-LD @value', () => {
  const base = '<!DOCTYPE html>\n<html lang="en"><head><title>{{home.meta.title}}</title></head><body>\n<p>{{home.origin}}</p>\n</body></html>\n';
  assert.deepEqual(templateProblems(base, 'home'), []);
  const into = (where, text) => base.replace(where, text);
  const ld = text => into('</head>', `<script type="application/ld+json">${text}</script></head>`);
  const planted = [
    ['the value of a submit input', into('<p>', '<input type="submit" value="Send"><p>'), /value of the button input holds the literal "Send"/],
    ['the value of a reset input', into('<p>', '<input type=reset value="Clear"><p>'), /value of the button input holds the literal "Clear"/],
    ['the label of an option', into('<p>', '<select><option label="Choose">{{home.origin}}</option></select><p>'), /label of the option holds the literal "Choose"/],
    ['the label of a track', into('<p>', '<video><track label="Subtitles"></video><p>'), /label of the track holds the literal "Subtitles"/],
    ['aria-roledescription', into('<p>', '<div aria-roledescription="slider"></div><p>'), /aria-roledescription holds the literal "slider"/],
    ['aria-valuetext', into('<p>', '<div aria-valuetext="half"></div><p>'), /aria-valuetext holds the literal "half"/],
    ['aria-placeholder', into('<p>', '<div aria-placeholder="type here"></div><p>'), /aria-placeholder holds the literal "type here"/],
    ['the application-name meta', into('</head>', '<meta name="application-name" content="Kolwen app"></head>'), /content of the meta application-name holds the literal "Kolwen app"/],
    ['the apple app title meta', into('</head>', '<meta name="apple-mobile-web-app-title" content="Kolwen"></head>'), /content of the meta apple-mobile-web-app-title holds the literal "Kolwen"/],
    ['a CSS content string in a style block', into('</head>', '<style>a::after{content:"Hello"}</style></head>'), /CSS content string "Hello" in a <style> block/],
    ['a CSS content string in a style attribute', into('<p>', '<p style=\'content:"Hi"\'>'), /CSS content string "Hi" in a style attribute/],
    ['an inline script', into('</head>', '<script>document.title = "x";</script></head>'), /<script> element in a template is executable script/],
    ['an external script', into('</head>', '<script src="/a.js"></script></head>'), /<script> element in a template is executable script/],
    ['a module script', into('</head>', '<script type="module">1</script></head>'), /<script> element in a template is executable script/],
    ['an inline event handler', into('<p>', '<p onclick="go()">'), /inline event handler \(onclick\)/],
    ['a JSON-LD @value', ld('{"@type": "X", "@value": "Plain words"}'), /structured data value "Plain words"/],
    ['a JSON-LD @comment', ld('{"@type": "X", "@comment": "Plain words"}'), /structured data value "Plain words"/],
    // a visitor without script reads the <noscript> body as markup: the lint reads it so too
    ['text in a noscript', into('<p>', '<noscript><p>No script here</p></noscript><p>'), /literal text "No script here"/],
    ['an attribute in a noscript', into('<p>', '<noscript><img alt="No script alt" src="/a.png"></noscript><p>'), /alt holds the literal "No script alt"/],
    ['a CSS content string in a noscript style', into('<p>', '<noscript><style>a::after{content:"Gone"}</style></noscript><p>'), /CSS content string "Gone" in a <style> block/],
    ['a meta in a noscript', into('</head>', '<noscript><meta name="description" content="Plain"></noscript></head>'), /content of the meta description holds the literal "Plain"/],
  ];
  for (const [what, src, re] of planted) assert.ok(templateProblems(src, 'home').some(p => re.test(p)), what + ': ' + JSON.stringify(templateProblems(src, 'home')));
  for (const [what, src] of [
    ['an input whose value is data (a text field has its own test)', into('<p>', '<input type="checkbox" value="m"><input type="hidden" value="x"><p>')],
    ['slots in the new channels', into('<p>', '<input type="submit" value="{{=home.origin}}"><div aria-roledescription="{{=home.origin}}" aria-valuetext="{{=home.origin}}"></div><p>')],
    ['a slot in an option label and an app-name meta', into('</head>', '<meta name="application-name" content="{{=home.meta.description}}"><select><option label="{{=home.origin}}"></option></select></head>')],
    ['CSS without a content string', into('</head>', '<style>a::after{content:""} .x{display:flex;justify-content:center;content:center}</style></head>')],
    ['structured data with the JSON-LD keywords and slots', ld('{"@context": "https://schema.org", "@type": "Organization", "@id": "https://kolwen.com/#o", "name": "{{j:shared.brand}}"}')],
    ['a non-executable script', into('</head>', '<script type="importmap">{}</script></head>')],
  ]) assert.deepEqual(templateProblems(src, 'home'), [], what);
  // the three real templates hold no script of their own: the page script comes in whole
  for (const [group, src] of Object.entries(TEMPLATES)) {
    assert.ok(src.includes('{{raw:script}}') && !src.includes('{{block:site-script}}'), group + ' takes the page script whole');
    assert.ok(!/<script(?![^>]*ld\+json)/i.test(src), group + ' has no other script element');
  }
});

test('(g) any space separator or invisible character other than the no-break space before the Thai repetition mark fails; no space at all is not judged', () => {
  for (const cp of [0x20, 0x202f, 0x2007, 0x2009, 0x3000, 0xad, 0x2060, 0x200b]) {
    const bad = edited('th', o => { o.pricing.soon = 'เร็ว' + String.fromCharCode(cp) + AFTER_MATH + ' นี้'; });
    assert.ok(catalogueProblems(bad).some(p => /pricing\.soon/.test(p) && /before the Thai repetition mark/.test(p)), 'U+' + cp.toString(16));
  }
  assert.deepEqual(catalogueProblems(edited('th', o => { o.pricing.soon = 'เร็ว' + AFTER_MATH + ' นี้'; })), [], 'the mark joined to its word');
});

// ── the pages are rendered from the catalogue the caller supplies (CodeRabbit 4306966428) ──────────────────
test('(b) the shared blocks (the header, the footers, the page note) are rendered from the catalogue the caller supplies, not from the loaded one', () => {
  const o = structuredClone(CAT.messages);
  o.en['shared.header.pricing'] = 'Prices, supplied';
  o.th['shared.header.pricing'] = 'ราคา ที่ส่งมา';
  o.en['shared.footer.note'] = 'A footer note, supplied.';
  const { pages, problems } = renderSitePages({ templates: TEMPLATES, messages: o });
  assert.deepEqual(problems, []);
  for (const [file, html] of Object.entries(pages)) {
    assert.ok(html.includes('<a href="/pricing">Prices, supplied</a>') && html.includes('<a href="/pricing">ราคา ที่ส่งมา</a>'), file + ': the header reads the supplied values');
    assert.ok(html.includes('A footer note, supplied.'), file + ': the footer reads the supplied value');
    const header = html.split('<header class="site-header">')[1].split('</header>')[0];
    assert.ok(!header.includes('>Pricing</a>'), file + ': no value of the loaded catalogue is left in the header');
  }
  // the supplied catalogue is in force for that call only
  const again = renderSitePages({ templates: TEMPLATES, messages: CAT.messages });
  assert.deepEqual(again.problems, [], 'the second render has no problem');
  assert.deepEqual(Object.keys(again.pages).sort(), SITE_PAGES.map(p => p.file).sort(), 'the second render produced every site page: with none, the loop below would run zero times and could not go red');
  for (const [file, html] of Object.entries(again.pages)) assert.equal(html, read(file), file + ' is the committed page again');
});

// ── each slot kind has its own place (CodeRabbit 4306966429) ───────────────────────────────────────────────
test('(b) a {{j:}} slot is read only inside structured data, and an attribute or a text slot is refused there; a text slot is refused in an attribute', () => {
  const base = '<!DOCTYPE html>\n<html lang="en"><head><title>{{home.meta.title}}</title></head><body>\n';
  const ok = base + '<p>{{home.origin}}</p>\n</body></html>\n';
  assert.deepEqual(templateProblems(ok, 'home'), []);
  const into = (where, text) => ok.replace(where, text);
  const ld = body => into('</head>', `<script type="application/ld+json">${body}</script></head>`);
  const planted = [
    ['a json slot in a visible attribute', into('<p>', '<p title="{{j:home.origin}}">'), /attribute title reads a \{\{j:key\}\} slot; an attribute reads \{\{=key\}\}/],
    ['a json slot in an href', into('<p>', '<a href="{{j:home.origin}}">{{home.origin}}</a><p>'), /attribute href reads a \{\{j:key\}\} slot/],
    ['a json slot in a data attribute', into('<p>', '<p data-x="{{j:home.origin}}">'), /attribute data-x reads a \{\{j:key\}\} slot/],
    ['a json slot in a meta content', into('</head>', '<meta name="description" content="{{j:home.meta.description}}"></head>'), /attribute content reads a \{\{j:key\}\} slot/],
    ['a text slot in an href', into('<p>', '<a href="{{home.origin}}">{{home.origin}}</a><p>'), /attribute href reads a text slot; an attribute reads \{\{=key\}\}/],
    ['a slot in an attribute name', into('<p>', '<p {{=home.origin}}="x">'), /attribute name that holds a slot/],
    ['a json slot in a text node', into('<p>{{home.origin}}</p>', '<p>{{j:home.origin}}</p>'), /a text node reads a \{\{j:key\}\} slot; a text node reads \{\{key\}\}/],
    ['a json slot in a style block', into('</head>', '<style>a{margin:{{j:home.origin}}}</style></head>'), /a <style> block holds a catalogue slot; only structured data takes one/],
    ['an attribute slot in a style block', into('</head>', '<style>a{margin:{{=home.origin}}}</style></head>'), /a <style> block holds a catalogue slot/],
    ['a json slot in a non-ld data block', into('</head>', '<script type="application/json">{"a": "{{j:home.origin}}"}</script></head>'), /<script type="application\/json"> block holds a catalogue slot; only structured data takes one/],
    ['an attribute slot in structured data', ld('{"@type": "Organization", "name": "{{=shared.brand}}"}'), /structured data reads an attribute slot; a JSON string reads \{\{j:key\}\}/],
    ['a text slot in structured data', ld('{"@type": "Organization", "name": "{{shared.brand}}"}'), /structured data reads a text slot; a JSON string reads \{\{j:key\}\}/],
    ['a block slot in structured data', ld('{"@type": "Organization", "name": "{{block:site-header}}"}'), /structured data reads a block or raw slot/],
    // the follow-ups promised on PR #52 (CodeRabbit 4307106771 and 4307106775)
    ['a block slot inside a paragraph', into('<p>{{home.origin}}</p>', '<p>{{block:site-header}}</p>'), /line 3: a \{\{block:\}\} or \{\{raw:\}\} slot must stand alone on its line/],
    ['a block slot beside markup on its line', into('<p>{{home.origin}}</p>', '{{block:site-header}}<p>{{home.origin}}</p>'), /a \{\{block:\}\} or \{\{raw:\}\} slot must stand alone on its line/],
    ['a raw slot beside another slot', into('<p>{{home.origin}}</p>', '{{raw:script}}{{block:site-header}}'), /a \{\{block:\}\} or \{\{raw:\}\} slot must stand alone on its line/],
    ['a raw slot inside an element that is not a style element', into('<p>{{home.origin}}</p>', '<div>{{raw:script}}</div>'), /a \{\{block:\}\} or \{\{raw:\}\} slot must stand alone on its line/],
    ['an attribute slot in a text node', into('<p>{{home.origin}}</p>', '<p>{{=home.origin}}</p>'), /a text node reads an \{\{=key\}\} slot; a text node reads \{\{key\}\}/],
    // the diagnostic names what to do: structured data does NOT take an attribute slot (it reads {{j:key}}), so it must not be named as the place for one (CodeRabbit 4309062054)
    ['an attribute slot in a style attribute', into('<p>', '<p style="margin:{{=home.origin}}">'), /attribute style holds an attribute slot; a catalogue value is not written into inline CSS: remove the slot, or put the CSS the build owns in a <style> block as a \{\{block:\}\} or \{\{raw:\}\} slot/],
    // a block or raw slot is structure: inside a parsed attribute value it is text of the attribute, however many lines the value spans (CodeRabbit 4309062053)
    ['a raw slot inside a multiline attribute', into('<p>{{home.origin}}</p>', '<div title="\n{{raw:script}}\n">{{home.origin}}</div>'), /attribute title holds a block or raw slot/],
    ['a block slot inside a multiline attribute', into('<p>{{home.origin}}</p>', '<div data-x=\'\n{{block:site-header}}\n\'>{{home.origin}}</div>'), /attribute data-x holds a block or raw slot/],
    ['a block slot inside an attribute on one line', into('<p>{{home.origin}}</p>', '<div title="{{block:site-header}}">{{home.origin}}</div>'), /attribute title holds a block or raw slot/],
    ['a block slot inside an unquoted attribute', into('<p>{{home.origin}}</p>', '<div title={{raw:script}}>{{home.origin}}</div>'), /attribute title holds a block or raw slot/],
    ['a block slot inside a title element, alone on its lines', into('<title>{{home.meta.title}}</title>', '<title>\n{{block:site-header}}\n</title>'), /a block or raw slot inside a <title> element/],
    ['a raw slot inside a textarea, alone on its lines', into('<p>{{home.origin}}</p>', '<textarea>\n{{raw:script}}\n</textarea>'), /a block or raw slot inside a <textarea> element/],
    ['a json slot outside a JSON string', ld('{"@type": "Organization", "name": {{j:shared.brand}}}'), /structured data holds a slot outside a JSON string; a slot goes inside the quotes/],
    ['an attribute slot outside a JSON string', ld('{"@type": "Organization", "name": {{=shared.brand}}}'), /structured data holds a slot outside a JSON string/],
    ['a text slot as a bare JSON key', ld('{{{shared.brand}}: "x"}'), /structured data holds a slot outside a JSON string/],
  ];
  for (const [what, src, re] of planted) assert.ok(templateProblems(src, 'home').some(p => re.test(p)), what + ': ' + JSON.stringify(templateProblems(src, 'home')));
  for (const [what, src] of [
    ['a json slot in structured data', ld('{"@type": "Organization", "name": "{{j:shared.brand}}", "description": "{{j:home.ld.description}}"}')],
    ['an attribute slot in a visible and in a plain attribute', into('<p>', '<p title="{{=home.origin}}" data-x="{{=home.origin}}">')],
    ['a text slot in a text node', ok],
    ['a block slot in a style block (the shared stylesheet pieces the real templates use)', into('</head>', '<style>\n{{block:site-header-css}}\n</style></head>')],
    ['a raw slot that is the whole body of a style element on one line (the pricing page)', into('<p>{{home.origin}}</p>', '<style>{{raw:style}}</style>\n<p>{{home.origin}}</p>')],
    ['a block slot and a raw slot, each alone on its line, with a colon in the name', into('</body>', '{{block:site-footer:en}}\n  {{raw:script}}\n</body>')],
    ['a slot inside a JSON string beside a bare number and a literal', ld('{"@type": "Organization", "name": "{{j:shared.brand}}", "n": 3, "ok": true}')],
    ['a block slot alone on its line AFTER the title element has closed (the title is not still open)', into('</head>', '</head>\n{{block:site-header}}\n')],
    ['an attribute slot in a multiline tag, and a block slot on the lines after the tag', into('<p>{{home.origin}}</p>', '<div title="{{=home.origin}}"\n     data-x="1">\n{{block:site-header}}\n</div>')],
  ]) assert.deepEqual(templateProblems(src, 'home'), [], what);
});

// ── the channels the catalogue lint reads ───────────────────────────────────────────────────────────────────
test('(b) the literal lint reads the value of a text field, an ld+json block whatever the case of its type, and a javascript: URL', () => {
  const base = '<!DOCTYPE html>\n<html lang="en"><head><title>{{home.meta.title}}</title></head><body>\n<p>{{home.origin}}</p>\n</body></html>\n';
  const into = (where, text) => base.replace(where, text);
  const TAB = String.fromCharCode(9), NL = String.fromCharCode(10);
  const planted = [
    ['a text field with a type', into('<p>', '<input type="text" value="Literal shown"><p>'), /value of the text field holds the literal "Literal shown"/],
    ['a text field with no type', into('<p>', '<input value="Literal shown"><p>'), /value of the text field holds the literal "Literal shown"/],
    ['an email field in capitals', into('<p>', '<input type="EMAIL" value="a@b.c"><p>'), /value of the text field holds the literal "a@b\.c"/],
    ['a field of a type no browser knows (it is a text field)', into('<p>', '<input type="nonsense" value="Literal shown"><p>'), /value of the text field holds the literal/],
    ['an ld+json block with a capitalised type', into('</head>', '<script type="Application/LD+JSON">{"description": "Literal words"}</script></head>'), /structured data value "Literal words" is a literal/],
    ['an ld+json block with spaces around its type', into('</head>', '<script type=" application/ld+json ">{"description": "Literal words"}</script></head>'), /structured data value "Literal words" is a literal/],
    ['a javascript: href', into('<p>', '<a href="javascript:go()">{{home.origin}}</a><p>'), /attribute href is a javascript: URL; a template holds no script/],
    ['a javascript: href in capitals', into('<p>', '<a href="JavaScript:go()">{{home.origin}}</a><p>'), /javascript: URL/],
    ['a javascript: href with a tab and a leading space', into('<p>', '<a href=" java' + TAB + 'script:go()">{{home.origin}}</a><p>'), /javascript: URL/],
    ['a javascript: href with a line break', into('<p>', '<a href="java' + NL + 'script:go()">{{home.origin}}</a><p>'), /javascript: URL/],
    ['a javascript: form action', into('<p>', '<form action="javascript:go()"></form><p>'), /attribute action is a javascript: URL/],
    ['a javascript: formaction', into('<p>', '<button formaction="javascript:go()">{{home.origin}}</button><p>'), /attribute formaction is a javascript: URL/],
    ['a javascript: src', into('<p>', '<iframe src="javascript:go()"></iframe><p>'), /attribute src is a javascript: URL/],
    // Q-9 / H3: the attribute is read as a browser reads it (character references decoded, as the attribute state decodes them), and the other places that run or draw a document
    ['a javascript: href written with a numeric reference', into('<p>', '<a href="&#106;avascript:go()">{{home.origin}}</a><p>'), /attribute href is a javascript: URL/],
    ['a javascript: href written with a hex reference and a reference for the colon', into('<p>', '<a href="&#x6A;avascript&#58;go()">{{home.origin}}</a><p>'), /attribute href is a javascript: URL/],
    ['a javascript: href with a named colon', into('<p>', '<a href="javascript&colon;go()">{{home.origin}}</a><p>'), /attribute href is a javascript: URL/],
    ['a javascript: href with a named tab and a named line break', into('<p>', '<a href="java&Tab;script&NewLine;:go()">{{home.origin}}</a><p>'), /attribute href is a javascript: URL/],
    ['a javascript: href with a reference for a leading space', into('<p>', '<a href="&#32;&#x9;javascript:go()">{{home.origin}}</a><p>'), /attribute href is a javascript: URL/],
    ['a javascript: object data', into('<p>', '<object data="javascript:go()"></object><p>'), /attribute data is a javascript: URL/],
    ['a javascript: object data written with a reference', into('<p>', '<object data="&#106;avascript:go()"></object><p>'), /attribute data is a javascript: URL/],
    ['an iframe srcdoc', into('<p>', '<iframe srcdoc="&lt;script&gt;go()&lt;/script&gt;"></iframe><p>'), /iframe element has a srcdoc attribute/],
    ['a meta refresh to a javascript: URL', into('<p>', '<meta http-equiv="refresh" content="0;url=javascript:go()"><p>'), /meta refresh .* javascript: URL/],
    ['a meta refresh to a quoted javascript: URL', into('<p>', '<meta http-equiv="Refresh" content="0; URL=\'javascript:go()\'"><p>'), /meta refresh .* javascript: URL/],
    ['a meta refresh to a javascript: URL written with a reference', into('<p>', '<meta http-equiv="refresh" content="0;url=&#106;avascript:go()"><p>'), /meta refresh .* javascript: URL/],
    // CodeRabbit 4309797624, PR #58: the attribute that picks the refresh check is read as a browser reads it too
    ['a meta refresh whose http-equiv is written with a reference', into('<p>', '<meta http-equiv="refre&#115;h" content="0;url=javascript:go()"><p>'), /meta refresh .* javascript: URL/],
    ['a meta refresh whose http-equiv is written with a hex reference in capitals', into('<p>', '<meta http-equiv="&#x52;EFRESH" content="0;url=javascript:go()"><p>'), /meta refresh .* javascript: URL/],
    ['a meta refresh whose http-equiv holds a reference the check cannot read', into('<p>', '<meta http-equiv="refresh&nosuchname;" content="0;url=/pricing"><p>'), /attribute http-equiv holds a character reference the check cannot read/],
    ['an iframe whose source is a data: document', into('<p>', '<iframe src="data:text/html,&lt;script&gt;go()&lt;/script&gt;"></iframe><p>'), /attribute src is a data: URL/],
    ['an object whose data is a data: document', into('<p>', '<object data="DATA:text/html,x"></object><p>'), /attribute data is a data: URL/],
    ['an embed whose source is a data: document', into('<p>', '<embed src="data:text/html,x"><p>'), /attribute src is a data: URL/],
    ['a reference the check cannot read in a URL attribute', into('<p>', '<a href="/a&nosuchname;">{{home.origin}}</a><p>'), /attribute href holds a character reference the check cannot read/],
  ];
  for (const [what, src, re] of planted) assert.ok(templateProblems(src, 'home').some(p => re.test(p)), what + ': ' + JSON.stringify(templateProblems(src, 'home')));
  for (const [what, src] of [
    ['inputs whose value is data, not shown', into('<p>', '<input type="hidden" value="x"><input type="checkbox" value="m"><input type="radio" value="r"><input type="range" value="3"><input type="file" value="f"><input type="color" value="#000000"><p>')],
    ['a button element value', into('<p>', '<button value="go">{{home.origin}}</button><p>')],
    ['an empty text field and a slot', into('<p>', '<input type="text" value=""><input type="text" value="{{=home.origin}}"><p>')],
    ['ordinary links', into('<p>', '<a href="/pricing">{{home.origin}}</a><a href="https://kolwen.com/">{{home.origin}}</a><a href="#javascript:x">{{home.origin}}</a><a href="mailto:info@kolwen.com">{{home.origin}}</a><p>')],
    // the attribute state keeps a legacy name that is followed by = or a letter or digit as text (`&copy=2` is a query, not the copyright sign), and a reference decodes only once
    ['references that are not a javascript: URL', into('<p>', '<a href="/a?x=1&copy=2">{{home.origin}}</a><a href="/a?x=1&amp;y=2">{{home.origin}}</a><a href="#&#106;avascript">{{home.origin}}</a><a href="&amp;#106;avascript:x">{{home.origin}}</a><p>')],
    ['a meta whose http-equiv is not a refresh, written plainly or with a reference', into('<p>', '<meta http-equiv="content-type" content="javascript:x"><meta http-equiv="refre&#115;h" content="5;url=/pricing"><meta http-equiv="x-&#117;a-compatible" content="IE=edge"><p>')],
    ['a meta refresh to a page, a data URL on a link, and an iframe from this site', into('<p>', '<meta http-equiv="refresh" content="5;url=/pricing"><a href="data:text/plain,x">{{home.origin}}</a><iframe src="/embed"></iframe><object data="/x.svg"></object><p>')],
  ]) assert.deepEqual(templateProblems(src, 'home'), [], what);
});

// ── the Thai rule reads U+2800, U+2028 and U+2029 too ─────────────────────────────────────────────────
test('(g) U+2800, U+2028 and U+2029 before the Thai repetition mark fail too', () => {
  for (const cp of [0x2800, 0x2028, 0x2029]) {
    const bad = edited('th', o => { o.pricing.soon = 'เร็ว' + String.fromCharCode(cp) + AFTER_MATH + ' นี้'; });
    assert.ok(catalogueProblems(bad).some(p => /pricing\.soon/.test(p) && /before the Thai repetition mark/.test(p)), 'U+' + cp.toString(16));
  }
});
