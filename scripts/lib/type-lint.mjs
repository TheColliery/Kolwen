// The static lint of the layout tokens (build-qc.md W-I18N-10, W-FMT-11), over the style blocks of the built pages:
//  - every font-size is rem, or a clamp()/calc()/min()/max() whose value carries a rem term: no px, pt or other absolute unit, no em, ex, ch or percentage, and no viewport unit unless a rem term
//    stands in the same value (text never scales by viewport units alone: WCAG SC 1.4.4, failure F94). This holds for the `font-size` property and for the size inside a `font` shorthand;
//  - every clamp() anywhere in a font-size carries a rem term;
//  - a var() in a font-size is followed to its custom property (the tokens of scripts/lib/layout-tokens.mjs), and that value is judged; a var() that resolves to nothing is a finding;
//  - every page carries the viewport meta of the layout formula, with viewport-fit=cover and nothing that blocks the visitor's zoom (user-scalable, maximum-scale);
//  - every page declares its job on <html> (data-job="prose" for a page read top to bottom, "default" for a page to choose from), and a prose page carries the meta lines of the reading theme
//    (color-scheme, and a theme-color for each scheme).
// STATED LIMITS: a style block is read as declarations split at `;` `{` `}` outside strings and parentheses (no selector is understood, and a declaration inside any at-rule is read like any other);
// a font-size set by script at run time, or by a stylesheet this site does not serve, is not seen; the unit of `line-height` and every other property is not judged here.
import { htmlTokens } from './html-tokens.mjs';
import { styleBlocksOf, stripCssComments } from './rendered-text.mjs';
import { VIEWPORT_META, JOBS, READING } from './layout-tokens.mjs';

const ABSOLUTE = /(?:^|[^a-z0-9_-])-?(?:\d+\.?\d*|\.\d+)(px|pt|pc|cm|mm|in|q)(?![a-z0-9_-])/gi;
const RELATIVE = /(?:^|[^a-z0-9_-])-?(?:\d+\.?\d*|\.\d+)(em|ex|ch|cap|ic|lh|rlh|%)(?![a-z0-9_-])/gi;
const VIEWPORT = /(?:^|[^a-z0-9_-])-?(?:\d+\.?\d*|\.\d+)(vw|vh|vi|vb|vmin|vmax|svw|svh|lvw|lvh|dvw|dvh|svi|svb|lvi|lvb|dvi|dvb|svmin|svmax|lvmin|lvmax|dvmin|dvmax|cqw|cqh|cqi|cqb|cqmin|cqmax)(?![a-z0-9_-])/gi;
const KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);
const SIZE_WORDS = new Set(['xx-small', 'x-small', 'small', 'medium', 'large', 'x-large', 'xx-large', 'xxx-large', 'larger', 'smaller', 'math']);

// Declarations of a stylesheet text: [{ prop, value }], split at ; { } outside strings and parentheses.
export function declarationsOf(css) {
  const text = stripCssComments(css);
  const out = [];
  let depth = 0, quote = null, from = 0;
  const cut = at => {
    const seg = text.slice(from, at);
    from = at + 1;
    const m = /^\s*(--[^\s:]+|[a-z-]+)\s*:\s*([\s\S]*?)\s*$/i.exec(seg);
    if (m) out.push({ prop: m[1].toLowerCase().startsWith('--') ? m[1] : m[1].toLowerCase(), value: m[2] });
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && (c === ';' || c === '{' || c === '}')) cut(i);
  }
  cut(text.length);
  return out;
}

// The inside of every `fn(` ... `)` call of a value, by name.
function calls(value, fn) {
  const out = [];
  const re = new RegExp('(?:^|[^a-z0-9-])' + fn + '\\(', 'gi');
  for (let m; (m = re.exec(value));) {
    let depth = 1, i = m.index + m[0].length;
    const start = i;
    for (; i < value.length && depth > 0; i++) { if (value[i] === '(') depth++; else if (value[i] === ')') depth--; }
    out.push(value.slice(start, i - 1));
  }
  return out;
}

// A value with every var(--x) replaced by the definition of --x (or its fallback). Returns { value, missing: [names] }.
// K-16: each definition is expanded once per definitions map (a memo), so a chain whose definitions each name the one before it many times costs the chain's size, not its
// fan-out; the chain stays bounded at depth 8, as before; and an expansion past EXPAND_MAX characters is cut there, its name reported missing, so no value grows past the bound.
const EXPAND_MAX = 1 << 16;
const CUT_MARK = '(a cut expansion)'; // not a name: marks an expansion the bound cut
const CUT_WHY = 'a custom-property expansion passed 65536 characters and was cut';
const memos = new WeakMap();
const MEMO_MAX = 1 << 22; // the characters the memo keeps across names (a value's length, and each missing name's length): past it a name is stored as its cut, so the memo's size stays bounded (CR-2)
function expand(value, defs) {
  if (!memos.has(defs)) memos.set(defs, { map: new Map(), kept: 0 });
  return expandWith(value, defs, memos.get(defs), 0);
}
function expandWith(value, defs, memo, depth) {
  const missing = new Set(); // names, once each: a name reached through many references is still one name
  let size = 0, cut = false; // the length of the replacement built so far: once past EXPAND_MAX, nothing more is built (F-2)
  const out = value.replace(/var\(\s*(--[^\s,)]+)\s*(?:,([^)]*))?\)/g, (all, name, fallback) => {
    if (cut) return '';
    let rep;
    if (defs.has(name) && depth < 8) {
      if (!memo.map.has(name)) {
        let r = expandWith(defs.get(name), defs, memo, depth + 1);
        const cost = r.value.length + [...r.missing].reduce((n, m) => n + m.length, 0); // a stored entry costs its value and its missing names
        if (memo.kept + cost > MEMO_MAX) r = { value: '', missing: [CUT_MARK] }; // past the memo's bound: stored as its cut, so nothing is recomputed per reference
        else memo.kept += cost;
        memo.map.set(name, r);
      }
      const r = memo.map.get(name);
      for (const m of r.missing) missing.add(m);
      rep = r.value;
    } else if (fallback !== undefined) {
      rep = fallback;
    } else {
      missing.add(name);
      rep = '';
    }
    size += rep.length;
    if (size > EXPAND_MAX) { cut = true; missing.add(CUT_MARK); return ''; }
    return rep;
  });
  if (cut || out.length > EXPAND_MAX) { missing.add(CUT_MARK); return { value: out.slice(0, EXPAND_MAX), missing: [...missing] }; }
  return { value: out, missing: [...missing] };
}

// The size part of a `font` shorthand value: the first top-level token that is not a style, a weight or a variant word, before any `/line-height`.
function shorthandSize(value) {
  const parts = [];
  let depth = 0, cur = '';
  for (const c of value) {
    if (c === '(') depth++; else if (c === ')') depth--;
    if (/\s/.test(c) && depth === 0) { if (cur) parts.push(cur); cur = ''; } else cur += c;
  }
  if (cur) parts.push(cur);
  for (const p of parts) {
    const size = p.split('/')[0];
    if (KEYWORDS.has(size.toLowerCase())) return size;
    if (/^(?:normal|italic|oblique|bold|bolder|lighter|small-caps|\d{3}|ultra-condensed|extra-condensed|condensed|semi-condensed|semi-expanded|expanded|extra-expanded|ultra-expanded)$/i.test(size)) continue;
    return size;
  }
  return null;
}

// What is wrong with a (var-expanded) font-size value, or null.
export function sizeProblem(value) {
  const v = value.trim().replace(/\s*!important$/i, '');
  if (KEYWORDS.has(v.toLowerCase())) return null;
  if (SIZE_WORDS.has(v.toLowerCase())) return `the keyword size ${v} is not a rem size`;
  const abs = [...v.matchAll(ABSOLUTE)].map(m => m[1].toLowerCase());
  if (abs.length) return `an absolute unit (${[...new Set(abs)].join(', ')}): a font size is rem, so the visitor's own text size scales it`;
  const rel = [...v.matchAll(RELATIVE)].map(m => m[1].toLowerCase());
  if (rel.length) return `a unit that is not rem (${[...new Set(rel)].join(', ')}): a font size is rem`;
  const hasRem = /(?:^|[^a-z0-9_-])-?(?:\d+\.?\d*|\.\d+)rem(?![a-z0-9_-])/i.test(v);
  const vp = [...v.matchAll(VIEWPORT)].map(m => m[1].toLowerCase());
  if (vp.length && !hasRem) return `viewport units (${[...new Set(vp)].join(', ')}) with no rem term: text never scales by viewport units alone (SC 1.4.4, failure F94)`;
  for (const c of calls(v, 'clamp')) if (!/rem/i.test(c)) return `a clamp() with no rem term (clamp(${c.trim()})): every clamp carries one`;
  if (!hasRem) return 'no rem term';
  return null;
}

// The findings of a set of stylesheet texts that make one page: [{ prop, value, why }].
// What the lint says of a name the expansion could not resolve: the cut has its own line (ruling (a)), a missing name the usual one.
const expansionWhy = name => (name === CUT_MARK ? CUT_WHY : 'var(' + name + ') resolves to nothing, so its size cannot be judged');
export function fontSizeProblems(cssTexts) {
  const decls = cssTexts.flatMap(declarationsOf);
  const defs = new Map();
  for (const d of decls) if (d.prop.startsWith('--')) defs.set(d.prop, d.value);
  const out = [];
  for (const d of decls) {
    if (d.prop !== 'font-size' && d.prop !== 'font') continue;
    let value = d.value;
    if (d.prop === 'font') {
      const e0 = expand(value, defs);
      for (const name of e0.missing) out.push({ prop: d.prop, value: d.value, why: expansionWhy(name) });
      const size = shorthandSize(e0.value);
      if (size === null) { out.push({ prop: d.prop, value: d.value, why: 'a font shorthand whose size cannot be read' }); continue; }
      value = size;
    }
    const e = expand(value, defs);
    for (const name of e.missing) out.push({ prop: d.prop, value: d.value, why: expansionWhy(name) });
    if (e.missing.length) continue;
    const why = sizeProblem(e.value);
    if (why) out.push({ prop: d.prop, value: d.value, why });
  }
  return out;
}

// One page: its style blocks and the style attributes of its tags, plus the extra stylesheets it links (the font manifest), judged together; and its viewport meta.
export function pageTypeProblems(html, extraCss = []) {
  const out = [];
  const sheets = [...styleBlocksOf(html, { scripting: false }), ...extraCss];
  const tokens = htmlTokens(html, { scripting: false });
  for (const t of tokens) if (t.type === 'tag' && !t.closing && t.attrs.has('style')) sheets.push(`a{${t.attrs.get('style')}}`);
  for (const p of fontSizeProblems(sheets)) out.push(`${p.prop}: ${p.value} is ${p.why}`);
  const metas = tokens.filter(t => t.type === 'tag' && !t.closing && t.name === 'meta' && (t.attrs.get('name') ?? '').toLowerCase() === 'viewport');
  if (metas.length !== 1) out.push(`the page has ${metas.length} viewport metas, expected exactly one: ${VIEWPORT_META}`);
  else {
    const content = (metas[0].attrs.get('content') ?? '').toLowerCase();
    const items = new Map(content.split(',').map(s => s.trim().split('=').map(x => x.trim())).filter(a => a[0]).map(([k, v]) => [k, v ?? '']));
    if (items.get('width') !== 'device-width') out.push('the viewport meta lacks width=device-width');
    if (items.get('initial-scale') !== '1') out.push('the viewport meta lacks initial-scale=1');
    if (items.get('viewport-fit') !== 'cover') out.push('the viewport meta lacks viewport-fit=cover, so env(safe-area-inset-*) is always 0');
    for (const blocked of ['user-scalable', 'maximum-scale', 'minimum-scale']) if (items.has(blocked)) out.push(`the viewport meta sets ${blocked}, which can block the visitor's zoom (SC 1.4.4)`);
  }
  out.push(...pageJobProblems(html));
  return out;
}

// The job a page declares for itself (layout-tokens.mjs, THE READING THEME), and what a prose page must carry for the browser chrome (W-DISC-10).
export function pageJobProblems(html) {
  const tokens = htmlTokens(html, { scripting: false });
  const root = tokens.find(t => t.type === 'tag' && !t.closing && t.name === 'html');
  const job = root?.attrs.get('data-job');
  if (job === undefined) return ['the <html> element declares no job: data-job="prose" (a page read top to bottom) or data-job="default" (a page of cards, buttons or figures to choose from)'];
  if (!JOBS.includes(job)) return [`data-job="${job}" is not a job (one of ${JOBS.join(', ')})`];
  if (job !== 'prose') return [];
  const out = [];
  const metas = tokens.filter(t => t.type === 'tag' && !t.closing && t.name === 'meta');
  const scheme = metas.filter(m => (m.attrs.get('name') ?? '').toLowerCase() === 'color-scheme');
  if (scheme.length !== 1 || !/^\s*light\s+dark\s*$/i.test(scheme[0].attrs.get('content') ?? '')) out.push('a prose page carries exactly one <meta name="color-scheme" content="light dark">');
  const themes = metas.filter(m => (m.attrs.get('name') ?? '').toLowerCase() === 'theme-color');
  for (const [mode, colour] of [['light', READING.light.bg], ['dark', READING.dark.bg]]) {
    const hit = themes.filter(m => (m.attrs.get('media') ?? '').replace(/\s+/g, '') === `(prefers-color-scheme:${mode})`);
    if (hit.length !== 1 || (hit[0].attrs.get('content') ?? '').toLowerCase() !== colour) out.push(`a prose page carries exactly one theme-color of ${colour} for (prefers-color-scheme: ${mode}), the ground of its ${mode} scheme`);
  }
  if (themes.length !== 2) out.push(`a prose page carries a theme-color for each scheme and no other (found ${themes.length})`);
  return out;
}
