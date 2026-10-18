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
import { catalogueProblems, bcp47Problem, flatten, loadCatalogue, parseValue, withCatalogue, usedKeys, MARKUP } from './lib/i18n-catalogue.mjs';
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
test('the catalogue is one file per language, en and th, whose top-level keys are the page names and one shared group', () => {
  assert.deepEqual(Object.keys(files()), ['en.json', 'th.json']);
  for (const [name, b] of Object.entries(files())) {
    const top = Object.keys(JSON.parse(b.toString('utf8'))).sort();
    assert.deepEqual(top, ['home', 'notfound', 'pricing', 'shared'], name + ': keyed by page (home, pricing, notfound) plus shared, never by domain');
  }
  assert.deepEqual(SITE_PAGES.map(p => p.group), ['home', 'pricing', 'notfound']);
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

test('(a) the three pages are rendered from the templates and the catalogue, and the committed pages are that render, byte for byte', () => {
  const { pages, problems } = renderSitePages({ templates: TEMPLATES, messages: CAT.messages });
  assert.deepEqual(problems, []);
  assert.deepEqual(Object.keys(pages).sort(), ['web/404.html', 'web/index.html', 'web/pricing.html']);
  for (const [file, html] of Object.entries(pages)) assert.equal(html, read(file), file + ' is the render of its template');
});

test('(b) every visible string of the three pages comes from the catalogue: each stretch of text in a value carries a mark, and no visible text or attribute lacks it', () => {
  const MARK = '§';
  // a mark at the end of every stretch of text of a value (the text between its markup tags), so a piece of text the page shows that is not from a value has none
  const mark = v => parseValue(v).map(t => (t.kind === 'text' ? t.text + MARK : `{${t.kind === 'open' ? '#' : '/'}${t.name}}`)).join('');
  const marked = Object.fromEntries(Object.entries(CAT.messages).map(([l, m]) => [l, Object.fromEntries(Object.entries(m).map(([k, v]) => [k, mark(v)]))]));
  withCatalogue(marked, () => {
    const { pages, problems } = renderSitePages({ templates: TEMPLATES, messages: marked });
    assert.deepEqual(problems, []);
    for (const [file, html] of Object.entries(pages)) {
      const stray = [];
      let last = null, ld = false;
      for (const t of htmlTokens(html)) {
        if (t.type === 'tag' && !t.closing) {
          last = t;
          for (const a of ['aria-label', 'title', 'alt', 'placeholder']) if (t.attrs.has(a) && !t.attrs.get(a).includes(MARK)) stray.push(`${t.name} ${a}="${t.attrs.get(a)}"`);
          if (t.name === 'meta' && /^(description|og:title|og:description|twitter:title|twitter:description)$/.test(t.attrs.get('name') ?? t.attrs.get('property') ?? '') && !t.attrs.get('content').includes(MARK)) stray.push(`meta ${t.attrs.get('name') ?? t.attrs.get('property')} content`);
        } else if (t.type === 'text' && t.text.trim() !== '' && !t.text.includes(MARK)) stray.push('text ' + JSON.stringify(t.text.trim().slice(0, 60)));
        else if (t.type === 'raw' && t.name === 'script' && last && last.attrs.get('type') === 'application/ld+json') {
          ld = true;
          for (const m of t.body.matchAll(/"([^"]+)"\s*:\s*"([^"]*)"/g)) if (!/^(@context|@type|url|image|email)$/.test(m[1]) && !m[2].includes(MARK)) stray.push(`ld+json ${m[1]}`);
        }
      }
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
  const fine = ok.replace('</head>', '<script type="application/ld+json">{"@type": "Organization", "name": "{{j:shared.brand}}", "url": "https://kolwen.com", "email": "info@kolwen.com", "sameAs": ["https://github.com/x"]}</script><style>.a{content:"x"}</style></head>');
  assert.deepEqual(templateProblems(fine, 'home'), [], 'urls, an email, a type, css and script bodies are not visible strings');
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
  for (const [file, html] of Object.entries(pages)) for (const t of htmlTokens(html)) if (t.type === 'tag' && t.attrs?.has('lang')) assert.equal(bcp47Problem(t.attrs.get('lang')), null, file + ' lang=' + t.attrs.get('lang'));
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
const TREE = ['scripts/legal-pages.mjs', 'scripts/lib/legal-render.mjs', 'scripts/lib/legal-page-text.mjs', 'scripts/lib/legal-state.mjs', 'scripts/lib/legal-holds.json', 'scripts/lib/headers-file.mjs', 'scripts/lib/page-sync.mjs', 'scripts/lib/csp-hashes.mjs',
  'scripts/lib/i18n-catalogue.mjs', 'scripts/lib/page-template.mjs', 'scripts/lib/html-tokens.mjs', 'TERMS.md', 'PRIVACY.md', 'legal/thai-7day-clause.md', 'legal/legal-state.json', 'CHANGELOG.md', 'web/_headers',
  'web/terms.html', 'web/privacy.html', 'web/refund.html', 'web/changelog.html', 'web/index.html', 'web/pricing.html', 'web/404.html', 'web-src/i18n/en.json', 'web-src/i18n/th.json', ...SITE_PAGES.map(p => p.template)];
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
    assert.match(r.stdout, /7 pages match/);
    for (const f of ['web/index.html', 'web/pricing.html', 'web/404.html']) {
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
    edit(dir, 'web-src/i18n/en.json', s => s.replace('"Comparison"', '"Comparison"')); // no such value: the copy stays as it is
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
