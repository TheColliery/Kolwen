// The static lint of the layout tokens (build-qc.md W-I18N-10, W-FMT-11), over the style blocks of the built pages:
//  - every font-size is rem, or a clamp()/calc()/min()/max() whose value carries a rem term: no px, pt or other absolute unit, no em, ex, ch or percentage, and no viewport unit unless a rem term
//    stands in the same value (text never scales by viewport units alone: WCAG SC 1.4.4, failure F94). This holds for the `font-size` property and for the size inside a `font` shorthand;
//  - every clamp() anywhere in a font-size carries a rem term;
//  - a var() in a font-size is followed to its custom property (the tokens of scripts/lib/layout-tokens.mjs), and that value is judged; a var() that resolves to nothing is a finding;
//  - every page carries the viewport meta of the layout formula, with viewport-fit=cover and nothing that blocks the visitor's zoom (user-scalable, maximum-scale).
// STATED LIMITS: a style block is read as declarations split at `;` `{` `}` outside strings and parentheses (no selector is understood, and a declaration inside any at-rule is read like any other);
// a font-size set by script at run time, or by a stylesheet this site does not serve, is not seen; the unit of `line-height` and every other property is not judged here.
import { htmlTokens } from './html-tokens.mjs';
import { styleBlocksOf, stripCssComments } from './rendered-text.mjs';
import { VIEWPORT_META } from './layout-tokens.mjs';

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
function expand(value, defs, depth = 0) {
  const missing = [];
  const out = value.replace(/var\(\s*(--[^\s,)]+)\s*(?:,([^)]*))?\)/g, (all, name, fallback) => {
    if (defs.has(name) && depth < 8) { const r = expand(defs.get(name), defs, depth + 1); missing.push(...r.missing); return r.value; }
    if (fallback !== undefined) return fallback;
    missing.push(name);
    return '';
  });
  return { value: out, missing };
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
      for (const name of e0.missing) out.push({ prop: d.prop, value: d.value, why: `var(${name}) resolves to nothing, so its size cannot be judged` });
      const size = shorthandSize(e0.value);
      if (size === null) { out.push({ prop: d.prop, value: d.value, why: 'a font shorthand whose size cannot be read' }); continue; }
      value = size;
    }
    const e = expand(value, defs);
    for (const name of e.missing) out.push({ prop: d.prop, value: d.value, why: `var(${name}) resolves to nothing, so its size cannot be judged` });
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
  return out;
}
