// The language catalogue: web-src/i18n/<bcp47>.json, one file per language, the single home of every string the site's own pages show (build-qc.md C-I18N-17).
//
// SHAPE. A file is a JSON object whose top-level keys are the PAGE names (home, pricing, notfound) plus one shared group (the header, the footer, the page note), never a domain: a page that
// moves to another domain keeps its strings (design note R1.3). Keys are lowercase ASCII (letters, digits, hyphens), nested as objects; the flat dot-path (`home.hero.title`) is the key the
// templates and the code read. A value is a whole sentence, never a fragment to be joined: a part of it that needs markup carries MessageFormat 2 markup, `{#hl}verifiable{/hl}`, and the
// names of the markup (MARKUP below) are the one table that turns them into tags. A value with a variable part would carry a named placeholder `{name}`; no value needs one in step 1, so none is
// read yet (the first one is the price data file, design note section 3d), and a brace that is not markup is a problem.
// An EMPTY value says "this language's document has no such element" (the Thai home page has no sub line); it is allowed only where no slot of a template renders it (page-template.mjs).
//
// WHAT THIS FILE CHECKS (catalogueProblems), on the bytes of the files so a planted BOM or bad UTF-8 is seen: the file name is a valid BCP 47 tag (C-I18N-03); UTF-8 with no BOM (C-I18N-01);
// valid JSON with no repeated key; keys and values of the shape above; no U+0E4D U+0E32 pair, no U+FFFD, no U+FEFF, no control character (C-I18N-06); no plain space before the Thai repetition
// mark (W-I18N-12); markup balanced, known and the same in every language; the same key set in every language, both directions (C-I18N-17); and the names that do not translate (the brand, the
// two language names, the product names) equal in every language. Limits, stated: Suppress-Script is checked against the small table below, not the whole IANA registry (a language that is not
// in it is not checked); the Thai text is judged for the two rules above and no other typography.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CATALOGUE_DIR = 'web-src/i18n';
// Characters the checks name, built from their code points so the source holds no invisible text.
const SPLIT_SARA_AM = String.fromCharCode(0xe4d, 0xe32), MAIYAMOK = String.fromCharCode(0xe46), REPLACEMENT = String.fromCharCode(0xfffd), BOM = String.fromCharCode(0xfeff);
export const DEFAULT_LANG = 'en';

// The inline markup a value may carry, by name: the open tag and the close tag. A link in a sentence is one entry (its address is not translated); `th` marks a Thai phrase inside an English
// sentence (WCAG 2.2 SC 3.1.2, a passage in another language carries lang). Adding a name is a code change, so no catalogue file can put a tag of its own on a page.
export const MARKUP = {
  b: ['<b>', '</b>'],
  strong: ['<strong>', '</strong>'],
  small: ['<small>', '</small>'],
  code: ['<code>', '</code>'],
  hl: ['<span class="hl">', '</span>'],
  th: ['<span lang="th">', '</span>'],
  refund: ['<a href="/refund">', '</a>'],
};

// The scripts the IANA language subtag registry suppresses for a language (its Suppress-Script field): a tag that names one is redundant (th-Thai), and RFC 5646 section 4.1 says to leave it out.
// A subset, for the languages the site has or may take next; extend it with the language. Every value was read at www.iana.org/assignments/language-subtag-registry (File-Date 2026-09-17) on 2026-10-18.
const SUPPRESS_SCRIPT = { en: 'Latn', th: 'Thai', fr: 'Latn', de: 'Latn', es: 'Latn', pt: 'Latn', it: 'Latn', nl: 'Latn', id: 'Latn', vi: 'Latn', ja: 'Jpan', ko: 'Kore', ru: 'Cyrl', ar: 'Arab', hi: 'Deva' };

// The values that are the same in every language by design: a name that is not translated, each language written in its own language.
const INVARIANT = [/^shared\.brand$/, /^shared\.switch\./, /^shared\.names\./, /^home\.mark\.reading$/, /^home\.channels\.email$/];

const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escText = s => s.replace(/[&<>"']/g, c => ENT[c]);
export const escAttr = s => s.replace(/[&<>"']/g, c => ENT[c]);

// ── BCP 47 ──────────────────────────────────────────────────────────────────────────────────────
// null when the tag is a valid BCP 47 tag in canonical form with no redundant script, otherwise the reason (C-I18N-03).
export function bcp47Problem(tag) {
  if (typeof tag !== 'string' || tag === '') return 'is empty';
  let canon;
  try { canon = Intl.getCanonicalLocales(tag)[0]; } catch { return 'is not a valid BCP 47 tag'; }
  const parts = tag.split('-');
  if (!/^[a-zA-Z]{2,3}$/.test(parts[0])) return 'is not a valid BCP 47 tag (the language is a two or three letter code)';
  if (canon !== tag) return `is not in canonical case (${canon})`;
  const script = parts.slice(1).find(p => /^[A-Z][a-z]{3}$/.test(p));
  if (script && SUPPRESS_SCRIPT[parts[0]] === script) return `names the script ${script}, which the IANA registry suppresses for ${parts[0]} (write ${parts.filter(p => p !== script).join('-')})`;
  return null;
}

// ── a value: text and markup ────────────────────────────────────────────────────────────────────
// The tokens of a value: { kind: 'text', text } | { kind: 'open', name } | { kind: 'close', name }. Problems are read by valueProblems.
export function parseValue(value) {
  const out = [];
  let at = 0;
  for (const m of value.matchAll(/\{([#/])([a-z][a-z0-9-]*)\}/g)) {
    if (m.index > at) out.push({ kind: 'text', text: value.slice(at, m.index) });
    out.push({ kind: m[1] === '#' ? 'open' : 'close', name: m[2] });
    at = m.index + m[0].length;
  }
  if (at < value.length) out.push({ kind: 'text', text: value.slice(at) });
  return out;
}
function valueProblems(value) {
  const out = [];
  const stack = [];
  for (const t of parseValue(value)) {
    if (t.kind === 'text') { if (/[{}]/.test(t.text)) out.push('has a brace that is not markup (markup is {#name} ... {/name})'); continue; }
    if (!MARKUP[t.name]) { out.push(`has unknown markup ${t.name}`); continue; }
    if (t.kind === 'open') stack.push(t.name);
    else if (stack.pop() !== t.name) out.push(`closes {/${t.name}} where it is not open (unbalanced markup)`);
  }
  for (const n of stack) out.push(`opens {#${n}} that is never closed`);
  return out;
}
// The markup of a value, for the parity check between languages. `th` is left out: it marks a Thai phrase inside a sentence of another language (SC 3.1.2), so only the sentences that quote Thai carry it.
// True when a space or an invisible character other than the no-break space U+00A0 stands right before the Thai repetition mark (a plain space, U+202F, U+2007, U+2060, U+00AD ...). The class is the one
// surface-check rule 4 uses (a space separator, a line or paragraph separator, a default-ignorable code point, and the braille pattern blank U+2800, which draws nothing but is none of those).
// "No space at all" is not judged: whether the mark may follow its word with nothing between is the row's call, not this lint's.
const NBSP = String.fromCharCode(0xa0);
const BRAILLE_BLANK = String.fromCharCode(0x2800);
const invisibleChar = ch => ch === BRAILLE_BLANK || /[\p{Zs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u.test(ch);
function spaceBeforeMaiyamok(v) {
  for (let i = v.indexOf(MAIYAMOK); i >= 0; i = v.indexOf(MAIYAMOK, i + 1)) {
    const prev = v[i - 1];
    if (prev !== undefined && prev !== NBSP && invisibleChar(prev)) return true;
  }
  return false;
}
const markupOf = value => parseValue(value).filter(t => t.kind !== 'text' && t.name !== 'th').map(t => (t.kind === 'open' ? '#' : '/') + t.name).join(' ');
// The value as the HTML a text slot shows: text escaped, markup as its tags.
export function valueHtml(value) {
  return parseValue(value).map(t => (t.kind === 'text' ? escText(t.text) : MARKUP[t.name][t.kind === 'open' ? 0 : 1])).join('');
}
// The value as plain text, for an attribute or a JSON string: markup is not allowed there.
export function valuePlain(value) {
  const tokens = parseValue(value);
  if (tokens.some(t => t.kind !== 'text')) throw new Error(`a value with markup cannot go in an attribute or a data string: ${JSON.stringify(value.slice(0, 60))}`);
  return tokens.map(t => t.text).join('');
}
// The value as the inside of a JSON string in a <script> block. JSON.stringify leaves `<` alone, and a `</script>` in a value would end the block and put the rest on the page as markup, so `<`, `>` and `&` are
// written as \u escapes (the text decodes to the same), and so are U+2028 and U+2029, which a script engine of the older kind reads as line ends. The backslash is built from its code point.
const JSON_UNSAFE = new RegExp('[<>&' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');
export function valueJson(value) {
  return JSON.stringify(valuePlain(value)).slice(1, -1).replace(JSON_UNSAFE, c => String.fromCharCode(92) + 'u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

// ── the files ───────────────────────────────────────────────────────────────────────────────────
// Every string leaf of a catalogue object as { 'home.hero.title': value }. A leaf that is not a string, or a key that is not a key, is left to catalogueProblems.
export function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? prefix + '.' + k : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out); else if (typeof v === 'string') out[key] = v;
  }
  return out;
}

// A repeated key in one object of a JSON text, which JSON.parse hides (the last one wins). One pass over the text with a stack of key sets: returns [{ key, path }].
function repeatedKeys(text) {
  const found = [];
  const stack = []; // one { seen, name, cur } per open object: the keys it has, the key it sits under, the key last read in it
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      const s = text.slice(i + 1, j);
      i = j + 1;
      if (stack.length && /^\s*:/.test(text.slice(i, i + 40))) {
        const top = stack[stack.length - 1];
        if (top.seen.has(s)) found.push({ key: s, path: stack.map(x => x.name).filter(Boolean).join('.') });
        top.seen.add(s);
        top.cur = s;
      }
      continue;
    }
    if (c === '{') stack.push({ seen: new Set(), name: stack.length ? stack[stack.length - 1].cur : '', cur: '' });
    else if (c === '}') stack.pop();
    i++;
  }
  return found;
}

// Everything wrong with a set of catalogue files: { 'en.json': Buffer, ... } in, an array of named problems out (empty when sound).
export function catalogueProblems(files) {
  const problems = [];
  const parsed = {}; // tag -> flat messages
  const names = Object.keys(files).sort();
  if (!names.includes(DEFAULT_LANG + '.json')) problems.push(`${DEFAULT_LANG}.json is missing: the default language has no catalogue`);
  for (const name of names) {
    const m = /^(.+)\.json$/.exec(name);
    if (!m) { problems.push(`${name}: not a catalogue file (a catalogue file is <bcp47>.json)`); continue; }
    const tag = m[1];
    const why = bcp47Problem(tag);
    if (why) { problems.push(`${name}: the file name ${tag} ${why}`); continue; }
    const buf = files[name];
    if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) { problems.push(`${name}: starts with a byte order mark (C-I18N-01: UTF-8 without a BOM)`); continue; }
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { problems.push(`${name}: is not valid UTF-8`); continue; }
    let obj;
    try { obj = JSON.parse(text); } catch (e) { problems.push(`${name}: is not valid JSON (${e.message})`); continue; }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { problems.push(`${name}: the top level must be an object of pages`); continue; }
    for (const r of repeatedKeys(text)) problems.push(`${name}: repeats the key ${r.key} in one object (${r.path || 'top level'}); JSON keeps the last and hides the first`);
    const leaves = {};
    const walk = (o, prefix) => {
      for (const [k, v] of Object.entries(o)) {
        const key = prefix ? prefix + '.' + k : k;
        if (!/^[a-z][a-z0-9-]*$/.test(k)) problems.push(`${name}: key ${key} is not a lowercase ASCII key (letters, digits and hyphens, starting with a letter)`);
        if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, key);
        else if (typeof v !== 'string') problems.push(`${name}: ${key} must be a string (found ${Array.isArray(v) ? 'an array' : v === null ? 'null' : typeof v})`);
        else leaves[key] = v;
      }
    };
    walk(obj, '');
    for (const [key, v] of Object.entries(leaves)) {
      const at = `${name}: ${key}`;
      if (v.includes(SPLIT_SARA_AM)) problems.push(`${at} has the split sara am U+0E4D U+0E32 (write the one character U+0E33)`);
      if (v.includes(REPLACEMENT)) problems.push(`${at} holds U+FFFD, a replacement character left by a bad decode`);
      if (v.includes(BOM)) problems.push(`${at} holds U+FEFF, a byte order mark inside text`);
      if (/[\u0000-\u001f\u007f-\u009f]/.test(v)) problems.push(`${at} holds a control character`);
      if (v !== '' && (/^\s/.test(v) || /\s$/.test(v))) problems.push(`${at} has leading or trailing whitespace`);
      if (spaceBeforeMaiyamok(v)) problems.push(`${at} has a space or an invisible character other than U+00A0 before the Thai repetition mark (W-I18N-12: use a no-break space)`);
      for (const p of valueProblems(v)) problems.push(`${at} ${p}`);
    }
    parsed[tag] = leaves;
  }
  const tags = Object.keys(parsed);
  for (const a of tags) for (const b of tags) {
    if (a === b) continue;
    for (const key of Object.keys(parsed[a])) if (!(key in parsed[b])) problems.push(`${b}.json: key ${key} is missing (it is in ${a}.json)`);
  }
  for (const key of Object.keys(parsed[tags[0]] ?? {})) {
    const have = tags.filter(t => key in parsed[t]);
    if (have.length < tags.length) continue;
    const marks = have.map(t => [t, markupOf(parsed[t][key])]).filter(([t]) => parsed[t][key] !== '');
    if (marks.some(([, mk]) => mk !== marks[0][1])) problems.push(`${key}: the markup differs between languages (${marks.map(([t, mk]) => `${t}.json has [${mk}]`).join(', ')})`);
    if (INVARIANT.some(re => re.test(key)) && new Set(have.map(t => parsed[t][key])).size > 1) problems.push(`${key}: a name that is not translated must be the same in every language (${have.map(t => `${t}.json has ${JSON.stringify(parsed[t][key])}`).join(', ')})`);
  }
  return problems;
}

// The catalogue of a tree: { files, messages: { en: { 'home.hero.title': value, ... }, th: {...} }, problems }.
export function loadCatalogue(root = ROOT) {
  const dir = join(root, CATALOGUE_DIR);
  const files = {};
  if (existsSync(dir)) for (const e of readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile()).sort((a, b) => (a.name < b.name ? -1 : 1))) files[e.name] = readFileSync(join(dir, e.name));
  const messages = {};
  for (const [name, buf] of Object.entries(files)) {
    const m = /^(.+)\.json$/.exec(name);
    if (!m) continue;
    try { const text = buf.toString('utf8'); messages[m[1]] = flatten(JSON.parse(text.startsWith(BOM) ? text.slice(1) : text)); } catch { /* catalogueProblems names it */ }
  }
  return { files, messages, problems: existsSync(dir) ? catalogueProblems(files) : [`${CATALOGUE_DIR} is missing`] };
}

// ── what the code reads: t(lang, key) ───────────────────────────────────────────────────────────
// The shared blocks of legal-render.mjs (the header, the footers, the page note) read their strings here. The catalogue of the tree this module sits in is read once; a test can put another in
// place for the length of a call (withCatalogue), and read which keys a call asked for (usedKeys).
let loaded = null;
let override = null;
let recorder = null;
const current = () => override ?? (loaded ??= loadCatalogue().messages);
export function t(lang, key) {
  const m = current()[lang];
  if (!m || !(key in m)) throw new Error(`i18n: ${CATALOGUE_DIR}/${lang}.json has no ${key}`);
  recorder?.add(key);
  return m[key];
}
export const html = (lang, key) => valueHtml(t(lang, key));
export function withCatalogue(messages, fn) {
  const before = override;
  override = messages;
  try { return fn(); } finally { override = before; }
}
export function usedKeys(fn) {
  const before = recorder;
  recorder = new Set();
  try { fn(); return recorder; } finally { recorder = before; }
}
