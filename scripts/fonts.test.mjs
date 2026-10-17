// Tests for the self-hosted fonts: the manifest web/fonts/fonts.css, the files it names, their licence texts, the allowlist that admits them
// (surface-check rule 7), the recursive list of deployed files (post-deploy-check), and what the pages fetch. Every child has a heap cap and a kill timeout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'web');
const read = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const PAGES = ['index', 'pricing', '404', 'terms', 'privacy', 'refund', 'changelog'].map(n => `web/${n}.html`);

// The faces of a manifest: one object per @font-face.
const facesOf = css => [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(m => {
  const b = m[1];
  return { family: (/font-family:\s*'([^']+)'/.exec(b) || [])[1], weight: Number((/font-weight:\s*(\d+)/.exec(b) || [])[1]), display: (/font-display:\s*(\w+)/.exec(b) || [])[1],
    urls: [...b.matchAll(/url\(\s*'?([^')\s]+)'?\s*\)/g)].map(x => x[1]), range: (/unicode-range:\s*([^;]+);/.exec(b) || [])[1] };
});
const manifest = () => facesOf(read('web/fonts/fonts.css'));
const inRange = (cp, range) => range.split(',').some(part => { const [a, b] = part.trim().replace(/^U\+/i, '').split('-'); return cp >= parseInt(a, 16) && cp <= parseInt(b || a, 16); });
const filesUnder = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)]));
const rel = p => relative(ROOT, p).split(sep).join('/');

test('the manifest names every face of the two families, each with font-display swap, a unicode-range and one same-origin woff2 file that exists', () => {
  const faces = manifest();
  assert.ok(faces.length >= 10, 'faces declared: ' + faces.length);
  for (const f of faces) {
    const id = `${f.family} ${f.weight}`;
    assert.equal(f.display, 'swap', id + ': font-display swap');
    assert.ok(f.range && /^U\+/i.test(f.range.trim()), id + ': a unicode-range');
    assert.equal(f.urls.length, 1, id + ': one src url');
    assert.match(f.urls[0], /^\/fonts\/[a-z]+\/[A-Za-z0-9-]+\.woff2$/, id + ': a same-origin woff2 under /fonts/: ' + f.urls[0]);
    const file = join(WEB, f.urls[0]);
    assert.ok(existsSync(file), id + ': the file exists: ' + f.urls[0]);
    assert.equal(readFileSync(file).subarray(0, 4).toString('latin1'), 'wOF2', id + ': the file is a WOFF2');
  }
  const have = new Set(faces.map(f => `${f.family}|${f.weight}`));
  for (const w of [400, 500, 600, 700]) assert.ok(have.has(`IBM Plex Sans Thai|${w}`), 'Plex Sans Thai ' + w);
  for (const w of [400, 500]) assert.ok(have.has(`IBM Plex Mono|${w}`), 'Plex Mono ' + w);
  assert.equal(new Set(faces.map(f => f.family)).size, 2, 'two families and no other');
  for (const w of [400, 500, 600, 700]) assert.equal(faces.filter(f => f.family === 'IBM Plex Sans Thai' && f.weight === w).length, 2, 'Sans ' + w + ': one declaration for Thai and one for Latin');
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

test('every character the pages show in the sans family is inside a declared Sans range, so no page falls back for a letter the files carry', () => {
  const sans = manifest().filter(f => f.family === 'IBM Plex Sans Thai').map(f => f.range).join(', ');
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const missing = new Map();
  for (const p of PAGES) {
    let t = read(p).replace(/<(style|script)\b[\s\S]*?<\/\1\b[^>]*>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]*>/g, ' ');
    t = t.replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d)).replace(/&(\w+);/g, (m, n) => ENT[n] || m);
    for (const ch of t) { const cp = ch.codePointAt(0); if (cp > 0x20 && !inRange(cp, sans)) missing.set(cp, (missing.get(cp) || new Set()).add(p)); }
  }
  assert.deepEqual([...missing].map(([cp, pages]) => 'U+' + cp.toString(16).toUpperCase() + ' ' + [...pages].join(',')), []);
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
  assert.ok(real.includes('fonts/fonts.css') && real.includes('fonts/thai/IBMPlexSansThai-Regular.woff2'), 'the real tree lists the manifest and a face');
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
    rmSync(join(dir, 'web/fonts/mono/IBMPlexMono-Medium-Latin1.woff2'));
    track(dir);
    const d = surface(dir);
    assert.equal(d.status, 1, d.stdout + d.stderr);
    assert.match(d.stdout + d.stderr, /web\/fonts\/mono\/IBMPlexMono-Medium-Latin1\.woff2: is declared a shipped asset but is missing from the publish root/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
