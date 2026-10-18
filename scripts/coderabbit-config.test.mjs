// Tests for the repository's own CodeRabbit configuration (.coderabbit.yaml). The file is read by a minimal YAML reader written for the shape the file uses (comments, maps, a list of maps,
// quoted or plain scalars, `|` block scalars; anything else throws), not by a YAML library: the repository has no dependency. The checks:
//   - only schema v2 key paths (the allow-list below was read from https://coderabbit.ai/integrations/schema.v2.json on 2026-10-18);
//   - no double quote and no backslash inside any string value (the settings editor mangles both; the quotes that delimit a scalar are not inside it);
//   - every glob of path_instructions and path_filters matches at least one tracked file, each brace alternative on its own;
//   - no instruction teaches the reviewer to stay quiet (the owner's law on teaching: a fact or a contract, never a suppression).
// Node builtins only. Planted-defect tests run the same checks on a changed copy of the text; the real file is never written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reEscape } from './lib/re-escape.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = readFileSync(join(ROOT, '.coderabbit.yaml'), 'utf8').replace(/\r\n/g, '\n');
const TRACKED = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', timeout: 30000 }).split('\n').filter(Boolean);

// ── the reader ────────────────────────────────────────────────────────────────
// Comments (whole-line) and blank lines are skipped; indentation is spaces only; a value is a double-quoted or single-quoted scalar without escapes, a number, a boolean, a plain string, or `|` (a block scalar).
// A flow collection, an anchor, a tag, a multi-document marker or a tab throws: this reader is for the file as written, not for YAML.
function parseYaml(text) {
  const lines = text.split('\n');
  let i = 0;
  const skip = () => { while (i < lines.length && /^\s*(#.*)?$/.test(lines[i])) i++; };
  const indentOf = line => { if (/^ *\t/.test(line)) throw new Error('yaml: a tab in the indentation: ' + JSON.stringify(line.slice(0, 40))); return /^ */.exec(line)[0].length; };
  const scalar = raw => {
    const v = raw.trim();
    if (/^[{[&*!%@`]/.test(v)) throw new Error('yaml: unsupported value (flow collection, anchor, alias or tag): ' + v.slice(0, 40));
    if (v.startsWith('"') || v.startsWith("'")) {
      if (v.length < 2 || !v.endsWith(v[0])) throw new Error('yaml: a quoted scalar not closed on its line: ' + v.slice(0, 40));
      return v.slice(1, -1);
    }
    if (/\s#/.test(v)) throw new Error('yaml: a trailing comment on a plain value: ' + v.slice(0, 40));
    if (/^-?\d+$/.test(v)) return Number(v);
    if (v === 'true' || v === 'false') return v === 'true';
    return v;
  };
  function blockAt(indent) { // the collection that starts at the next line, if it is indented deeper than `indent`
    skip();
    if (i >= lines.length || indentOf(lines[i]) <= indent) return null;
    const at = indentOf(lines[i]);
    return /^- /.test(lines[i].slice(at)) ? list(at) : map(at);
  }
  function map(indent) {
    const out = {};
    for (skip(); i < lines.length && indentOf(lines[i]) === indent && !/^- /.test(lines[i].slice(indent)); skip()) {
      const m = /^([A-Za-z0-9_.-]+):(?: +(.*))?$/.exec(lines[i].slice(indent));
      if (!m) throw new Error('yaml: not a key line: ' + JSON.stringify(lines[i].slice(0, 60)));
      i++;
      if (m[2] === undefined || m[2] === '') out[m[1]] = blockAt(indent);
      else if (m[2] === '|') {
        const body = [];
        while (i < lines.length && (lines[i].trim() === '' || indentOf(lines[i]) > indent)) body.push(lines[i++]);
        const deep = Math.min(...body.filter(l => l.trim()).map(indentOf));
        out[m[1]] = body.map(l => l.slice(deep)).join('\n').replace(/\n+$/, '\n');
      } else out[m[1]] = scalar(m[2]);
      if (Object.hasOwn(out, m[1]) && out[m[1]] === undefined) throw new Error('yaml: empty value for ' + m[1]);
    }
    return out;
  }
  function list(indent) {
    const out = [];
    for (skip(); i < lines.length && indentOf(lines[i]) === indent && /^- /.test(lines[i].slice(indent)); skip()) {
      const rest = lines[i].slice(indent + 2);
      if (/^[A-Za-z0-9_.-]+:( |$)/.test(rest)) { lines[i] = ' '.repeat(indent + 2) + rest; out.push(map(indent + 2)); } else { i++; out.push(scalar(rest)); }
    }
    return out;
  }
  skip();
  if (/^---|^\.\.\./.test(lines[i] ?? '')) throw new Error('yaml: a document marker is unsupported');
  const doc = map(0);
  skip();
  if (i < lines.length) throw new Error('yaml: unread text at line ' + (i + 1) + ': ' + JSON.stringify(lines[i].slice(0, 60)));
  return doc;
}

// ── the globs ─────────────────────────────────────────────────────────────────
const expandBraces = g => {
  const m = /\{([^{}]*)\}/.exec(g);
  return m ? m[1].split(',').flatMap(alt => expandBraces(g.slice(0, m.index) + alt + g.slice(m.index + m[0].length))) : [g];
};
const globToRegExp = g => {
  let re = '';
  for (let k = 0; k < g.length; k++) {
    if (g.startsWith('**/', k)) { re += '(?:.*/)?'; k += 2; } else if (g.startsWith('**', k)) { re += '.*'; k += 1; } else if (g[k] === '*') re += '[^/]*'; else if (g[k] === '?') re += '[^/]'; else re += reEscape(g[k]);
  }
  return new RegExp('^' + re + '$');
};

// ── the checks ────────────────────────────────────────────────────────────────
// The key paths schema v2 names that this file uses. `[]` marks a list item.
const ALLOWED_KEYS = new Set(['inheritance', 'knowledge_base', 'knowledge_base.learnings', 'knowledge_base.learnings.scope', 'knowledge_base.learnings.approval_delay', 'reviews', 'reviews.profile', 'reviews.path_filters', 'reviews.path_instructions', 'reviews.path_instructions[].path', 'reviews.path_instructions[].instructions']);
// The words of a suppression: an instruction that tells the reviewer to stay quiet, grants an exception or lowers a severity.
const SUPPRESSION = /\b(ignore[ds]?|skip(ped|s)?|suppress(ed|es)?|exempt(ed)?|(do not|don't|need not|never|no need to) (report|flag|raise|mention|suggest|comment)|not a finding|out of scope)\b/i;

function keyPaths(node, prefix, out) {
  if (Array.isArray(node)) { for (const item of node) if (item && typeof item === 'object') keyPaths(item, prefix + '[]', out); }
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) { const p = prefix ? prefix + '.' + k : k; out.push(p); keyPaths(v, p, out); }
  return out;
}
function stringsOf(node, where, out) {
  if (typeof node === 'string') out.push([where, node]);
  else if (Array.isArray(node)) node.forEach((v, n) => stringsOf(v, where + '[' + n + ']', out));
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) stringsOf(v, where + '.' + k, out);
  return out;
}

function problemsOf(text, tracked) {
  const problems = [];
  const doc = parseYaml(text);
  for (const p of keyPaths(doc, '', [])) if (!ALLOWED_KEYS.has(p)) problems.push(`${p}: a key schema v2 does not name here (or one this file does not use)`);
  if (doc.inheritance !== true) problems.push('inheritance: true is missing (without it this file replaces the organization settings)');
  if (doc.knowledge_base?.learnings?.scope !== 'local') problems.push('knowledge_base.learnings.scope must be local');
  if (doc.knowledge_base?.learnings?.approval_delay !== 30) problems.push('knowledge_base.learnings.approval_delay must be 30, the maximum');
  if (doc.reviews?.profile !== 'assertive') problems.push('reviews.profile must be assertive (the measured trial)');
  for (const [where, s] of stringsOf(doc, '', [])) {
    if (s.includes('"')) problems.push(`${where}: a double quote inside a string value`);
    if (s.includes('\\')) problems.push(`${where}: a backslash inside a string value`);
  }
  const globs = [];
  for (const f of doc.reviews?.path_filters ?? []) globs.push(['path_filters', f.replace(/^!/, '')]);
  for (const item of doc.reviews?.path_instructions ?? []) {
    if (typeof item.path !== 'string' || typeof item.instructions !== 'string' || !item.instructions.trim()) problems.push(`path_instructions item ${JSON.stringify(item.path)}: path and instructions are both required strings`);
    globs.push(['path_instructions', item.path]);
    if (/^hooks\//.test(item.path ?? '')) problems.push(`${item.path}: Kolwen has no agent-platform hooks, so the hooks block does not belong here`);
    if (SUPPRESSION.test(item.instructions ?? '')) problems.push(`${item.path}: the instruction reads as a suppression (${SUPPRESSION.exec(item.instructions)[0]}): it must stay a fact or a contract and never tell the reviewer to stay quiet`);
  }
  for (const [kind, glob] of globs) {
    for (const alt of expandBraces(glob)) if (!tracked.some(f => globToRegExp(alt).test(f))) problems.push(`${kind}: ${alt} matches no tracked file`);
  }
  return problems;
}

test('the real .coderabbit.yaml has no problem', () => {
  assert.deepEqual(problemsOf(FILE, TRACKED), []);
});

test('RED PROOF: a double quote or a backslash inside a string value is a problem', () => {
  const quote = FILE.replace('Report a change that breaks any of these:', 'Report a change that "breaks" any of these:');
  assert.notEqual(quote, FILE);
  assert.ok(problemsOf(quote, TRACKED).some(p => /double quote/.test(p)), 'a planted double quote');
  const slash = FILE.replace('node scripts/legal-pages.mjs --write', 'node scripts\\legal-pages.mjs --write');
  assert.notEqual(slash, FILE);
  assert.ok(problemsOf(slash, TRACKED).some(p => /backslash/.test(p)), 'a planted backslash');
});

test('RED PROOF: a glob that matches no tracked file is a problem, also one alternative of a brace', () => {
  const dead = FILE.replace('path: "brand/**"', 'path: "brandx/**"');
  assert.notEqual(dead, FILE);
  assert.ok(problemsOf(dead, TRACKED).some(p => /brandx\/\*\*.*matches no tracked file/.test(p)));
  const half = FILE.replace('{wrangler.jsonc,package.json,package-lock.json}', '{wrangler.jsonc,package.json,nope.lock}');
  assert.notEqual(half, FILE);
  assert.ok(problemsOf(half, TRACKED).some(p => /nope\.lock.*matches no tracked file/.test(p)));
  const filter = FILE.replace('"!**/*.png"', '"!**/*.gif"');
  assert.notEqual(filter, FILE);
  assert.ok(problemsOf(filter, TRACKED).some(p => /\*\.gif.*matches no tracked file/.test(p)));
});

test('RED PROOF: an instruction that tells the reviewer to stay quiet is a problem', () => {
  for (const phrase of ['Ignore this file.', 'Skip the generated pages.', 'Do not report a hand edit.', "Don't flag a long line.", 'Suppress this class.', 'Do not suggest a change here.', 'This file is exempt from review.']) {
    const planted = FILE.replace('Report a change that breaks any of these:', phrase + ' Report a change that breaks any of these:');
    assert.notEqual(planted, FILE);
    assert.ok(problemsOf(planted, TRACKED).some(p => /stay quiet|suppression/.test(p)), phrase);
  }
});

test('RED PROOF: a key the schema does not name is a problem, and so is a hooks block and a missing posture key', () => {
  assert.ok(problemsOf(FILE.replace('inheritance: true', 'inheritance: true\ntone_instructions: be kind'), TRACKED).some(p => /tone_instructions/.test(p)), 'a top-level key');
  assert.ok(problemsOf(FILE.replace('  profile: assertive', '  profile: assertive\n  poem_mode: true'), TRACKED).some(p => /reviews\.poem_mode/.test(p)), 'a key under reviews');
  assert.ok(problemsOf(FILE.replace('path: "brand/**"', 'path: "brand/**"\n      note: x'), TRACKED).some(p => /path_instructions\[\]\.note/.test(p)), 'a key in an item');
  assert.ok(problemsOf(FILE.replace('path: "brand/**"', 'path: "hooks/**"'), TRACKED).some(p => /hooks/.test(p)), 'Kolwen has no hooks block');
  assert.ok(problemsOf(FILE.replace('inheritance: true\n', ''), TRACKED).some(p => /inheritance/.test(p)), 'inheritance stays');
  assert.ok(problemsOf(FILE.replace('approval_delay: 30', 'approval_delay: 0'), TRACKED).some(p => /approval_delay/.test(p)), 'the maximum approval delay stays');
  assert.ok(problemsOf(FILE.replace('\n  profile: assertive', '\n  profile: chill'), TRACKED).some(p => /reviews\.profile/.test(p)), 'the trial profile stays');
});

test('the YAML reader refuses what it was not written for', () => {
  assert.throws(() => problemsOf('reviews:\n\tprofile: x\n', TRACKED), /tab/);
  assert.throws(() => problemsOf('reviews: {profile: x}\n', TRACKED), /flow|unsupported/);
  assert.throws(() => problemsOf('a: &x 1\n', TRACKED), /anchor|unsupported/);
});
