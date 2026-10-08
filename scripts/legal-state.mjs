#!/usr/bin/env node
// legal-state: keeps the Thai 7-day clause in TERMS.md in step with legal/legal-state.json.
// Usage: node scripts/legal-state.mjs [--check | --write]      -h / --help prints this and exits 0
//   --check (default) validates the record and compares the TERMS.md block with what the record requires. Exit 0 consistent,
//                     1 a finding (printed, one per line), 2 bad input (a missing file, an unknown flag).
//   --write           renders the block into TERMS.md from the record and the clause file. This is the ONLY way to flip the switch
//                     after a trigger date is entered in the record; the block is never edited by hand.
// Paths are relative to the working directory (the repo root). The logic is in scripts/lib/legal-state.mjs.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { STATE_FILE, CLAUSE_FILE, TERMS_FILE, findings, renderTerms, activeSince } from './lib/legal-state.mjs';

const HELP = 'usage: node scripts/legal-state.mjs [--check | --write]\n  --check  (default) refuse a TERMS.md whose 7-day clause block disagrees with legal/legal-state.json\n  --write  render the block into TERMS.md from the record\n  example: edit legal/legal-state.json (a dated commit), then node scripts/legal-state.mjs --write\n';
function main() {
let mode = 'check';
for (const a of process.argv.slice(2)) {
  if (a === '-h' || a === '--help') { process.stdout.write(HELP); process.exitCode = 0; return; }
  if (a === '--check' || a === '--write') { mode = a.slice(2); continue; }
  process.stderr.write(`legal-state: unknown argument ${JSON.stringify(a)}\n${HELP}`);
  process.exitCode = 2; return;
}
const read = f => (existsSync(f) ? readFileSync(f, 'utf8') : null);
const texts = { record: read(STATE_FILE), clause: read(CLAUSE_FILE), terms: read(TERMS_FILE) };
// A leading BOM is stripped once, so validation and parsing below see the same text (0xFEFF built from the code point, never typed).
if (texts.record !== null && texts.record.charCodeAt(0) === 0xfeff) texts.record = texts.record.slice(1);
for (const [name, text] of [[STATE_FILE, texts.record], [CLAUSE_FILE, texts.clause], [TERMS_FILE, texts.terms]]) {
  if (text === null) { process.stderr.write(`legal-state: cannot read ${name}\n`); process.exitCode = 2; return; }
}

if (mode === 'write') {
  const recordFindings = findings(texts).filter(f => f.kind === 'record' || f.kind === 'markers');
  if (recordFindings.length) { process.stdout.write(recordFindings.map(f => 'legal-state: ' + f.msg).join('\n') + '\n'); process.exitCode = 1; return; }
  const out = renderTerms(texts.terms, texts.clause, JSON.parse(texts.record));
  if (out.text === texts.terms.replace(/\r\n/g, '\n')) process.stdout.write('legal-state: TERMS.md is already current\n');
  else { writeFileSync(TERMS_FILE, out.text); process.stdout.write('legal-state: TERMS.md block rendered from the record\n'); }
} else {
  const fs = findings(texts);
  if (fs.length) { process.stdout.write(fs.map(f => 'legal-state: ' + f.msg).join('\n') + '\n'); process.exitCode = 1; }
  else {
    const since = activeSince(JSON.parse(texts.record));
    process.stdout.write(`legal-state: the record says the clause is ${since ? 'in force since ' + since : 'not in force'} and TERMS.md agrees\n`);
  }
}
}
main();
