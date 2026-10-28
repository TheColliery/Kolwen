// One field of a line-oriented report, escaped. Text this run did not write (a reply, a page's language value, a browser's message) can carry a line break or a terminal
// control, and written as it came it would start a second report line, or print a control sequence into the terminal. JSON's string escaping turns CR, LF and every other C0
// control into a visible escape and keeps the field on its own line; the quotes and backslashes it escapes too are part of the same rule. The caller escapes the field, never
// the whole line, so the report's own newlines stay. Node builtins only (node/runtime.md section 1).
export const reportField = value => JSON.stringify(String(value)).slice(1, -1);
