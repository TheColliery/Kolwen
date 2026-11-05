// The Wrangler source-map key, read from the text of wrangler.jsonc. JSONC comments are removed first, a string is kept whole, so a comment that names the key does not
// satisfy the rule. Trailing commas, which JSONC allows, are removed; the result is parsed, so the key is read at the TOP LEVEL, where Wrangler reads it: a key nested in
// previews, env or assets does not count, and a duplicate key takes its last value, as JSON.parse does. Zero-dependency.

// Comments out, strings kept whole: a `//` or `/*` inside a string is text, not a comment.
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
      out += ' ';
      i = e < 0 ? n : e;
    } else if (c === '/' && text[i + 1] === '*') {
      const e = text.indexOf('*/', i + 2);
      if (e < 0) throw new Error('unterminated comment');
      out += ' ';
      i = e + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// A comma before a closing brace or bracket, outside a string. Comments are already gone, so only whitespace can sit between the comma and the closer.
function withoutTrailingCommas(text) {
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
    } else if (c === ',') {
      let k = i + 1;
      while (k < n && /\s/.test(text[k])) k++;
      if (text[k] !== '}' && text[k] !== ']') out += c;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// The problem with the key, or null when it is present at the top level and is the boolean true.
export function sourceMapsProblem(text) {
  let cfg;
  try {
    cfg = JSON.parse(withoutTrailingCommas(jsoncWithoutComments(text)));
  } catch {
    // The parser's own message is not quoted: it can echo the file's content, and this line reaches a report.
    return 'wrangler.jsonc does not parse as JSON once comments and trailing commas are removed, so upload_source_maps cannot be read';
  }
  if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) {
    return 'wrangler.jsonc is not a JSON object, so upload_source_maps cannot be read';
  }
  if (!Object.hasOwn(cfg, 'upload_source_maps')) {
    return 'upload_source_maps is absent at the top level, so a source map that cannot be resolved is skipped at deploy, not failed';
  }
  const value = cfg.upload_source_maps;
  if (value === true) return null;
  if (value === false) return 'upload_source_maps is false at the top level: no source map is uploaded';
  return `upload_source_maps is ${value !== null && typeof value === 'object' ? (Array.isArray(value) ? 'an array' : 'an object') : JSON.stringify(value)} at the top level, not true: a source map that cannot be resolved is skipped at deploy`;
}
