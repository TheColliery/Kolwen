// How the test of scripts/rendered-check.test.mjs finds a script that starts itself, and which spellings it refuses (PR #56 round 2, Q-8c: `process.argv.at(1)` and `import.meta.url.endsWith(...)`
// both passed the first scan). A script may start itself only through isMainModule(import.meta.url) (scripts/lib/entry-guard.mjs); every other way to learn "which file is the main module" is read as a
// guard of its own. The refused spellings are the text of the source with its comments removed: `import.meta.main` and `import.meta.filename`; a test or compare on `import.meta.url` (a method of the
// string, `==` or `===` and their negations, directly or through fileURLToPath); and any use of `process.argv` other than an argument. An argument read is `argv[N]` for N of 2 or more, `argv.slice(N)` for
// N of 2 or more with nothing after the number but `,` or `)` (so `slice(2 - 1)` is refused), `argv.length`, `argv.includes('literal')` and `argv.indexOf('literal')` (a literal asks for a flag; a name could
// be the script's own path, so the argument is ONE complete literal, a quoted string or a template with no `${`, and nothing joined to it; inside a literal a backslash and the character after it are
// consumed as one pair, so an escaped quote does not end the literal and an escaped `${` is not an interpolation: PR #62 round 1, CodeRabbit 4322398861), and a destructuring that skips the first two places
// (`const [, , ...args] = process.argv`). `argv[0]`, `argv[1]`, `.at(`, `slice(0|1`, a destructuring that takes the second place, and `process['argv']` stay refused.
// STATED LIMITS: this reads text (see the test that uses it for the forms it cannot see).
// Node builtins only. Every pattern is written to run in time linear in its input: a character class that cannot cross the delimiter it waits for (`[^{}]`, `[^\][]`), no two adjacent quantifiers over
// the same characters, and no regular expression over a comment that may never close (stripComments searches with indexOf). A test runs them on bulk input under a kill-timeout.
export function stripComments(src) {
  let out = '', i = 0;
  for (;;) {
    const open = src.indexOf('/*', i);
    const close = open === -1 ? -1 : src.indexOf('*/', open + 2);
    if (close === -1) break; // no comment, or one that never closes: the rest stays as written
    out += src.slice(i, open);
    i = close + 2;
  }
  return (out + src.slice(i)).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}
const SKIP_TWO = /\[\s*,\s*,[^\][]*\]\s*=\s*process\s*\.\s*argv\b/g; // a destructuring that never takes the first two places
const OWN_PATH_SPELLINGS = [
  /\bimport\.meta\.(?:main|filename)\b/,
  /\bimport\.meta\.url\s*\.\s*(?:endsWith|startsWith|includes|match|test|indexOf|search|slice|substring)\b/,
  /\bimport\.meta\.url\s*[!=]==?|[!=]==?\s*import\.meta\.url\b/,
  /\bfileURLToPath\(\s*import\.meta\.url\s*\)\s*[!=]==?|[!=]==?\s*fileURLToPath\(\s*import\.meta\.url\s*\)/,
  /\bprocess\s*\.\s*argv\b(?!\s*\[\s*(?:[2-9]|[1-9][0-9]+)\s*\]|\s*\.\s*slice\(\s*(?:[2-9]|[1-9][0-9]+)(?=\s*[,)])|\s*\.\s*length\b|\s*\.\s*(?:includes|indexOf)\(\s*(?:'(?:\\[^\n]|[^'\\\n])*'|"(?:\\[^\n]|[^"\\\n])*"|`(?:\\[^\n]|(?!\$\{)[^`\\\n])*`)\s*[,)])/,
  /\bprocess\s*\[\s*['"`]argv['"`]\s*\]/,
  /\{\s*(?:[\w$]+(?:\s*:\s*[\w$]+)?\s*,\s*)*argv\b[^{}]*\}\s*=\s*process\b/,
];
export const readsOwnPath = src => {
  const text = stripComments(src).replace(SKIP_TWO, ' ');
  return OWN_PATH_SPELLINGS.some(re => re.test(text));
};
export const startsItself = src => readsOwnPath(src) || /isMainModule\(import\.meta\.url\)/.test(stripComments(src));
