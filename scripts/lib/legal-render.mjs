// Renders web/terms.html, web/privacy.html and web/refund.html from TERMS.md, PRIVACY.md and legal/thai-7day-clause.md (a library for
// scripts/legal-pages.mjs and its test; the pure functions take texts and return texts, nothing here reads or writes a file).
//
// WHAT IT RENDERS, in one sentence: every PASSAGE of a source is either shown as written (TEXT) or replaced by one pending line (HELD),
// and none is dropped, so for every source: passages = TEXT + HELD.
//
// A PASSAGE is a paragraph, a list item, or one paragraph of a block quote. Headings and HTML comments are structure, not passages.
// A passage is HELD when ANY of these holds:
//   1. it carries a counsel-pending marker, [pending legal review] or [รอที่ปรึกษากฎหมาย] (spaces inside tolerated);
//   2. it sits in a block quote whose FIRST passage carries a marker (a marker on a quote's head covers the whole quote, as in the Thai blocks);
//   3. it carries an unset placeholder: [N days], [N วัน] or a {{...}} token;
//   4. its anchor (its first eight words) is in the tracked hold list, scripts/lib/legal-holds.json.
// A held passage never shows its own text. Its pending line says only that the part waits for legal review.
//
// STATED LIMITS (what this does not do): it reads three Markdown shapes only (paragraphs, list items, block quotes) plus headings and
// comments; any other Markdown (a table, a link, an image, an HTML block) would pass through as escaped text, and the test fails on
// the first such passage a source gains. A nested list is shown flat. Headings are shown as written, held or not. The Thai view of a page
// shows the English TEXT passages in English (lang="en") because the sources have no full Thai text; the pending lines and the page
// frame are Thai. The hold list is matched by anchor, so two passages that open with the same eight words are held together.
import { MARK_EN, MARK_TH, PAGES, BANNER, PENDING, THAI_OWED, TEXT_TWINS, PENDING_LINES, REFUND_ROWS } from './legal-page-text.mjs';
import { activeSince } from './legal-state.mjs';

export const SOURCES = { terms: 'TERMS.md', privacy: 'PRIVACY.md', clause: 'legal/thai-7day-clause.md', changelog: 'CHANGELOG.md' };
export const HOLD_REASON = 'awaits counsel';

const RE_MARK = [/\[pending\s+legal\s+review\]/i, /\[\s*รอ\s*ที่ปรึกษา\s*กฎหมาย\s*\]/];
const RE_PLACEHOLDER = /\[N\s*(?:days|วัน)\]|\{\{[^}]*\}\}/;
const hasMarker = text => RE_MARK.some(re => re.test(text));

export const anchorOf = text => text.split(/\s+/).filter(Boolean).slice(0, 8).join(' ');
const squash = s => s.replace(/\s+/g, ' ').trim();

// ── 1. Splitting a source into headings and passages ─────────────────────────────────────────────
export function splitSource(md) {
  const items = [];
  let cur = null, block = 0, inBlock = false;
  const close = () => { if (cur) { items.push(cur); cur = null; } };
  const start = (text, depth, list) => { close(); cur = { kind: 'passage', text, depth, list, block: depth > 0 ? block : 0 }; };
  // An HTML comment is structure: removed whole, newlines inside it kept, so a comment that spans lines (or ends with --!>) cannot become a passage.
  const noComments = md.replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?--!?>/g, c => c.replace(/[^\n]/g, ''));
  for (const raw of noComments.split('\n')) {
    let s = raw, depth = 0, m;
    while ((m = /^\s*>\s?/.exec(s))) { s = s.slice(m[0].length); depth++; }
    const t = s.trim();
    if (depth === 0) inBlock = false;
    else if (!inBlock) { inBlock = true; block++; }
    if (t === '') { close(); continue; }
    const heading = /^(#{1,6})\s+(.*)$/.exec(t);
    if (heading) { close(); items.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim() }); continue; }
    const item = /^([-*+]|[0-9]+[.)])\s+(.*)$/.exec(t);
    if (item) { start(item[2], depth, /^[0-9]/.test(item[1]) ? 'ol' : 'ul'); continue; }
    if (cur && cur.depth === depth) cur.text += ' ' + t;
    else start(t, depth, null);
  }
  close();
  // A marker on a block quote's first passage covers every passage of that quote.
  const head = new Map();
  for (const it of items) if (it.kind === 'passage' && it.block > 0 && !head.has(it.block)) head.set(it.block, hasMarker(it.text));
  for (const it of items) if (it.kind === 'passage') it.byMarker = hasMarker(it.text) || (it.block > 0 && head.get(it.block) === true);
  return items;
}

// ── 2. Which passages are held ──────────────────────────────────────────────────────────────────
// opts.holds: [{ file, anchor, reason }]; opts.active: true when the legal-state record says the Thai 7-day clause is in force, which
// lifts the LIST hold from the clause file's own passages (their markers and placeholders still hold).
export function classify(file, md, opts) {
  const { holds = [], active = false, noHold = false } = opts || {};
  const listed = new Set(holds.filter(h => h.file === file).map(h => h.anchor));
  const useList = !(file === SOURCES.clause && active);
  const items = splitSource(md);
  const used = new Set();
  const redundant = new Set();
  for (const it of items) {
    if (it.kind !== 'passage') continue;
    it.anchor = anchorOf(it.text);
    const auto = it.byMarker || RE_PLACEHOLDER.test(it.text);
    const byList = useList && listed.has(it.anchor);
    if (byList) (auto ? redundant : used).add(it.anchor);
    else if (listed.has(it.anchor) && !useList) used.add(it.anchor); // a lifted list hold still names a real passage, so it is not stale
    it.held = !noHold && (auto || byList);
  }
  const passages = items.filter(i => i.kind === 'passage');
  const held = passages.filter(p => p.held).length;
  return { items, stats: { passages: passages.length, text: passages.length - held, held }, used, redundant, listed };
}

// Every reason the hold list is not a sound list over these sources; an empty list means sound.
export function holdProblems(holds, perFile) {
  const out = [];
  const seen = new Set();
  const files = Object.values(SOURCES);
  for (const h of holds) {
    const id = h.file + ' :: ' + h.anchor;
    if (!files.includes(h.file)) { out.push(`hold entry names an unknown file: ${id}`); continue; }
    if (typeof h.anchor !== 'string' || !h.anchor.trim()) { out.push(`hold entry has no anchor (${h.file})`); continue; }
    if (h.reason !== HOLD_REASON) out.push(`hold entry reason must be exactly "${HOLD_REASON}" (no tool, lane, sheet or ticket name): ${id}`);
    if (seen.has(id)) out.push(`hold entry is listed twice: ${id}`);
    seen.add(id);
    const c = perFile[h.file];
    if (!c) continue;
    if (!c.used.has(h.anchor)) out.push(c.redundant.has(h.anchor)
      ? `hold entry is redundant, the passage is already held by a marker or placeholder: ${id}`
      : `hold entry matches no passage of its file (the source changed, or the anchor is mistyped): ${id}`);
  }
  return out;
}

// ── 3. Inline Markdown → HTML, and the plain text it must equal ──────────────────────────────────
// Escaping, never stripping: one function for text and one for attribute values, each covering & < > " and '.
const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escText = s => s.replace(/[&<>"']/g, c => ENT[c]);
export const escAttr = s => s.replace(/[&<>"']/g, c => ENT[c]);
const SLOT = String.fromCharCode(0xE000); // private-use delimiter for a code span parked while emphasis is read

export function inline(md) {
  const codes = [];
  let s = md.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return SLOT + (codes.length - 1) + SLOT; });
  s = escText(s);
  s = s.replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>'); // text and url are already escaped
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>');
  return s.replace(new RegExp(SLOT + '([0-9]+)' + SLOT, 'g'), (_, i) => '<code>' + escText(codes[Number(i)]) + '</code>');
}
// The text a reader sees for a Markdown passage: its marks removed, nothing else changed.
export function plain(md) {
  const codes = [];
  let s = md.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return SLOT + (codes.length - 1) + SLOT; });
  s = s.replace(/\[([^\]]+)\]\(https:\/\/[^)\s]+\)/g, '$1').replace(/\*\*(.+?)\*\*/g, '$1').replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1$2');
  return squash(s.replace(new RegExp(SLOT + '([0-9]+)' + SLOT, 'g'), (_, i) => codes[Number(i)]));
}

// ── 4. Rendering a source for one language ──────────────────────────────────────────────────────
function pendingFor(file, anchor, lang) {
  const o = PENDING_LINES.find(p => p.file === file && p.anchor === anchor);
  return o ? o[lang] : PENDING[lang];
}

export function renderSource(file, md, lang, opts) {
  const c = classify(file, md, opts);
  const out = [];
  let list = null;
  const flush = () => { if (list) { out.push(`<${list.kind}>${list.rows.join('')}</${list.kind}>`); list = null; } };
  const enAttr = lang === 'th' ? ' lang="en"' : '';
  const errors = [];
  for (const it of c.items) {
    if (it.kind === 'heading') {
      if (it.level === 1) continue; // the page carries its own title
      flush();
      const tag = 'h' + Math.min(it.level, 3);
      out.push(`<${tag}${enAttr}>${inline(it.text)}</${tag}>`);
      continue;
    }
    let cls, body, attr = '';
    if (it.held) { cls = 'pending'; body = escText(pendingFor(file, it.anchor, lang)); }
    else {
      cls = 't';
      const twin = TEXT_TWINS.find(t => t.anchor === it.anchor);
      if (twin && plain(it.text) !== twin.en) errors.push(`the Thai twin for "${twin.anchor}" is out of step with the source passage`);
      if (twin && lang === 'th') { body = escText(twin.th); } else { body = inline(it.text); attr = enAttr; }
    }
    if (it.list) {
      if (!list || list.kind !== it.list) { flush(); list = { kind: it.list, rows: [] }; }
      list.rows.push(`<li class="${cls}"${attr}>${body}</li>`);
    } else { flush(); out.push(`<p class="${cls}"${attr}>${body}</p>`); }
  }
  flush();
  return { html: out.join('\n      '), stats: c.stats, errors };
}

function refundBody(clauseMd, termsClass, lang, opts) {
  const active = !!(opts && opts.active);
  const out = [];
  const errors = [];
  let heldRows = 0; // rows whose TERMS passage is held, shown as pending lines
  for (const r of REFUND_ROWS) {
    if (r.kind === 'pending' && !(r.en.startsWith(MARK_EN) && r.th.startsWith(MARK_TH))) errors.push(`refund row ${r.id} is pending and must begin with the marker of each language`);
    if (r.kind === 'text' && (hasMarker(r.en) || hasMarker(r.th))) errors.push(`refund row ${r.id} is shown as written and must not carry a marker`);
    if (r.id === 'R8' && active) {
      const c = renderSource(SOURCES.clause, clauseMd, lang, opts);
      errors.push(...c.errors);
      out.push(c.html);
      continue;
    }
    if (r.from) {
      // This row IS a passage of TERMS.md: shown the way the terms page shows it, or the generic pending line when the passage is held.
      const p = termsClass.items.find(i => i.kind === 'passage' && i.anchor === r.from);
      if (!p) { errors.push(`refund row ${r.id} names a TERMS.md passage that is not there (the anchor "${r.from}")`); continue; }
      if (p.held) { out.push(`<p class="pending">${escText(PENDING[lang])}</p>`); heldRows++; continue; }
      if (plain(p.text) !== r.en) errors.push(`refund row ${r.id}: the TERMS.md passage changed, so its Thai twin is out of step (update the row in scripts/lib/legal-page-text.mjs)`);
      out.push(`<p class="t">${escText(lang === 'en' ? plain(p.text) : r.th)}</p>`);
      continue;
    }
    out.push(`<p class="${r.kind === 'text' ? 't' : 'pending'}">${escText(r[lang])}</p>`);
  }
  const text = REFUND_ROWS.filter(r => r.kind === 'text').length - heldRows;
  const pending = REFUND_ROWS.filter(r => r.kind === 'pending').length + heldRows;
  return { html: out.join('\n      '), stats: { passages: REFUND_ROWS.length, text, held: pending }, errors };
}

// ── 5. The shared header and footer, and the page shell
// The header and the footer are written ONCE, here and nowhere else, and `legal-pages.mjs --write` puts them into every page between fixed markers (5a
// below). Their lines carry no indentation so each block is byte-identical wherever it sits, and `--check` compares it byte for byte.
// The header and footer rules use no page variable and no opacity: every text takes the colour its page gives it at full strength (WCAG 2.2 SC 1.4.3
// measures that colour against the page, and a test computes it), and hover changes the underline, not the colour. The same rules sit in every page's
// own style block, between markers.
// LAYOUT: the header and the footer are children of <body>, not of <main>, so their width does not depend on the page's own column (560px on the home
// page, 720px elsewhere, which made the same footer lay out in 3 columns on one page and 4 on another). The footer's five groups lay out by VIEWPORT
// width, the same on every page: 2 columns below 640px, 3 from 640px, 5 in one row from 1024px (the most common points in a read of 12 sites; market
// practice, not a standard). WCAG 2.2 SC 1.4.10 (reflow at 320px) is the one standard width: every track is minmax(0,1fr), every link may break
// anywhere, and the header's row wraps, so nothing in either has a width of its own.
// THE LANGUAGE follows <html lang>, which the page script sets: the header holds one <nav> per language and the footer one <footer> per language, and a
// rule shows the one that matches. With no script the Thai ones are shown too (NOSCRIPT_STYLE), as the Thai document is.
export const HEADER_CSS = [
  "  .site-header{border-bottom:1px solid rgba(128,128,128,.35);padding:6px 20px}",
  "  .site-header nav{display:flex;flex-wrap:wrap;align-items:center;gap:4px 18px;width:100%;max-width:1100px;margin:0 auto;font-size:14.5px}",
  '  .site-header nav[lang="th"]{display:none}',
  '  html[lang="th"] .site-header nav[lang="en"]{display:none}',
  '  html[lang="th"] .site-header nav[lang="th"]{display:flex}',
  "  .site-header a{color:inherit;text-decoration:none;display:inline-flex;align-items:center;min-height:44px;overflow-wrap:anywhere}",
  "  .site-header a:hover{text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:3px}",
  "  .site-header .hmark{gap:10px;font-weight:700;font-size:18px;letter-spacing:.01em;margin-right:auto}",
  "  .site-header .hglyph,.site-footer .fglyph{flex:none;display:block;fill:var(--accent,var(--amber,#e8833a))}",
  "  .lswitch{display:inline-flex;gap:6px}",
  "  .lswitch button{font:inherit;font-size:12.5px;color:inherit;background:transparent;border:1px solid rgba(128,128,128,.7);border-radius:8px;padding:6px 12px;min-height:34px;cursor:pointer}",
  "  .lswitch button:hover{text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:3px}",
  '  .lswitch button[aria-pressed="true"]{border-color:currentColor;font-weight:600}',
  "  .site-header :focus-visible,.site-footer :focus-visible{outline:2px solid currentColor;outline-offset:2px}"].join('\n');

export const FOOTER_CSS = [
  "  .site-footer{display:block;margin-top:72px;padding:44px 20px 32px;border-top:1px solid rgba(128,128,128,.35);font-size:13.5px;line-height:1.7}",
  '  .site-footer[lang="th"]{display:none}',
  '  html[lang="th"] .site-footer[lang="en"]{display:none}',
  '  html[lang="th"] .site-footer[lang="th"]{display:block}',
  "  .site-footer .fwrap{width:100%;max-width:1100px;margin:0 auto;display:flex;flex-direction:column;gap:28px}",
  "  .site-footer .fbrand{display:flex;align-items:center;gap:10px;margin:0;font-size:20px;font-weight:700;letter-spacing:.01em}",
  "  .site-footer .fgroups{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px 18px}",
  "  @media (min-width:640px){.site-footer .fgroups{grid-template-columns:repeat(3,minmax(0,1fr))}}",
  "  @media (min-width:1024px){.site-footer .fgroups{grid-template-columns:repeat(5,minmax(0,1fr))}}",
  "  .site-footer .fgroup{display:flex;flex-direction:column;align-items:flex-start;gap:2px;min-width:0}",
  "  .site-footer .fh{font-size:12px;letter-spacing:.04em;text-transform:uppercase;margin:0}",
  "  .site-footer a{color:inherit;text-decoration:underline;text-underline-offset:3px;display:inline-block;padding:5px 0;min-height:32px;overflow-wrap:anywhere}",
  "  .site-footer a:hover{text-decoration-thickness:2px}",
  "  .site-footer .fbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid rgba(128,128,128,.25);padding-top:16px}",
  "  .fine{font-size:12px;margin:0}"].join('\n');

// The Kolwen mark, on one line (the blocks carry no indentation). The fill is CSS (HEADER_CSS), so a light page can give it its darker on-light colour.
export const markSvg = (size, cls) => `<svg class="${cls}" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true"><rect x="8.5" y="9.1" width="64.3" height="25"/><rect x="17.85" y="46.25" width="64.3" height="19.66"/><rect x="27.2" y="75.46" width="64.3" height="15.45"/></svg>`;

const FOOTER = {
  en: { label: 'Footer', note: '© 2026 Kolwen · trademark application pending', groups: [
    ['Kolwen', [['/', 'Home']]],
    ['Product', [['/pricing', 'Pricing'], ['/changelog', 'Changelog']]],
    ['Legal', [['/terms', 'Terms'], ['/privacy', 'Privacy'], ['/refund', 'Refunds']]],
    ['Code', [['https://github.com/TheColliery/Kolwen', 'GitHub'], ['https://huggingface.co/kolwen', 'Hugging Face'], ['https://www.npmjs.com/package/kolwen', 'npm'], ['/llms.txt', 'llms.txt']]],
    ['Contact', [['mailto:info@kolwen.com', 'Email'], ['mailto:support@kolwen.com', 'Support'], ['mailto:abuse@kolwen.com', 'Report abuse'], ['mailto:appeals@kolwen.com', 'Appeals'], ['https://kolwen.com/.well-known/security.txt', 'Security']]]] },
  th: { label: 'ส่วนท้ายเว็บ', note: '© 2026 Kolwen · เครื่องหมายการค้าอยู่ระหว่างการจดทะเบียน', groups: [
    ['Kolwen', [['/', 'หน้าแรก']]],
    ['สินค้า', [['/pricing', 'ราคา'], ['/changelog', 'บันทึกการเปลี่ยนแปลง']]],
    ['กฎหมาย', [['/terms', 'ข้อกำหนด'], ['/privacy', 'ความเป็นส่วนตัว'], ['/refund', 'การคืนเงิน']]],
    ['โค้ด', [['https://github.com/TheColliery/Kolwen', 'GitHub'], ['https://huggingface.co/kolwen', 'Hugging Face'], ['https://www.npmjs.com/package/kolwen', 'npm'], ['/llms.txt', 'llms.txt']]],
    ['ติดต่อ', [['mailto:info@kolwen.com', 'อีเมล'], ['mailto:support@kolwen.com', 'ขอความช่วยเหลือ'], ['mailto:abuse@kolwen.com', 'แจ้งการละเมิด'], ['mailto:appeals@kolwen.com', 'ยื่นอุทธรณ์'], ['https://kolwen.com/.well-known/security.txt', 'ความปลอดภัย']]]] },
};
// A render parameter for the commercial registration number and the DBD mark: { en: 'text', th: 'text' }, or null. It prints NOTHING until it is set (no
// placeholder text, no empty element), and is set only after the registration and the lawyer's issue are in.
export const REGISTRATION = null;
export const siteFooterHtml = (lang, registration = REGISTRATION) => {
  const f = FOOTER[lang];
  const reg = registration && registration[lang] ? `<p class="fine freg">${escText(registration[lang])}</p>` : '';
  return [`<footer class="site-footer" lang="${lang}">`, '<div class="fwrap">', `<p class="fbrand">${markSvg(24, 'fglyph')}Kolwen</p>`,
    `<nav class="fgroups" aria-label="${escAttr(f.label)}">`,
    ...f.groups.map(([h, links]) => `<div class="fgroup"><p class="fh">${escText(h)}</p>${links.map(([u, t]) => `<a href="${escAttr(u)}">${escText(t)}</a>`).join('')}</div>`),
    '</nav>', '<div class="fbar">', `<p class="fine">${escText(f.note)}</p>`, reg, switchHtml(lang), '</div>', '</div>', '</footer>'].filter(Boolean).join('\n');
};

const HEADER = {
  en: { label: 'Main', home: 'Kolwen home', pricing: 'Pricing', lang: 'Language' },
  th: { label: 'เมนูหลัก', home: 'หน้าแรกของ Kolwen', pricing: 'ราคา', lang: 'ภาษา' },
};
// The TH/EN switch. Both buttons carry data-lang-set, which the page script reads; the script keeps aria-pressed on every switch of the page.
const switchHtml = lang => `<div class="lswitch" role="group" aria-label="${escAttr(HEADER[lang].lang)}"><button type="button" data-lang-set="en" lang="en" aria-pressed="true">English</button><button type="button" data-lang-set="th" lang="th" aria-pressed="false">ไทย</button></div>`;
// The header: the Kolwen mark linking to /, Pricing, the switch. No Dashboard and no Sign in until the service exists, and no link to a page that does not.
export const siteHeaderHtml = () => ['<header class="site-header">', ...['en', 'th'].map(lang => {
  const h = HEADER[lang];
  return [`<nav lang="${lang}" aria-label="${escAttr(h.label)}">`, `<a class="hmark" href="/" aria-label="${escAttr(h.home)}">${markSvg(26, 'hglyph')}<span>Kolwen</span></a>`,
    `<a href="/pricing">${escText(h.pricing)}</a>`, switchHtml(lang), '</nav>'].join('\n');
}), '</header>'].join('\n');

// What is true only of pages that store the language choice and load the fonts (not of the 404 page), so it is not in the shared block.
export const pageNoteHtml = lang => lang === 'en'
  ? '<p class="fine">This page: your language choice is stored locally in your browser · fonts are loaded from Google Fonts</p>'
  : '<p class="fine">หน้านี้: ภาษาที่เลือกถูกเก็บไว้ในเบราว์เซอร์ของคุณ · ฟอนต์โหลดจาก Google Fonts</p>';
// The footer blocks a page holds, in document order.
export const footersOf = html => html.match(/<footer class="site-footer"[^>]*>[\s\S]*?<\/footer>/g) || [];

// ── 5a. The blocks the build-time sync owns, and the markers around them (the one place the marker names are written) ──
// `node scripts/legal-pages.mjs --write` replaces, in each hand-kept page (index, pricing, 404), exactly the text between each pair of markers with the render
// below, and the four generated pages are rendered with the same markers, so one edit to the header, the footer or the page script reaches all seven pages in one run.
// A marker pair is a fixed comment: an HTML comment in the body, a CSS comment in a style block, a JS comment in the script. scripts/lib/page-sync.mjs reads and writes them.
const htmlPair = name => ({ name, begin: `<!-- ${name}:begin -->`, end: `<!-- ${name}:end -->` });
const cssPair = name => ({ name, begin: `/* ${name}:begin */`, end: `/* ${name}:end */` });
// THE ORDER OF THIS ARRAY IS THE ONE EXPECTED DOCUMENT ORDER of the pairs in every one of the seven pages, declared here once: the header rules and the footer
// rules in the style block (the head), the rules for a reader without script, then the header slot, the English footer, the Thai footer, and the page script at
// the end of the body. scripts/lib/page-sync.mjs reads the pairs in this order and refuses (--check and --write) a page whose pairs overlap, nest across each
// other or stand in another order, so swapping the two footers cannot pass.
export const SYNC_BLOCKS = [
  { ...cssPair('site-header-css'), label: 'header css', shared: 'header rules', render: () => HEADER_CSS },
  { ...cssPair('site-footer-css'), label: 'footer css', shared: 'footer rules', render: () => FOOTER_CSS },
  { ...cssPair('site-noscript-css'), label: 'noscript css', shared: 'rules for a reader without script', render: () => NOSCRIPT_STYLE },
  { ...htmlPair('site-header'), label: 'header', shared: 'header', render: siteHeaderHtml },
  { ...htmlPair('site-footer:en'), label: 'en footer', shared: 'footer', render: () => siteFooterHtml('en') },
  { ...htmlPair('site-footer:th'), label: 'th footer', shared: 'footer', render: () => siteFooterHtml('th') },
  { ...cssPair('site-script'), label: 'page script', shared: 'page script', render: () => SCRIPT },
];
const BLOCK = Object.fromEntries(SYNC_BLOCKS.map(b => [b.name, b]));
// A block as a page carries it: begin marker, the render, end marker, with the end marker at the start of its line.
export const fenced = name => `${BLOCK[name].begin}\n${BLOCK[name].render() ? BLOCK[name].render() + '\n' : ''}${BLOCK[name].end}`;

// ── 5b. The page shell (the site's own: fonts, colours, the language toggle and its noscript rule) ──
// One style block serves the four generated pages (terms, privacy, refund, changelog) AND web/pricing.html, so the five share one CSP hash (surface-check rule 13). The pricing page
// is edited by hand; `legal-pages.mjs --check` fails if its style block is not byte-for-byte this one.
export const STYLE = `
  :root{--bg:#0f0d0b;--bg2:#15130f;--card:#1a1714;--line:rgba(255,255,255,.08);--txt:#ece4d9;--txt2:#a89a8c;--quiet:#a2968a;--accent:#e8833a;--accent2:#ffbb7a}
  *{box-sizing:border-box;margin:0}
  body{background:radial-gradient(circle at 20% 0%,rgba(232,131,58,.07),transparent 55%),var(--bg);color:var(--txt);font-family:'IBM Plex Sans Thai',sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:stretch;padding:0;line-height:1.6}
  main{flex:1 0 auto;width:100%;max-width:760px;margin:0 auto;padding:36px 20px 0;display:flex;flex-direction:column;gap:28px}
  a:focus-visible,button:focus-visible{outline:2px solid var(--accent2);outline-offset:2px}
  .mark{display:flex;align-items:center;gap:12px;color:inherit;text-decoration:none}
  .glyph{flex:none;display:block}
  .name{font-size:34px;font-weight:700;letter-spacing:.01em}
  .thai{font-size:15px;color:var(--quiet);font-weight:500}
  h1{font-size:24px;font-weight:600;line-height:1.5}
  .sub{color:var(--txt2);font-size:14.5px;margin-top:8px}
  .card{border:1px solid var(--line);border-radius:14px;background:var(--card);padding:18px 20px;display:flex;flex-direction:column;gap:10px}
  .card h2,.card h3{font-size:13px;font-weight:600;color:var(--quiet);letter-spacing:.04em;text-transform:uppercase;font-family:'IBM Plex Mono',monospace}
  .card p,.card li{font-size:14.5px;color:var(--txt2)}
  .card strong{color:var(--txt);font-weight:600}
  .card ul{padding-left:20px;display:flex;flex-direction:column;gap:6px}
  .card code{font-family:'IBM Plex Mono',monospace;font-size:13.5px;color:var(--txt)}
  .plans{width:100%;border-collapse:collapse;font-size:14px}
  .plans caption{text-align:left;padding:0 0 8px;font-size:12.5px;color:var(--quiet);font-family:'IBM Plex Mono',monospace}
  .plans th,.plans td{text-align:left;padding:8px 10px 8px 0;border-bottom:1px solid var(--line);color:var(--txt2);font-weight:400;vertical-align:middle}
  .plans thead th{font-size:12.5px;color:var(--quiet);font-family:'IBM Plex Mono',monospace}
  .plans tbody th{color:var(--txt);font-weight:600}
  .plans tbody th small{display:block;font-size:12.5px;color:var(--quiet);font-weight:400}
  .plans button,.pcard button{font:inherit;font-size:12.5px;color:var(--quiet);background:var(--bg2);border:1px solid var(--line);border-radius:8px;padding:6px 12px;min-height:34px;cursor:not-allowed}
  .ch{display:flex;flex-wrap:wrap;gap:8px}
  .ch a{color:var(--txt);text-decoration:none;font-size:13.5px;border:1px solid var(--line);border-radius:9px;padding:7px 12px;background:var(--bg2);display:inline-flex;align-items:center;gap:7px;min-height:44px}
  .ch a:hover{border-color:rgba(232,131,58,.4);color:var(--accent2)}
  footer{margin-top:6px;font-size:12px;color:var(--quiet);display:flex;flex-direction:column;gap:4px}
  #doc-en > * + *,#doc-th > * + *{margin-top:28px}
  .banner{border:1px solid rgba(232,131,58,.45);background:rgba(232,131,58,.08);border-radius:10px;padding:12px 14px;font-size:14.5px;color:var(--txt);margin-top:14px}
  .legal{display:flex;flex-direction:column;gap:14px}
  .legal > * + *{margin-top:0}
  .legal h2{font-size:18px;font-weight:600;line-height:1.5;margin-top:14px}
  .legal h3{font-size:15.5px;font-weight:600;line-height:1.5;margin-top:6px}
  .legal p,.legal li{font-size:14.5px;color:var(--txt2);overflow-wrap:anywhere}
  .legal strong{color:var(--txt);font-weight:600}
  .legal ul,.legal ol{padding-left:22px;display:flex;flex-direction:column;gap:8px}
  .legal code{font-family:'IBM Plex Mono',monospace;font-size:13px;color:var(--txt);overflow-wrap:anywhere}
  .pending{color:var(--quiet) !important;font-style:italic}
  .bill{display:flex;flex-wrap:wrap;gap:8px;align-items:center;position:relative}
  .bill > input{position:absolute;opacity:0;width:1px;height:1px;margin:0}
  .bill > label{font-size:13.5px;color:var(--quiet);background:var(--bg2);border:1px solid var(--line);border-radius:9px;padding:8px 14px;min-height:40px;display:inline-flex;align-items:center;cursor:pointer}
  .bill > input:checked + label{color:var(--accent2);border-color:rgba(232,131,58,.55);background:rgba(232,131,58,.10)}
  .bill > input:focus-visible + label{outline:2px solid var(--accent2);outline-offset:2px}
  .bill .pcards{flex-basis:100%;display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));margin-top:6px}
  .bill > input[value="y"]:checked ~ .pcards .mo{display:none}
  .bill > input[value="m"]:checked ~ .pcards .yr{display:none}
  .pcard{border:1px solid var(--line);border-radius:14px;background:var(--card);padding:16px 18px;display:flex;flex-direction:column;gap:8px}
  .pcard h3{font-size:18px;font-weight:600;color:var(--txt);font-family:inherit;text-transform:none;letter-spacing:0}
  .faq h3{font-size:15px;font-weight:600;color:var(--txt);font-family:inherit;text-transform:none;letter-spacing:0}
  .card a,.legal a{color:var(--accent2)}
  .pcard .badge{font-size:12.5px;color:var(--quiet);font-family:'IBM Plex Mono',monospace}
  .pcard .price{font-size:26px;font-weight:700;color:var(--txt)}
  .pcard ul{padding-left:18px;display:flex;flex-direction:column;gap:5px}
  .pcard li{font-size:14px;color:var(--txt2)}
  .note{font-size:13px;color:var(--quiet)}
${fenced('site-header-css')}
${fenced('site-footer-css')}
  [hidden]{display:none !important}
  @media (max-width:420px){.name{font-size:28px}h1{font-size:20px}.plans th,.plans td{padding-right:6px;font-size:13px}.plans button{padding:6px 8px}}
`;

// What a reader without script gets: no switch (it would do nothing), the Thai document shown under the English one, and the Thai header and footer shown too.
export const NOSCRIPT_STYLE = [
  "  .lswitch{display:none}",
  "  #doc-th{display:block !important;border-top:1px solid var(--line);padding-top:28px}",
  '  .site-header nav[lang="th"]{display:flex !important}',
  '  .site-footer[lang="th"]{display:block !important}'].join('\n');

// The page script: the language choice. It keeps the SAME localStorage key as before, 'kolwen-lang', and the same behaviour (show the saved language, switch on a
// click, remember it); the only difference is that it finds the switches by data-lang-set instead of by id, so a page can hold more than one (the header's and the
// footer's), and it keeps aria-pressed right on all of them. PRIVACY.md's sentence that the page stores one key stays true: one setItem, one getItem, one key.
export const SCRIPT = `(function () {
  var KEY = 'kolwen-lang';
  var en = document.getElementById('doc-en');
  var th = document.getElementById('doc-th');
  var buttons = document.querySelectorAll('[data-lang-set]');

  function apply(lang, persist) {
    var thai = lang === 'th';
    th.hidden = !thai;
    en.hidden = thai;
    document.documentElement.lang = thai ? 'th' : 'en';
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('aria-pressed', String(buttons[i].getAttribute('data-lang-set') === lang));
    }
    if (persist) {
      // Language preference only. localStorage, never a cookie: it is a
      // client-only concern that never needs to ride on an HTTP request.
      try { localStorage.setItem(KEY, lang); } catch (e) {}
    }
  }

  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  if (saved === 'th' || saved === 'en') apply(saved, false);

  function bind(button) {
    button.addEventListener('click', function () { apply(button.getAttribute('data-lang-set'), true); });
  }
  for (var i = 0; i < buttons.length; i++) bind(buttons[i]);
})();`;

export function shell({ title, description, path, en, th }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escText(title)} — Kolwen</title>
<meta name="description" content="${escAttr(description)}">
<link rel="canonical" href="https://kolwen.com${escAttr(path)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="theme-color" content="#15130f">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${STYLE}</style>
<noscript><style>
${fenced('site-noscript-css')}
</style></noscript>
</head>
<body>
${fenced('site-header')}
<main>
  <div id="doc-en" lang="en">
${en}
  </div>

  <div id="doc-th" lang="th" hidden>
${th}
  </div>
</main>
${fenced('site-footer:en')}
${fenced('site-footer:th')}
<script>
${fenced('site-script')}
</script>
</body>
</html>
`;
}

function docHtml(lang, title, body, draft = true, note = '') {
  return `    <div>
      <h1>${escText(title)}</h1>${note ? `
      <p class="sub">${escText(note)}</p>` : ''}${draft ? `
      <p class="banner" role="note">${escText(BANNER[lang])}</p>` : ''}
    </div>
    <div class="legal">
      ${body}${draft ? `
      <p class="pending">${escText(THAI_OWED[lang])}</p>` : ''}
    </div>

${pageNoteHtml(lang)}`;
}

// ── 6. The four pages ──────────────────────────────────────────────────────────────────────────
// inputs: { terms, privacy, clause, changelog (CHANGELOG.md, optional: without it the changelog page is not rendered), state (the parsed legal-state record), holds (the parsed hold list) }.
// Returns { pages: { 'web/terms.html': html, ... }, report: [line], problems: [line] }.
export function renderPages(inputs) {
  const { terms, privacy, clause, state, holds, changelog } = inputs;
  const since = state ? activeSince(state) : null;
  const active = since !== null;
  const clauseText = active ? clause.split('{{since}}').join(since) : clause;
  const opts = { holds: holds.holds, active };
  const problems = [];
  const report = [];
  const pages = {};

  const perFile = {
    [SOURCES.terms]: classify(SOURCES.terms, terms, opts),
    [SOURCES.privacy]: classify(SOURCES.privacy, privacy, opts),
    [SOURCES.clause]: classify(SOURCES.clause, clauseText, opts),
  };
  problems.push(...holdProblems(holds.holds, perFile));
  for (const p of PENDING_LINES) if (!(perFile[p.file] && perFile[p.file].items.some(i => i.kind === 'passage' && i.held && i.anchor === p.anchor))) problems.push(`the specific pending line for "${p.anchor}" matches no held passage of ${p.file}`);

  const done = (key, lines, draft = true) => {
    const P = PAGES[key];
    const html = shell({
      title: P.titleEn, description: P.descEn, path: P.path,
      en: docHtml('en', P.titleEn, lines.en.html, draft, ''), th: docHtml('th', P.titleTh, lines.th.html, draft, P.noteTh || ''),
    });
    pages[P.file] = html;
    for (const l of ['en', 'th']) problems.push(...lines[l].errors.map(e => `${P.file} (${l}): ${e}`));
    return lines.en.stats;
  };

  const say = (page, src, s, extra) => report.push(`${page}: ${src} ${s.passages} passages = ${s.text} shown as written + ${s.held} pending lines${extra || ''}`);
  for (const [key, srcKey, mdText] of [['terms', 'terms', terms], ['privacy', 'privacy', privacy]]) {
    const file = SOURCES[srcKey];
    const en = renderSource(file, mdText, 'en', opts), th = renderSource(file, mdText, 'th', opts);
    say(PAGES[key].file, file, done(key, { en, th }));
  }
  const ren = refundBody(clauseText, perFile[SOURCES.terms], 'en', opts), rth = refundBody(clauseText, perFile[SOURCES.terms], 'th', opts);
  const rs = done('refund', { en: ren, th: rth });
  say(PAGES.refund.file, 'refund rows', rs);
  const cs = perFile[SOURCES.clause].stats;
  report.push(`${PAGES.refund.file}: ${SOURCES.clause} ${cs.passages} passages = ${cs.text} shown as written + ${cs.held} held${active ? ` (in force since ${since}: shown in place of R8)` : ' (not in force: held, shown as the one pending line R8)'}`);
  // The changelog: the repository's own CHANGELOG.md, every passage shown as written (nothing in it waits for counsel, so no hold applies).
  if (typeof changelog === 'string') {
    const o = { holds: [], noHold: true };
    const en = renderSource(SOURCES.changelog, changelog, 'en', o), th = renderSource(SOURCES.changelog, changelog, 'th', o);
    say(PAGES.changelog.file, SOURCES.changelog, done('changelog', { en, th }, false));
  }
  return { pages, report, problems };
}
