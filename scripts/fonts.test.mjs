// Tests for the self-hosted fonts: the manifest web/fonts/fonts.css, the files it names, their licence texts, the allowlist that admits them
// (surface-check rule 7), the recursive list of deployed files (post-deploy-check), and what the pages fetch. Every child has a heap cap and a kill timeout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { facesOf, inRange } from './lib/font-coverage.mjs';
import { reEscape } from './lib/re-escape.mjs';
import { htmlPages } from './lib/web-files.mjs';
import { renderedChars } from './lib/rendered-text.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'web');
const read = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
// Every page of web/, derived (a fixed list stops covering the day a page is added, a /th/ page among them), by the lister the font coverage check uses.
const PAGES = htmlPages(WEB).map(f => 'web/' + f);

const manifest = () => facesOf(read('web/fonts/fonts.css'));
const filesUnder = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)]));
const rel = p => relative(ROOT, p).split(sep).join('/');
// The manifest's own url for a font file (the names carry a hash of the bytes, so a test never writes one).
const urlOf = re => manifest().flatMap(f => f.urls).find(u => re.test(u));
const SANS_400 = () => urlOf(/kw-sans-thai-400\./), MONO_500 = () => urlOf(/kw-mono-500\./);

test('the manifest names every face of the two families, each with font-display swap, a unicode-range and one same-origin woff2 file that exists', () => {
  const faces = manifest();
  assert.ok(faces.length >= 10, 'faces declared: ' + faces.length);
  for (const f of faces) {
    const id = `${f.family} ${f.weight}`;
    assert.equal(f.display, 'swap', id + ': font-display swap');
    assert.ok(f.range && /^U\+/i.test(f.range.trim()), id + ': a unicode-range');
    assert.equal(f.urls.length, 1, id + ': one src url');
    assert.match(f.urls[0], /^\/fonts\/[a-z]+\/[a-z0-9-]+\.[0-9a-f]{10}\.woff2$/, id + ': a same-origin versioned woff2 under /fonts/: ' + f.urls[0]);
    const file = join(WEB, f.urls[0]);
    assert.ok(existsSync(file), id + ': the file exists: ' + f.urls[0]);
    assert.equal(readFileSync(file).subarray(0, 4).toString('latin1'), 'wOF2', id + ': the file is a WOFF2');
  }
  const have = new Set(faces.map(f => `${f.family}|${f.weight}`));
  for (const w of [400, 500, 600, 700]) assert.ok(have.has(`KW Sans Thai|${w}`), 'Sans Thai ' + w);
  for (const w of [400, 500]) assert.ok(have.has(`KW Mono|${w}`), 'Mono ' + w);
  assert.equal(new Set(faces.map(f => f.family)).size, 2, 'two families and no other');
  for (const w of [400, 500, 600, 700]) assert.equal(faces.filter(f => f.family === 'KW Sans Thai' && f.weight === w).length, 2, 'Sans ' + w + ': one declaration for Thai and one for Latin');
});

test('no font file is left out of the manifest, and every font folder carries the full OFL text', () => {
  const named = new Set(manifest().map(f => f.urls[0]));
  const onDisk = filesUnder(join(WEB, 'fonts'));
  for (const file of onDisk.filter(p => p.endsWith('.woff2'))) assert.ok(named.has('/' + relative(WEB, file).split(sep).join('/')), rel(file) + ' is named by the manifest');
  const folders = new Set(onDisk.filter(p => p.endsWith('.woff2')).map(p => dirname(p)));
  assert.deepEqual([...folders].map(p => relative(join(WEB, 'fonts'), p)).sort(), ['mono', 'thai']);
  for (const folder of folders) {
    const ofl = readFileSync(join(folder, 'OFL.txt'), 'utf8');
    assert.match(ofl, /SIL OPEN FONT LICENSE Version 1\.1/, rel(folder) + ': the licence');
    assert.match(ofl, /Reserved Font Name "Plex"/, rel(folder) + ': the copyright line');
    assert.ok(ofl.length > 4000, rel(folder) + ': the full text, not a pointer');
  }
  assert.deepEqual(onDisk.map(rel).filter(p => !p.endsWith('.woff2') && !p.endsWith('OFL.txt')), ['web/fonts/fonts.css'], 'nothing else sits under web/fonts');
});

// Every character a page of `root` draws that no declared Sans range holds (coverageGaps hands such a character to this check). The characters are the derived set of the font checks (entities, CSS content and script strings included), not a second extractor.
const sansMisses = root => {
  const sans = facesOf(readFileSync(join(root, 'web/fonts/fonts.css'), 'utf8')).filter(f => f.family === 'KW Sans Thai').map(f => f.range).join(', ');
  const out = [];
  for (const [cp, pages] of renderedChars(join(root, 'web'))) if (cp > 0x20 && !inRange(cp, sans)) out.push('U+' + cp.toString(16).toUpperCase() + ' ' + [...pages].join(','));
  return out;
};

test('every character the pages show in the sans family is inside a declared Sans range, so no page falls back for a letter the files carry', () => {
  assert.deepEqual(sansMisses(ROOT), []);
});

test('RED PROOF: the Sans-range check sees an out-of-range character written as an entity, as CSS generated content, and as a script string, not only as plain text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sans-range-'));
  try {
    cpSync(WEB, join(dir, 'web'), { recursive: true });
    const f = join(dir, 'web/pricing.html');
    const html = readFileSync(f, 'utf8');
    for (const [what, edit] of [
      ['an entity', h => h.replace('</body>', '<p>&rarr;</p></body>')],
      ['CSS generated content', h => h.replace('</style>', 'p::after{content:"\\2192"}</style>')],
      ['a script string', h => h.replace('</body>', '<script>var a = "\\u2192";</script></body>')],
    ]) {
      writeFileSync(f, edit(html));
      assert.deepEqual(sansMisses(dir), ['U+2192 web/pricing.html'], what);
    }
    writeFileSync(f, html);
    assert.deepEqual(sansMisses(dir), [], 'control: the unedited copy has none');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("RED PROOF: a stray quote in an unquoted attribute value (content=Kolwen's) hides nothing after it from the Sans-range check", () => {
  const dir = mkdtempSync(join(tmpdir(), 'sans-range-'));
  try {
    cpSync(WEB, join(dir, 'web'), { recursive: true });
    const f = join(dir, 'web/index.html');
    const html = readFileSync(f, 'utf8');
    writeFileSync(f, html.replace('<link rel="stylesheet"', "<meta name=x content=Kolwen's><link rel=\"stylesheet\"").replace('</body>', '<p>&#x416;</p></body>'));
    assert.deepEqual(sansMisses(dir), ['U+416 web/index.html']);
    assert.ok(readFileSync(f, 'utf8').includes("content=Kolwen's"), 'the witness edit landed');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the list of deployed files is recursive: a font under web/fonts is listed, _headers and _redirects are not, and the order is the code-unit order', async () => {
  const { servedFiles } = await import(new URL('./lib/web-files.mjs', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'web-files-'));
  try {
    mkdirSync(join(dir, 'fonts/thai'), { recursive: true });
    for (const f of ['index.html', '_headers', '_redirects', 'fonts/fonts.css', 'fonts/thai/OFL.txt', 'fonts/thai/A.woff2', 'robots.txt']) writeFileSync(join(dir, f), 'x');
    assert.deepEqual(servedFiles(dir), ['fonts/fonts.css', 'fonts/thai/A.woff2', 'fonts/thai/OFL.txt', 'index.html', 'robots.txt']);
    writeFileSync(join(dir, 'fonts/_headers'), 'x');
    assert.ok(servedFiles(dir).includes('fonts/_headers'), 'only the two files at the root are not served');
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const real = servedFiles(WEB);
  assert.ok(real.includes('fonts/fonts.css') && real.includes(SANS_400().slice(1)), 'the real tree lists the manifest and a face');
  assert.ok(!real.includes('_headers') && !real.includes('_redirects'));
});

// surface-check reads the tracked files with git, so it runs in a throwaway repository of them.
const childEnv = dir => { const home = join(dir, '.sandbox-home'); mkdirSync(home, { recursive: true }); return { ...process.env, HOME: home, USERPROFILE: home, TEMP: home, TMP: home, TMPDIR: home, XDG_CONFIG_HOME: home }; };
function surfaceCopy() {
  const dir = mkdtempSync(join(tmpdir(), 'surface-fonts-'));
  const env = childEnv(dir);
  const files = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', timeout: 30000 }).stdout.split('\0').filter(Boolean);
  for (const f of files) { if (!existsSync(join(ROOT, f))) continue; mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), readFileSync(join(ROOT, f))); }
  // the font files this unit adds may not be tracked yet when the test runs in a working tree: copy what is on disk under web/fonts too
  for (const f of filesUnder(join(WEB, 'fonts'))) { mkdirSync(dirname(join(dir, rel(f))), { recursive: true }); writeFileSync(join(dir, rel(f)), readFileSync(f)); }
  for (const args of [['init', '-q'], ['add', '-A']]) assert.equal(spawnSync('git', args, { cwd: dir, env, timeout: 60000 }).status, 0, 'git ' + args[0]);
  return dir;
}
const surface = dir => spawnSync(process.execPath, ['--max-old-space-size=2048', join(dir, 'scripts/surface-check.mjs')], { encoding: 'utf8', timeout: 120000, cwd: dir, env: childEnv(dir) });
const track = (dir, f) => spawnSync('git', ['add', '-A'], { cwd: dir, env: childEnv(dir), timeout: 60000 });

test('surface-check admits the font files by name and nothing else: a font outside web/fonts, an extra face, a missing face and a stray file all fail rule 7', () => {
  const dir = surfaceCopy();
  try {
    const ok = surface(dir);
    assert.equal(ok.status, 0, 'the committed tree passes: ' + ok.stdout + ok.stderr);
    const put = (f, text = 'x') => { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), text); track(dir); return surface(dir); };
    const a = put('web/stray.woff2');
    assert.equal(a.status, 1, a.stdout + a.stderr);
    assert.match(a.stdout + a.stderr, /web\/stray\.woff2: is tracked under the publish root but is not a declared shipped asset/);
    rmSync(join(dir, 'web/stray.woff2'));
    const b = put('web/fonts/thai/Extra.woff2');
    assert.match(b.stdout + b.stderr, /web\/fonts\/thai\/Extra\.woff2: is tracked under the publish root but is not a declared shipped asset/);
    rmSync(join(dir, 'web/fonts/thai/Extra.woff2'));
    const c = put('web/fonts/other/OFL.txt');
    assert.match(c.stdout + c.stderr, /web\/fonts\/other\/OFL\.txt: is tracked under the publish root but is not a declared shipped asset/);
    rmSync(join(dir, 'web/fonts/other'), { recursive: true });
    rmSync(join(dir, 'web' + MONO_500()));
    track(dir);
    const d = surface(dir);
    assert.equal(d.status, 1, d.stdout + d.stderr);
    assert.match(d.stdout + d.stderr, new RegExp(reEscape('web' + MONO_500()) + ': is declared a shipped asset but is missing from the publish root'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── what the pages fetch: the manifest, and nothing from outside the site ───────────────────────────────────────────────────────
// The text of every inline <style> block of a page.
const css = html => (html.match(/<style>[\s\S]*?<\/style>/g) || []).join('\n');
const linkTags = html => [...html.matchAll(/<link\b[^>]*>/gi)].map(m => m[0]);
const attr = (tag, name) => (new RegExp('\\b' + name + '\\s*=\\s*"([^"]*)"', 'i').exec(tag) || [])[1];
const cspLine = text => /^[ \t]+Content-Security-Policy:[^\r\n]*/m.exec(text)[0];
const directiveOf = (line, name) => { const part = line.replace(/^[^:]*:/, '').split(';').map(d => d.trim()).find(d => d.split(/\s+/)[0] === name); return part ? part.split(/\s+/).slice(1) : null; };

test('every page links the font manifest once and no link fetches anything from outside the site', () => {
  for (const p of PAGES) {
    const html = read(p);
    const head = html.slice(0, html.indexOf('</head>'));
    const manifestLinks = linkTags(head).filter(t => attr(t, 'href') === '/fonts/fonts.css');
    assert.equal(manifestLinks.length, 1, p + ' links the manifest once');
    assert.match(manifestLinks[0], /rel="stylesheet"/, p);
    for (const tag of linkTags(html)) {
      if (/rel="canonical"/i.test(tag)) continue; // a canonical link names the page itself and is never fetched
      assert.ok(!/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(attr(tag, 'href') || ''), p + ' fetches from outside the site: ' + tag);
    }
    assert.ok(!/rel="(?:preconnect|dns-prefetch|preload|prefetch)"/i.test(html) || linkTags(html).filter(t => /rel="(?:preconnect|dns-prefetch)"/i.test(t)).length === 0, p + ' opens no connection to another origin');
    assert.ok(!/@import|url\(\s*['"]?(?:https?:)?\/\//i.test(css(html)), p + ' loads nothing from CSS outside the site');
    assert.ok(!/googleapis|gstatic/i.test(html), p + ' names no Google font host');
    assert.ok(!/fonts are loaded from Google Fonts|ฟอนต์โหลดจาก Google Fonts/.test(html), p + ' does not say the fonts come from Google');
  }
});

test('the CSP admits the site itself for styles and fonts and names no font origin', () => {
  const line = cspLine(read('web/_headers'));
  assert.deepEqual(directiveOf(line, 'font-src'), ["'self'"], 'font-src is exactly self');
  assert.ok(directiveOf(line, 'style-src').includes("'self'"), "style-src names 'self' for the same-origin manifest");
  assert.ok(!/googleapis|gstatic/i.test(line), 'no Google origin in the policy');
  assert.ok(!directiveOf(line, 'style-src').some(t => /^https?:/i.test(t)), 'style-src names no other origin');
  assert.ok(!/googleapis|gstatic/i.test(read('web/_headers').split('\n').filter(l => !l.trim().startsWith('#')).join('\n')), 'no Google host in a non-comment line of _headers');
});

test('surface-check rule 13 judges the font manifest: self in style-src, font-src exactly self, no outside url() in a stylesheet, no url() to a missing or undeclared file', () => {
  const dir = surfaceCopy();
  try {
    const base = surface(dir);
    assert.equal(base.status, 0, 'the committed tree passes: ' + base.stdout + base.stderr);
    const headers = join(dir, 'web/_headers'), real = readFileSync(headers, 'utf8');
    const out = r => r.stdout + r.stderr;
    writeFileSync(headers, real.replace(/font-src 'self'/, "font-src 'self' https://fonts.gstatic.com"));
    const a = surface(dir);
    assert.equal(a.status, 1, out(a));
    assert.match(out(a), /the CSP floor needs font-src 'self', found 'self' https:\/\/fonts\.gstatic\.com/);
    writeFileSync(headers, real.replace(/style-src 'self' /, 'style-src '));
    const b = surface(dir);
    assert.equal(b.status, 1, out(b));
    assert.match(out(b), /the HTML loads a stylesheet from 'self', which style-src does not name/);
    writeFileSync(headers, real);
    const css = join(dir, 'web/fonts/fonts.css'), realCss = readFileSync(css, 'utf8');
    writeFileSync(css, realCss.replace("url('" + SANS_400() + "')", "url('https://fonts.gstatic.com/x.woff2')"));
    const c = surface(dir);
    assert.equal(c.status, 1, out(c));
    assert.match(out(c), /web\/fonts\/fonts\.css: .*https:\/\/fonts\.gstatic\.com\/x\.woff2.*not on this site/);
    writeFileSync(css, realCss.replace("url('" + SANS_400() + "')", "url('/fonts/thai/Nope.woff2')"));
    const d = surface(dir);
    assert.equal(d.status, 1, out(d));
    assert.match(out(d), /web\/fonts\/fonts\.css: .*\/fonts\/thai\/Nope\.woff2.*(does not exist|is not a declared shipped asset)/);
    mkdirSync(join(dir, 'web/fonts/thai'), { recursive: true });
    writeFileSync(join(dir, 'web/fonts/thai/Extra.woff2'), 'wOF2');
    track(dir);
    writeFileSync(css, realCss.replace("url('" + SANS_400() + "')", "url('/fonts/thai/Extra.woff2')"));
    const d2 = surface(dir);
    assert.equal(d2.status, 1, out(d2));
    assert.match(out(d2), /web\/fonts\/fonts\.css: url\(\/fonts\/thai\/Extra\.woff2\) points at web\/fonts\/thai\/Extra\.woff2, which is not a declared shipped asset/);
    rmSync(join(dir, 'web/fonts/thai/Extra.woff2'));
    writeFileSync(css, realCss);
    const page = join(dir, 'web/index.html'), realPage = readFileSync(page, 'utf8');
    writeFileSync(page, realPage.replace('</head>', '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=X"></head>'));
    const e = surface(dir);
    assert.equal(e.status, 1, out(e));
    assert.match(out(e), /the HTML loads a stylesheet from https:\/\/fonts\.googleapis\.com, which style-src does not name/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// OFL-1.1 condition 3: a Modified Version (a subset is one) may not use a Reserved Font Name ("Plex", named in the OFL.txt beside the files) as its primary font name.
test('no font-family in the manifest, a page or the page stylesheet source names the reserved font name "Plex"', () => {
  const sources = [['web/fonts/fonts.css', read('web/fonts/fonts.css')], ['scripts/lib/legal-render.mjs', read('scripts/lib/legal-render.mjs')], ...PAGES.map(p => [p, css(read(p))])];
  for (const [name, text] of sources) {
    // a source that yields no declaration (a <style> tag that gained an attribute, say) would pass unread, so each must be seen to hold at least one
    let scanned = 0;
    for (const m of text.matchAll(/font-family\s*:\s*([^;}]*)/gi)) { scanned++; assert.ok(!/plex/i.test(m[1]), `${name}: font-family names the reserved name: ${m[1]}`); }
    for (const m of text.matchAll(/\bfont\s*:\s*([^;}]*)/gi)) { scanned++; assert.ok(!/plex/i.test(m[1]), `${name}: font shorthand names the reserved name: ${m[1]}`); }
    assert.ok(scanned > 0, `${name}: no font-family or font shorthand was found, so nothing was checked`);
  }
});
