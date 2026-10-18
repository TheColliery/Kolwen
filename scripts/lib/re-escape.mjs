// A literal string as a regex source: every RegExp metacharacter is escaped, the backslash included, in one pass (the one helper for the tests; a hand-built `.replace(/[.]/g, ...)` misses the backslash and CodeQL's js/incomplete-sanitization says so).
export const reEscape = text => text.replace(/[\\^$.*+?()[\]{}|\/-]/g, m => '\\' + m);
