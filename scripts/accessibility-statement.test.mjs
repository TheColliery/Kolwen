// The accessibility statement's claim about the product-status notice is checked against the served pages, in both catalogues: a sentence that
// says the notice is on every page must find it on every served page, and a sentence that says it is on the home page must find it there.
// A sentence that makes neither claim fails too, so a rewrite cannot slip past the check unnamed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(ROOT, f), 'utf8');
// the home page's own notice: English "in development" or "not yet available", Thai "กำลังพัฒนา" or "ยังไม่เปิดให้ใช้งาน"
const NOTICE = /in development|not yet available|กำลังพัฒนา|ยังไม่เปิดให้ใช้งาน/i;
const CLAIMS = {
  en: { every: /every page/i, home: /home page/i },
  th: { every: /ทุกหน้า/, home: /หน้าแรก/ },
};
const SERVED = readdirSync(join(ROOT, 'web')).filter(f => f.endsWith('.html')).sort();

test('the accessibility statement claims the product-status notice only on the pages that carry it: every page, or the home page', () => {
  for (const lang of ['en', 'th']) {
    const what = JSON.parse(read(`web-src/i18n/${lang}.json`)).accessibility.what;
    const c = CLAIMS[lang];
    const every = c.every.test(what), home = c.home.test(what);
    assert.ok(every || home, `${lang}: accessibility.what names neither every page nor the home page, so the notice it claims cannot be checked: "${what}"`);
    if (every) {
      const bare = SERVED.filter(f => !NOTICE.test(read('web/' + f)));
      assert.deepEqual(bare, [], `${lang}: accessibility.what says the notice is on every page, but these served pages do not carry it: "${what}"`);
    } else {
      assert.ok(NOTICE.test(read('web/index.html')), `${lang}: accessibility.what says the notice is on the home page, but web/index.html does not carry it: "${what}"`);
    }
  }
});
