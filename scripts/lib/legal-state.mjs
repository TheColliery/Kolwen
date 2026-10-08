// The legal-state record and the switch it drives (a library for scripts/legal-state.mjs and scripts/surface-check.mjs rule 19).
//
// legal/legal-state.json holds STATE ONLY: the seller type and the DATES on which a legal trigger was met. The Thai 7-day
// cancellation clause is in force exactly when a trigger date is set (and, for revenue, not vetoed). The clause TEXT lives in
// legal/thai-7day-clause.md; TERMS.md carries it between one pair of markers only while the record says it is in force, and
// the block is a pure function of (record, clause file): nobody edits it by hand, `scripts/legal-state.mjs --write` renders it
// and surface-check rule 19 refuses a TERMS.md whose block disagrees with the record.
//
// THE RAIL ON THIS PUBLIC REPO: the record names a fixed set of keys whose values are null or a calendar date, and nothing else.
// A registration number, a tax identification number, a revenue figure or any owner identifier cannot be stored here; the
// design (legal/README.md) names the future private repository as their home, and this public build reads only a date.
export const STATE_FILE = 'legal/legal-state.json';
export const CLAUSE_FILE = 'legal/thai-7day-clause.md';
export const TERMS_FILE = 'TERMS.md';
export const BEGIN = '<!-- legal-state:thai-7day:begin -->';
export const END = '<!-- legal-state:thai-7day:end -->';
export const VETO_DAYS = 14;

const SELLER_TYPES = ['natural-person', 'company'];
const SHAPE = { incorporated: ['on'], directMarketingRegistered: ['on'], revenueThreshold: ['crossedOn', 'vetoedOn'] };
const TOP_KEYS = ['schema', 'sellerType', ...Object.keys(SHAPE)];

const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const dayNumber = v => Date.parse(v + 'T00:00:00Z') / (24 * 3600 * 1000);
const sameKeys = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).sort().join() === [...keys].sort().join();

// Every reason the record is not a valid state record; an empty list means valid.
export function validateState(rec) {
  const errs = [];
  if (!sameKeys(rec, TOP_KEYS)) { errs.push(`the record must hold exactly the keys ${TOP_KEYS.join(', ')} (it holds state only: no number, no figure, no identifier)`); return errs; }
  if (rec.schema !== 1) errs.push('schema must be 1');
  if (!SELLER_TYPES.includes(rec.sellerType)) errs.push(`sellerType must be one of ${SELLER_TYPES.join(', ')}`);
  for (const [group, keys] of Object.entries(SHAPE)) {
    if (!sameKeys(rec[group], keys)) { errs.push(`${group} must hold exactly the keys ${keys.join(', ')}`); continue; }
    for (const k of keys) if (rec[group][k] !== null && !isDate(rec[group][k])) errs.push(`${group}.${k} must be null or a real calendar date (YYYY-MM-DD), nothing else`);
  }
  if (errs.length) return errs;
  if (rec.incorporated.on !== null && rec.sellerType !== 'company') errs.push('incorporated.on is set but sellerType is not company');
  if (rec.sellerType === 'company' && rec.incorporated.on === null) errs.push('sellerType is company but incorporated.on is not set (the incorporation trigger would never arm the clause)');
  const { crossedOn, vetoedOn } = rec.revenueThreshold;
  if (vetoedOn !== null) {
    if (crossedOn === null) errs.push('revenueThreshold.vetoedOn is set with no crossedOn');
    else if (dayNumber(vetoedOn) < dayNumber(crossedOn) || dayNumber(vetoedOn) - dayNumber(crossedOn) > VETO_DAYS) errs.push(`revenueThreshold.vetoedOn must fall within ${VETO_DAYS} calendar days after crossedOn (a veto is for a measurement error only)`);
  }
  return errs;
}

// The date the clause takes effect: the earliest trigger that stands (a vetoed revenue crossing does not), or null.
export function activeSince(rec) {
  const dates = [rec.incorporated.on, rec.directMarketingRegistered.on, rec.revenueThreshold.vetoedOn === null ? rec.revenueThreshold.crossedOn : null].filter(Boolean);
  return dates.length ? dates.sort()[0] : null;
}
export const clauseActive = rec => activeSince(rec) !== null;

const lf = s => s.replace(/\r\n/g, '\n');

// The block exactly as TERMS.md must hold it: the two markers alone when the clause is not in force, the dated clause between them when it is.
export function renderBlock(clauseText, rec) {
  const since = activeSince(rec);
  if (since === null) return BEGIN + '\n' + END;
  return BEGIN + '\n\n' + lf(clauseText).trim().split('{{since}}').join(since) + '\n\n' + END;
}

// Where the block sits in TERMS.md: { error } unless there is exactly one begin marker, one end marker, begin before end.
export function locateBlock(terms) {
  const t = lf(terms);
  const count = (s, x) => s.split(x).length - 1;
  if (count(t, BEGIN) !== 1 || count(t, END) !== 1) return { error: `TERMS.md must hold exactly one ${BEGIN} and one ${END} marker (found ${count(t, BEGIN)} and ${count(t, END)})` };
  const start = t.indexOf(BEGIN), end = t.indexOf(END) + END.length;
  if (end - END.length < start) return { error: 'the end marker comes before the begin marker in TERMS.md' };
  return { start, end, text: t };
}

// TERMS.md with its block rendered from the record.
export function renderTerms(terms, clauseText, rec) {
  const loc = locateBlock(terms);
  if (loc.error) return { error: loc.error };
  return { text: loc.text.slice(0, loc.start) + renderBlock(clauseText, rec) + loc.text.slice(loc.end) };
}

// Findings for rule 19 and the CLI: [{ kind: 'record' | 'markers' | 'sync', msg }] over the three file TEXTS (null = file missing).
export function findings({ record, clause, terms }) {
  const out = [];
  for (const [name, text] of [[STATE_FILE, record], [CLAUSE_FILE, clause], [TERMS_FILE, terms]]) if (text === null) out.push({ kind: 'record', msg: `${name} is missing, so the legal-state check has nothing to hold` });
  if (out.length) return out;
  let rec = null;
  try { rec = JSON.parse(record.replace(/^\uFEFF/, '')); } catch { out.push({ kind: 'record', msg: `${STATE_FILE} is not valid JSON` }); return out; }
  const errs = validateState(rec);
  for (const e of errs) out.push({ kind: 'record', msg: `${STATE_FILE}: ${e}` });
  if (errs.length) return out;
  const loc = locateBlock(terms);
  if (loc.error) { out.push({ kind: 'markers', msg: loc.error }); return out; }
  const want = renderBlock(clause, rec), have = loc.text.slice(loc.start, loc.end);
  if (have !== want) {
    const since = activeSince(rec);
    out.push({ kind: 'sync', msg: since === null
      ? 'the record says the clause is not in force, but the TERMS.md block is not empty (the clause must not render until a trigger is entered); run scripts/legal-state.mjs --write'
      : `the record says the clause is in force since ${since}, but the TERMS.md block is not the rendered clause (run scripts/legal-state.mjs --write)` });
  }
  return out;
}
