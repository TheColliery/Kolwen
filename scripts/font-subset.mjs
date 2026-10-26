#!/usr/bin/env node
// Cuts the site's font files down to the glyphs the built pages render, and renames the family (web-build rule W-PERF-06).
//
//   node scripts/font-subset.mjs --src <dir> --python <python> [--pythonpath <dir>]     cut every file named by web/fonts/fonts.css
//   node scripts/font-subset.mjs --help                                                 this text
//
// --src is a folder holding IBM's uncut files in the layout this site shipped them in: thai/IBMPlexSansThai-{Regular,Medium,SemiBold,Bold}.woff2 (@ibm/plex-sans-thai@1.1.0)
// and mono/IBMPlexMono-{Regular,Medium}-Latin1.woff2 (@ibm/plex-mono@2.5.0). --python is a Python that can import fontTools and brotli (fontTools 4.66.1 was used); give the
// folder they are installed in as --pythonpath. Nothing is downloaded or installed by this script. The glyph set of each file is derived by lib/font-coverage.mjs from the built
// pages (never listed by hand), so re-run this whenever a page renders a character a file lacks: `node --test scripts/font-coverage.test.mjs` names the character and the face.
//
// What the cut does: keeps the code points derived above, the BASELINE below, and their glyph closure; keeps fontTools' default layout features (ccmp, locl, calt, liga, clig, rlig, rvrn, curs,
// kern, mark, mkmk, dnom, frac, numr, which are everything a browser applies without being asked; the pages' CSS asks for no other, and font-coverage.test.mjs fails if it ever
// does); keeps the hinting; keeps every name record, then renames the family. IBM's OFL-1.1 reserves the name "Plex", and a subset is a Modified Version, which may not use a
// Reserved Font Name as its primary font name (OFL-1.1 condition 3). So name IDs 1, 3, 4, 6, 16 and 17 say "KW Sans Thai" / "KW Mono" (PostScript form KWSansThai / KWMono),
// and the copyright (ID 0), the trademark (7) and the licence (13, 14) records are kept unchanged. OFL.txt stays beside the files.
// Hinting is kept until a render on Windows has been looked at. Dropping it would make the files smaller, but it changes how
// small sizes rasterise, and no Windows render has been checked against a cut without it. The saving is not re-measured here.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { glyphSets, hashOf, inRange, FONT_URL } from './lib/font-coverage.mjs';
import { isMainModule } from './lib/entry-guard.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'web');
const USAGE = 'usage: node scripts/font-subset.mjs --src <dir of IBM uncut files> --python <python with fontTools and brotli> [--pythonpath <dir>]';

// The file a manifest url is cut from, and the family it is renamed to. Keyed by the BASE of the url's file name: a url reads /fonts/<folder>/<base>.<10 hex>.woff2, and the
// ten hex digits are the first ten of the sha256 of the file's bytes, written by this script (UNIT: a font change then has a new url, so the long cache never serves a stale one).
const SANS = { from: ['IBM Plex Sans Thai', 'IBMPlexSansThai'], to: ['KW Sans Thai', 'KWSansThai'] };
const MONO = { from: ['IBM Plex Mono', 'IBMPlexMono'], to: ['KW Mono', 'KWMono'] };
export const SOURCES = {
  'kw-sans-thai-400': { src: 'thai/IBMPlexSansThai-Regular.woff2', ...SANS },
  'kw-sans-thai-500': { src: 'thai/IBMPlexSansThai-Medium.woff2', ...SANS },
  'kw-sans-thai-600': { src: 'thai/IBMPlexSansThai-SemiBold.woff2', ...SANS },
  'kw-sans-thai-700': { src: 'thai/IBMPlexSansThai-Bold.woff2', ...SANS },
  'kw-mono-400': { src: 'mono/IBMPlexMono-Regular-Latin1.woff2', ...MONO },
  'kw-mono-500': { src: 'mono/IBMPlexMono-Medium-Latin1.woff2', ...MONO },
};

// WHAT EVERY FILE KEEPS BEYOND WHAT THE PAGES RENDER TODAY: a re-cut needs a fresh owner-signed download of the uncut files, so one new letter in a CHANGELOG entry must not force one.
// ascii: all printable ASCII, both families. punctuation: the typographic characters the house writes (en and em dash, curly quotes, copyright, middle dot, multiplication sign,
// no-break space). thai: the whole Thai range a file declares (the Sans Thai files only). The cut is this baseline UNION the derived set; the coverage check stays as strict as ever.
export const BASELINE = { ascii: [0x20, 0x7e], punctuation: [0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0xa9, 0xb7, 0xd7, 0xa0], thaiBlock: [0x0e00, 0x0e7f] };

// The sorted code points a file is cut to: its derived set (file.cps, from lib/font-coverage.mjs) plus the baseline. `file.ranges` are the unicode-ranges declared for it.
export function cutSet(file) {
  const set = new Set(file.cps);
  for (let cp = BASELINE.ascii[0]; cp <= BASELINE.ascii[1]; cp++) set.add(cp);
  for (const cp of BASELINE.punctuation) set.add(cp);
  for (let cp = BASELINE.thaiBlock[0]; cp <= BASELINE.thaiBlock[1]; cp++) if (file.ranges.some(r => inRange(cp, r)) && file.ranges.some(r => inRange(0x0e01, r))) set.add(cp);
  return [...set].sort((a, b) => a - b);
}

// One python process per file: subset, rename the family in the name records, write WOFF2. No backslash in it, so it travels as one argument.
const PY = [
  'import sys, json',
  'from fontTools import subset',
  'src, out, spec = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])',
  'opts = subset.Options()',
  "opts.flavor = 'woff2'",
  "opts.name_IDs = ['*']",
  'opts.name_legacy = True',
  "opts.name_languages = ['*']",
  'opts.notdef_outline = True',
  'font = subset.load_font(src, opts)',
  'sub = subset.Subsetter(opts)',
  'sub.populate(unicodes=spec["unicodes"])',
  'sub.subset(font)',
  'name = font["name"]',
  'for rec in list(name.names):',
  '    if rec.nameID in (1, 3, 4, 6, 16, 17):',
  '        text = rec.toUnicode()',
  '        for a, b in zip(spec["from"], spec["to"]):',
  '            text = text.replace(a, b)',
  '        name.setName(text, rec.nameID, rec.platformID, rec.platEncID, rec.langID)',
  'subset.save_font(font, out, opts)',
].join('\n');

function main() {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) { console.log(USAGE); return; }
  const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const unknown = args.filter((a, i) => a.startsWith('-') && !['--src', '--python', '--pythonpath'].includes(a) && !['--src', '--python', '--pythonpath'].includes(args[i - 1]));
  if (unknown.length) { console.error('unknown argument: ' + unknown.join(' ')); console.error(USAGE); process.exitCode = 2; return; }
  const src = opt('--src'), python = opt('--python'), pythonpath = opt('--pythonpath');
  if (!src || !python) { console.error(USAGE); process.exitCode = 2; return; }
  const sets = glyphSets(WEB);
  const tmp = mkdtempSync(join(tmpdir(), 'font-subset-'));
  const env = { ...process.env, ...(pythonpath ? { PYTHONPATH: pythonpath } : {}) };
  let failed = 0;
  const renames = [];
  try {
    for (const file of sets.values()) {
      const m = FONT_URL.exec(file.url);
      const job = m && SOURCES[m[2]];
      if (!job) { console.error('FAIL no source is known for ' + file.url + ' (add its base name to SOURCES)'); failed++; continue; }
      const from = join(src, job.src), staged = join(tmp, m[2] + '.woff2');
      if (!existsSync(from)) { console.error('FAIL missing uncut source ' + from); failed++; continue; }
      const cps = cutSet(file);
      const r = spawnSync(python, ['-c', PY, from, staged, JSON.stringify({ unicodes: cps, from: job.from, to: job.to })], { env, encoding: 'utf8', timeout: 120000, maxBuffer: 1 << 24 });
      if (r.status !== 0) { console.error('FAIL ' + m[2] + ': ' + (r.stderr || r.error || '').toString().trim().split(/\r?\n/).slice(-3).join(' | ')); failed++; continue; }
      const bytes = readFileSync(staged);
      const url = '/fonts/' + m[1] + '/' + m[2] + '.' + hashOf(bytes) + '.woff2', out = join(WEB, url);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, bytes);
      if (url !== file.url) { renames.push([file.url, url]); rmSync(join(WEB, file.url), { force: true }); }
      console.log(`${url}  ${cps.length} code points (${file.cps.length} derived)  ${statSync(from).size} -> ${bytes.length} bytes`);
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  if (renames.length) {
    const cssPath = join(WEB, 'fonts/fonts.css');
    let css = readFileSync(cssPath, 'utf8');
    for (const [oldUrl, newUrl] of renames) css = css.split(oldUrl).join(newUrl);
    writeFileSync(cssPath, css);
    console.log('fonts.css now names the new urls. Name them in scripts/surface-check.mjs (rule 7) too:');
    for (const file of readdirSync(join(WEB, 'fonts'), { recursive: true })) if (String(file).endsWith('.woff2')) console.log("  'web/fonts/" + String(file).split(sep).join('/') + "',");
  }
  if (failed) process.exitCode = 1;
}

if (isMainModule(import.meta.url)) main();
