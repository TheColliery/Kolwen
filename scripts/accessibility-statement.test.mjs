// The accessibility statement's claim about the product-status notice is checked against the served pages, in both catalogues. The claim is the
// whole clause that ties the notice to a page: "says so on every page" (English) or "บอกเช่นนี้ในทุกหน้า" (Thai) for every page, and "and the home
// page says so" (English) or "หน้าแรกของเว็บไซต์บอกเช่นนี้" (Thai) for the home page. The notice itself is the unavailability phrase of each language,
// and it is searched only inside that language's own block of the page, so a notice in the English block or the metadata does not satisfy Thai.
// A sentence that makes neither claim fails too, and the served page list must hold index.html and more than one page, so the check never passes vacuously.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { htmlTokens } from './lib/html-tokens.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The notice a visitor can see: each language's notice counts only inside that language's own element, read through its matching closing tag
// (the element's own hidden attribute is the language switch, so it is not counted), and a hidden element inside it hides what it holds.
// Nothing outside the element counts. The claim must carry its unavailability statement before it, in each language.
const NOTICE = { en: /not yet available/i, th: /ยังไม่เปิดให้ใช้งาน/ };
const CLAIM = {
  en: { every: /(not yet available|no product ships yet)[^.]*says so on every page/i, home: /(not yet available|no product ships yet)[^.]*and the home page says so/i },
  th: { every: /ยังไม่มีผลิตภัณฑ์ใดเปิดให้ใช้งาน[^.]*บอกเช่นนี้ในทุกหน้า/, home: /ยังไม่มีผลิตภัณฑ์ใดเปิดให้ใช้งาน[^.]*หน้าแรกของเว็บไซต์บอกเช่นนี้/ },
};
const ID = { en: 'doc-en', th: 'doc-th' };
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
// The visible text of one language element: its own text, through its matching closing tag, and not the text under a hidden element.
// Null when the page has no such element.
function visibleText(html, id) {
  const stack = [];
  let base = -1, text = '';
  for (const t of htmlTokens(html)) {
    if (t.type === 'tag' && !t.closing) {
      if (base < 0) { if (t.attrs.get('id') === id) { base = 0; stack.push({ name: t.name, hidden: false }); } continue; }
      if (!VOID.has(t.name)) stack.push({ name: t.name, hidden: t.attrs.has('hidden') });
    } else if (t.type === 'tag' && t.closing) {
      if (base < 0) continue;
      let i = stack.length - 1;
      while (i >= 0 && stack[i].name !== t.name) i--;
      if (i >= 0) stack.length = i;
      if (stack.length === 0) return text;
    } else if (t.type === 'text' && base >= 0 && !stack.some(e => e.hidden)) {
      text += t.text;
    }
  }
  return base < 0 ? null : text;
}

function problems(root) {
  const read = f => readFileSync(join(root, f), 'utf8');
  const served = readdirSync(join(root, 'web')).filter(f => f.endsWith('.html')).sort();
  const out = [];
  if (!served.includes('index.html') || served.length < 2) {
    out.push(`the served page list holds ${served.length} page(s) (${served.join(', ') || 'none'}); the guard needs index.html and more than one page`);
  }
  for (const lang of ['en', 'th']) {
    const what = JSON.parse(read(`web-src/i18n/${lang}.json`)).accessibility.what;
    const c = CLAIM[lang];
    const every = c.every.test(what), home = c.home.test(what);
    if (!every && !home) {
      out.push(`${lang}: accessibility.what does not tie the notice to a page after its unavailability statement (it must say so on every page, or say the home page says so): "${what}"`);
      continue;
    }
    for (const f of every ? served : ['index.html']) {
      const html = served.includes(f) ? read('web/' + f) : '';
      const seen = visibleText(html, ID[lang]);
      if (seen === null || !NOTICE[lang].test(seen)) {
        out.push(`${lang}: accessibility.what says the notice is on ${every ? 'every page' : 'the home page'}, but web/${f} carries no ${lang} notice in its ${lang} block: "${what}"`);
      }
    }
  }
  return out;
}

test('the real site passes the statement guard, in each language block', () => {
  assert.deepEqual(problems(ROOT), []);
});

// Witnesses: a temporary copy of the site with one planted defect; the guard must refuse it. The real files are never edited.
function withCopy(plant, check) {
  const d = mkdtempSync(join(tmpdir(), 'accessibility-statement-'));
  try {
    cpSync(join(ROOT, 'web'), join(d, 'web'), { recursive: true });
    cpSync(join(ROOT, 'web-src'), join(d, 'web-src'), { recursive: true });
    plant(d);
    check(d);
  } finally { rmSync(d, { recursive: true, force: true }); }
}
const edit = (d, f, fn) => writeFileSync(join(d, f), fn(readFileSync(join(d, f), 'utf8')));

test('witness: a home page whose English block has only the in-development phrase is refused', () => {
  withCopy(d => edit(d, 'web/index.html', s => s.split('not yet available').join('still being built')), d => {
    assert.ok(problems(d).some(p => p.startsWith('en:') && p.includes('web/index.html carries no en notice')), JSON.stringify(problems(d)));
  });
});

test('witness: a sentence that names the home page without tying the notice to it is refused, and the message names it', () => {
  withCopy(d => edit(d, 'web-src/i18n/en.json', s => { const o = JSON.parse(s); o.accessibility.what = 'The home page is the first page we built.'; return JSON.stringify(o, null, 2) + String.fromCharCode(10); }), d => {
    assert.ok(problems(d).some(p => p.startsWith('en:') && p.includes('The home page is the first page we built.')), JSON.stringify(problems(d)));
  });
});

test('witness: a page whose Thai block lacks the notice is refused, though English metadata carries it', () => {
  withCopy(d => edit(d, 'web/index.html', s => s.split('ยังไม่เปิดให้ใช้งาน').join('').split('กำลังพัฒนา').join('')), d => {
    assert.ok(problems(d).some(p => p.startsWith('th:') && p.includes('web/index.html carries no th notice')), JSON.stringify(problems(d)));
  });
});

test('witness: an empty served page list is refused, not passed', () => {
  withCopy(d => { for (const f of readdirSync(join(d, 'web'))) if (f.endsWith('.html')) rmSync(join(d, 'web', f)); }, d => {
    assert.ok(problems(d).some(p => /served page list holds 0 page/.test(p)), JSON.stringify(problems(d)));
  });
});

// K-46: the statement guard reads each language element whole, and only the notice a visitor can see inside it.
test('witness K-46(a): a Thai notice placed after the Thai element, outside it, does not count', () => {
  withCopy(d => edit(d, 'web/index.html', s => s.split('ยังไม่เปิดให้ใช้งาน').join('').split('กำลังพัฒนา').join('').split('</main>').join('<p>ยังไม่เปิดให้ใช้งาน</p></main>')), d => {
    assert.ok(problems(d).some(p => p.startsWith('th:') && p.includes('web/index.html carries no th notice')), JSON.stringify(problems(d)));
  });
});

test('witness K-46(b): a sentence that says the product is available and that the home page says so is refused, in both languages', () => {
  withCopy(d => {
    edit(d, 'web-src/i18n/en.json', s => { const o = JSON.parse(s); o.accessibility.what = 'Kolwen product is available now, and the home page says so.'; return JSON.stringify(o, null, 2) + String.fromCharCode(10); });
    edit(d, 'web-src/i18n/th.json', s => { const o = JSON.parse(s); o.accessibility.what = 'ผลิตภัณฑ์เปิดให้ใช้งานแล้ว และหน้าแรกของเว็บไซต์บอกเช่นนี้'; return JSON.stringify(o, null, 2) + String.fromCharCode(10); });
  }, d => {
    const p = problems(d);
    assert.ok(p.some(x => x.startsWith('en:') && x.includes('available now')) && p.some(x => x.startsWith('th:') && x.includes('เปิดให้ใช้งานแล้ว')), JSON.stringify(p));
  });
});

test('witness K-46(c): a notice inside an element the visitor cannot see (hidden) does not count', () => {
  withCopy(d => edit(d, 'web/index.html', s => s.split('not yet available').join('<span hidden>not yet available</span>')), d => {
    assert.ok(problems(d).some(p => p.startsWith('en:') && p.includes('web/index.html carries no en notice')), JSON.stringify(problems(d)));
  });
});
