// Tests for the repository's own CodeRabbit configuration (.coderabbit.yaml). The file is read by a minimal YAML reader written for the shape the file uses (comments, maps, a list of maps,
// quoted or plain scalars, `|` block scalars; anything else throws), not by a YAML library: the repository has no dependency. The checks:
//   - only schema v2 key paths (the allow-list below was read from https://coderabbit.ai/integrations/schema.v2.json on 2026-10-18);
//   - no double quote and no backslash inside any string value (the settings editor mangles both; the quotes that delimit a scalar are not inside it);
//   - every glob of path_instructions and path_filters matches at least one tracked file, each brace alternative on its own;
//   - no instruction teaches CodeRabbit to stay quiet (the owner's law on teaching: a fact or a contract, never a suppression);
//   - path_filters hide only files git marks as binary (i/-text), and every surface-check rule number an instruction or a comment line cites (in a list, or as a bare "rule N") exists in scripts/surface-check.mjs.
// LIMIT, stated so the file does not read as a guard it is not: the suppression check is a word list. It catches the plain forms (ignore, skip, do not report, exempt ...) and NOT a paraphrase (a sentence that
// calls a class of findings expected, by design or low priority). The real check of the teaching law is a read of every instruction by a person; and a citation that exists can still be a wrong claim about what the rule checks.
// Node builtins only. Planted-defect tests run the same checks on a changed copy of the text; the real file is never written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reEscape } from './lib/re-escape.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = readFileSync(join(ROOT, '.coderabbit.yaml'), 'utf8').replace(/\r\n/g, '\n');
// The one place this file starts a child: git, with a kill timeout and its own HOME, USERPROFILE, TEMP, TMP and TMPDIR under os.tmpdir() (removed when the tests end) and no system git config, so it reads neither the
// real home nor the real temp folder. (Git's safe.directory check reads the global config; the repository belongs to the user who runs the tests, so the empty sandbox config is enough.)
const SANDBOX = mkdtempSync(join(tmpdir(), 'cr-config-'));
test.after(() => rmSync(SANDBOX, { recursive: true, force: true }));
const sandboxEnv = (home = SANDBOX) => ({ ...process.env, HOME: home, USERPROFILE: home, TEMP: home, TMP: home, TMPDIR: home, GIT_CONFIG_NOSYSTEM: '1' });
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', timeout: 30000, env: sandboxEnv() }).split('\n').filter(Boolean);
const TRACKED = git('ls-files');
// Files git marks as binary in the index (`i/-text`): the only files a path_filter may hide.
const BINARY = new Set(git('ls-files', '--eol').filter(l => l.startsWith('i/-text')).map(l => l.slice(l.indexOf('\t') + 1)));
// The numbers of the rules scripts/surface-check.mjs defines (its `// ── 13b. ...` headers).
const SURFACE_RULES = new Set([...readFileSync(join(ROOT, 'scripts/surface-check.mjs'), 'utf8').matchAll(/^\/\/ ── (\d+[a-z]?)\./gm)].map(m => m[1]));

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
const ALLOWED_KEYS = new Set(['inheritance', 'knowledge_base', 'knowledge_base.learnings', 'knowledge_base.learnings.scope', 'knowledge_base.learnings.approval_delay', 'knowledge_base.code_guidelines', 'knowledge_base.code_guidelines.enabled', 'reviews', 'reviews.profile', 'reviews.path_filters', 'reviews.path_instructions', 'reviews.path_instructions[].path', 'reviews.path_instructions[].instructions']);
// The words of a suppression: an instruction that tells CodeRabbit to stay quiet, grants an exception or lowers a severity.
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

function problemsOf(text, tracked, binary = BINARY) {
  const problems = [];
  const doc = parseYaml(text);
  for (const p of keyPaths(doc, '', [])) if (!ALLOWED_KEYS.has(p)) problems.push(`${p}: a key schema v2 does not name here (or one this file does not use)`);
  if (doc.inheritance !== true) problems.push('inheritance: true is missing (without it this file replaces the organization settings)');
  if (doc.knowledge_base?.learnings?.scope !== 'local') problems.push('knowledge_base.learnings.scope must be local');
  if (doc.knowledge_base?.learnings?.approval_delay !== 30) problems.push('knowledge_base.learnings.approval_delay must be 30, the maximum');
  if (doc.knowledge_base?.code_guidelines?.enabled !== false) problems.push('knowledge_base.code_guidelines.enabled must be false (CodeRabbit never reads the product under review as its own rule)');
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
    if (SUPPRESSION.test(item.instructions ?? '')) problems.push(`${item.path}: the instruction reads as a suppression (${SUPPRESSION.exec(item.instructions)[0]}): it must stay a fact or a contract and never tell CodeRabbit to stay quiet`);
  }
  for (const [kind, glob] of globs) {
    for (const alt of expandBraces(glob)) if (!tracked.some(f => globToRegExp(alt).test(f))) problems.push(`${kind}: ${alt} matches no tracked file`);
  }
  // a filter hides files from review, so it may hide only what CodeRabbit cannot read
  for (const [kind, glob] of globs) {
    if (kind !== 'path_filters') continue;
    for (const alt of expandBraces(glob)) for (const f of tracked) if (globToRegExp(alt).test(f) && !binary.has(f)) problems.push(`path_filters: ${alt} hides ${f}, which is a text file: a filter may hide only a binary file`);
  }
  // a cited rule must exist. Read: every instruction that names surface-check, and every comment line that names it (the parsed document does not hold comments); in each, every number after "rule" or "rules",
  // every item of a list ("rules 1, 2 and 17"), also a bare "and rule 5" that does not repeat the word surface-check.
  const citing = [];
  for (const item of doc.reviews?.path_instructions ?? []) if (/surface-check/i.test(item.instructions ?? '')) citing.push([item.path, item.instructions]);
  for (const line of text.split('\n')) if (/^\s*#/.test(line) && /surface-check/i.test(line)) citing.push(['a comment line', line]);
  for (const [where, words] of citing) {
    for (const cite of words.matchAll(/\brules?\s+(\d+[a-z]?(?:(?:, and |, | and )\d+[a-z]?)*)/gi)) {
      for (const n of cite[1].split(/, and |, | and /)) if (!SURFACE_RULES.has(n)) problems.push(`${where}: cites surface-check rule ${n}, which scripts/surface-check.mjs does not define`);
    }
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

test('RED PROOF: an instruction that tells CodeRabbit to stay quiet is a problem', () => {
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
  assert.ok(problemsOf(FILE.replace('path: "brand/**"', 'path: "hooks/**"'), TRACKED).some(p => /no agent-platform hooks/.test(p)), 'Kolwen has no hooks block, named by the hooks check and not by the dead-glob check');
  assert.ok(problemsOf(FILE.replace('inheritance: true\n', ''), TRACKED).some(p => /inheritance/.test(p)), 'inheritance stays');
  assert.ok(problemsOf(FILE.replace('approval_delay: 30', 'approval_delay: 0'), TRACKED).some(p => /approval_delay/.test(p)), 'the maximum approval delay stays');
  assert.ok(problemsOf(FILE.replace('\n  profile: assertive', '\n  profile: chill'), TRACKED).some(p => /reviews\.profile/.test(p)), 'the trial profile stays');
  assert.ok(problemsOf(FILE.replace('enabled: false', 'enabled: true'), TRACKED).some(p => /code_guidelines\.enabled must be false/.test(p)), 'code guidelines stay off');
  assert.ok(problemsOf(FILE.replace('  code_guidelines:\n    enabled: false\n', ''), TRACKED).some(p => /code_guidelines\.enabled must be false/.test(p)), 'and the key is required');
  assert.equal((FILE.match(/^knowledge_base:/gm) ?? []).length, 1, 'one knowledge_base key: a second one would replace the first');
});

test('RED PROOF: a filter that hides a text file is a problem, and so is a citation of a surface-check rule that does not exist', () => {
  const text = FILE.replace('"!**/*.png"', '"!web/**"');
  assert.notEqual(text, FILE);
  assert.ok(problemsOf(text, TRACKED).some(p => /path_filters: web\/\*\* hides web\/index\.html, which is a text file/.test(p)));
  assert.ok(problemsOf(FILE.replace('"!**/*.png"', '"!**/*.svg"'), TRACKED).some(p => /hides .*\.svg, which is a text file/.test(p)), 'an SVG is text');
  const cites = (from, to, n) => {
    const planted = FILE.replace(from, to);
    assert.notEqual(planted, FILE, from);
    assert.ok(problemsOf(planted, TRACKED).some(p => new RegExp(`cites surface-check rule ${n}, which scripts/surface-check\\.mjs does not define`).test(p)), `${from} -> ${to}`);
  };
  // each plant is its own assertion, so a detector that fails on one shape cannot hide behind another
  cites('Surface-check rule 13 fails on', 'Surface-check rule 99 fails on', '99');
  cites('surface-check rule 13b', 'surface-check rule 98b', '98b');
  assert.ok(SURFACE_RULES.has('13b') && SURFACE_RULES.has('5') && !SURFACE_RULES.has('14'), 'the rule numbers are read from the file');
  assert.ok(BINARY.has('web/og.png') && BINARY.has('brand/kolwen-wordmark.png') && !BINARY.has('web/favicon.svg'), 'binary means git i/-text');
});

// Every cited number counts, wherever it stands: in a list at any position, behind the words surface-check or only behind rule (the same sentence cites a second rule with a bare "and rule N"), and in a comment line of the file.
test('RED PROOF: every surface-check rule number cited is checked, in a list at any position, in a bare "rule N", and in a comment line', () => {
  const cites = (from, to, n) => {
    const planted = FILE.replace(from, to);
    assert.notEqual(planted, FILE, from);
    assert.ok(problemsOf(planted, TRACKED).some(p => new RegExp(`cites surface-check rule ${n}, which scripts/surface-check\\.mjs does not define`).test(p)), `${from} -> ${to}`);
  };
  cites('surface-check rules 1, 2 and 17', 'surface-check rules 1, 2 and 71', '71'); // the last of a list
  cites('surface-check rules 1, 2 and 17', 'surface-check rules 1, 72 and 17', '72'); // the middle of a list
  cites('surface-check rules 1, 2 and 17', 'surface-check rules 73, 2 and 17', '73'); // the first of a list
  cites('surface-check rules 7 and 13.', 'surface-check rules 7 and 74.', '74'); // a comment line, the last of a list
  cites('and rule 13 checks both', 'and rule 99 checks both', '99'); // no surface-check words before it
  cites('and rule 5 asserts', 'and rule 55 asserts', '55');
  cites('surface-check rules 10 and 19.', 'surface-check rules 10 and 91.', '91'); // a comment line, which the parsed document does not hold
  cites('(rules 1, 2, 4, 5 and 17)', '(rules 1, 2, 4, 5 and 76)', '76'); // a comment line naming surface-check.mjs, a list of five
  assert.deepEqual(problemsOf(FILE, TRACKED), [], 'and the real file cites only rules the script defines');
});

test('RED PROOF: the one git child of this file has its own HOME, TEMP and TMP under os.tmpdir() and no system config, and nothing else starts a child', () => {
  const env = sandboxEnv();
  for (const v of ['HOME', 'USERPROFILE', 'TEMP', 'TMP', 'TMPDIR']) assert.equal(env[v], SANDBOX, v);
  assert.ok(SANDBOX.startsWith(tmpdir()) && SANDBOX !== process.env.HOME && SANDBOX !== process.env.USERPROFILE, 'under os.tmpdir(), not the real home');
  assert.equal(env.GIT_CONFIG_NOSYSTEM, '1');
  const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const starts = source.split('execFile' + 'Sync(').length - 1;
  assert.equal(starts, 1, `a child is started in one place only, git() (found ${starts} call sites)`);
  assert.ok(/execFileSync\('git', args, \{[^}]*env: sandboxEnv\(\)/.test(source), 'and that call passes the sandboxed environment');
});

test('the YAML reader refuses what it was not written for', () => {
  assert.throws(() => problemsOf('reviews:\n\tprofile: x\n', TRACKED), /tab/);
  assert.throws(() => problemsOf('reviews: {profile: x}\n', TRACKED), /flow|unsupported/);
  assert.throws(() => problemsOf('a: &x 1\n', TRACKED), /anchor|unsupported/);
});
