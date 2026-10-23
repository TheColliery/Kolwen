// The controller name slot: the privacy page, and no other page, names the data controller (the brand Kolwen together with the owner's own name; owner card BB-214 (a)).
//
// ONE SOURCE. The name is read from legal/controller.json, a record of exactly two keys: { "schema": 1, "name": "" }. It is a file of its own and not a field of legal/legal-state.json, because that record's
// rail (scripts/lib/legal-state.mjs) holds state and dates only, no owner identifier. The slot is the token {{controller-name}}; PRIVACY.md carries it where the name belongs, and the build puts the name in
// before the passages are read (scripts/lib/legal-render.mjs, renderPages).
//
// WHAT IT REFUSES (the build exits 1, nothing is written):
//   - the slot in PRIVACY.md while the record holds no name: nothing ships with a placeholder, and an empty name is never read as "no controller";
//   - the slot in any other source (TERMS.md, the Thai 7-day clause, CHANGELOG.md), in a site template (home, pricing, the 404 page) or in a catalogue string, with a value or without one;
//   - a record that is not exactly schema 1 and a name: a name is plain text of one line (letters, marks, digits, space and . , ' ( ) -, at most 120 characters), so it cannot carry markup, a template, a
//     line break or a Markdown character into a page.
// WHAT IT DOES NOT DO: read a name anywhere else. No gate of this repository reads a personal name (a name has no pattern); the rule that none belongs on a page other than the privacy page is the
// repository's written law (CLAUDE.md, "Never in this repo"), and this file is what makes the one allowed place a single, checked, tracked string. Node builtins only.
export const CONTROLLER_FILE = 'legal/controller.json';
export const SLOT = '{{controller-name}}';
export const PRIVACY_FILE = 'PRIVACY.md';
export const NAME_MAX = 120;
const KEYS = 'name,schema';
// letters and combining marks of any script (Thai vowels and tone marks are marks), digits, space, and . , ' the right single quote, parentheses and a hyphen
const NAME_CHARS = new RegExp('^[\\p{L}\\p{M}\\p{N} .,' + "'" + String.fromCharCode(0x2019) + '()-]+$', 'u');

// Every reason the record is not a valid controller record; an empty list means valid (an empty name is valid: the slot is simply not placed yet).
export function validateController(rec) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec) || Object.keys(rec).sort().join() !== KEYS) return [`the record must hold exactly the keys schema and name`];
  const errs = [];
  if (rec.schema !== 1) errs.push('schema must be 1');
  if (typeof rec.name !== 'string') { errs.push('name must be a string (empty until the name is given)'); return errs; }
  const n = rec.name;
  if (n === '') return errs;
  if (n !== n.trim()) errs.push('name has a space at its start or end');
  if (n.length > NAME_MAX) errs.push(`name is longer than ${NAME_MAX} characters`);
  if (!NAME_CHARS.test(n)) errs.push('name holds a character that is not a letter, a mark, a digit, a space or one of . , \' ( ) - (a name is plain text of one line: no markup, no template, no line break)');
  return errs;
}

// A source other than PRIVACY.md, a template or a catalogue string: it must not carry the slot.
export const slotProblems = (label, text) => (String(text).includes(SLOT) ? [`${label}: the controller name slot ${SLOT} belongs to PRIVACY.md only (the privacy page names the controller; nothing else does)`] : []);

// The text of one legal source with the slot filled. { text, problems }: in PRIVACY.md the slot becomes the name (a problem when the name is empty, text left as it is); in any other source the slot is a problem.
// A token that reads as the slot once case and white space are folded (`{{ controller-name }}`, `{{Controller-Name}}`) but is not the exact slot. A near miss is not a placeholder to hold: it is the slot, misspelt.
// One linear pass: a token is `{{`, anything but a brace, `}}`, so a start that finds no end stops at the next brace.
export function nearSlotTokens(text) {
  return (String(text).match(/\{\{[^{}]*\}\}/g) || []).filter(t => t !== SLOT && t.slice(2, -2).toLowerCase().replace(/\s+/g, '') === 'controller-name');
}

export function fillController(file, text, rec) {
  if (file === PRIVACY_FILE) {
    // INSPECT L-1 (1017j): without this a misspelt slot is held as an unset placeholder, the controller sentence leaves the page, and the build stays green.
    const near = [...new Set(nearSlotTokens(text))].slice(0, 5);
    if (near.length) return { text, problems: near.map(t => `${PRIVACY_FILE} carries the token ${JSON.stringify(t)}, which reads as the controller name slot but is not the exact slot ${SLOT}: spell it exactly, or take it out`) };
  }
  if (!text.includes(SLOT)) return { text, problems: [] };
  if (file !== PRIVACY_FILE) return { text, problems: slotProblems(file, text) };
  const name = rec && validateController(rec).length === 0 ? rec.name : '';
  if (name === '') return { text, problems: [`${PRIVACY_FILE} carries the controller name slot ${SLOT} and ${CONTROLLER_FILE} holds no name: no page ships with a placeholder, so give the name or take the slot out`] };
  return { text: text.split(SLOT).join(name), problems: [] };
}
