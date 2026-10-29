// One field of a line-oriented report, escaped. Text this run did not write (a reply, a page's language value, a browser's message) can carry a line break or a terminal
// control, and written as it came it would start a second report line, or print a control sequence into the terminal. JSON's string escaping turns CR, LF and every other C0
// control into a visible escape and keeps the field on its own line; the quotes and backslashes it escapes too are part of the same rule. JSON leaves the line and paragraph
// separators, DEL and the C1 controls raw, so those are escaped to their six-character form after it. The caller escapes the field, never the whole line, so the report's own
// newlines stay. The separators and the backslash are built from code points, so no escape in this file depends on how a tool passes it. Node builtins only (node/runtime.md section 1).
const BACKSLASH = String.fromCharCode(92);
const RAW = new RegExp('[\\x7f-\\x9f' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');
export const reportField = value => JSON.stringify(String(value)).slice(1, -1).replace(RAW, c => BACKSLASH + 'u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
