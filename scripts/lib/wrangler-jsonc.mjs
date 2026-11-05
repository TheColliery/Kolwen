// The Wrangler source-map key, read from the text of wrangler.jsonc. JSONC comments are removed first, a string is kept whole, so a comment that names the key does not
// satisfy the rule. The key must be the boolean true: a string, a number or false is a problem.
export function jsoncWithoutComments(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && text[i + 1] === '/') {
      const e = text.indexOf('\n', i);
      i = e < 0 ? n : e;
    } else if (c === '/' && text[i + 1] === '*') {
      const e = text.indexOf('*/', i + 2);
      i = e < 0 ? n : e + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// The problem with the key, or null when it is present and true.
export function sourceMapsProblem(text) {
  const m = jsoncWithoutComments(text).match(/"upload_source_maps"\s*:\s*(\S+?)\s*[,}]/);
  if (!m) return 'upload_source_maps is absent, so a source map that cannot be resolved is skipped at deploy, not failed';
  if (m[1] !== 'true') return `upload_source_maps is ${m[1]}, not true: a source map that cannot be resolved is skipped at deploy`;
  return null;
}
