// A literal string as a regex source: every RegExp metacharacter is escaped, the backslash included, in one pass (the one helper for the tests; a hand-built `.replace(/[.]/g, ...)` misses the backslash and CodeQL's js/incomplete-sanitization says so).
// No hyphen: outside a character class it needs no escape, and a backslash before it is a SyntaxError under the u and v flags. `RegExp.escape` is not used, because the Node 22 floor lacks it.
export const reEscape = text => text.replace(/[\\^$.*+?()[\]{}|\/]/g, m => '\\' + m);
