// The watch on package.json's `overrides`. An override holds a dependency at one version for every dependent, whatever that dependent asks for, and nothing removes it
// when its reason ends. Once the dependent declares that version or a later one, the override only forces the dependency BELOW the dependent's own pin, silently.
// This reads each override's dependent pin from the lockfile and reports every override the dependent already meets or passes. A pin that is not an exact
// x.y.z version is reported as unread, never as clear: a range cannot be judged, so a person reads it.
// The dependent is the package the overrides work around (miniflare, the pin Wrangler resolves; docs/DEPLOY.md keeps the table).
export const DEPENDENT = 'node_modules/miniflare';

const EXACT = /^(\d+)\.(\d+)\.(\d+)$/;
// The difference of two exact versions, negative when a is older; null when either is not exact.
function compare(a, b) {
  const x = EXACT.exec(a), y = EXACT.exec(b);
  if (!x || !y) return null;
  for (let i = 1; i <= 3; i++) { const d = Number(x[i]) - Number(y[i]); if (d) return d; }
  return 0;
}

// { stale: [{ name, override, pin }], unread: [{ name, override, pin }] } for the overrides of pkgText, read against the dependent's declared pins in lockText.
export function staleOverrides(pkgText, lockText, dependent = DEPENDENT) {
  const overrides = JSON.parse(pkgText).overrides || {};
  const declared = (JSON.parse(lockText).packages[dependent] || {}).dependencies || {};
  const stale = [], unread = [];
  for (const [name, override] of Object.entries(overrides)) {
    const pin = declared[name];
    if (pin === undefined) continue; // the dependent does not name this package at all: nothing to compare
    const c = compare(pin, override);
    if (c === null) unread.push({ name, override, pin });
    else if (c >= 0) stale.push({ name, override, pin });
  }
  return { stale, unread };
}
