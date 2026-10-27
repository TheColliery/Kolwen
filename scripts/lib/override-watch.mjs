// The watch on package.json's `overrides`. An override holds a dependency at one version for every dependent, whatever that dependent asks for, and nothing removes it
// when its reason ends. Once the dependent declares that version or a later one, the override only forces the dependency BELOW the dependent's own pin, silently.
// This reads each override's dependent pin from the lockfile and reports every override the dependent already meets or passes. A pin that is not an exact
// x.y.z version is reported as unread, never as clear: a range cannot be judged, so a person reads it. So is an override whose dependent is missing from the
// lockfile, or does not name the package: nothing then says what the dependent declares, and an unread override is never a clear one.
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

// { stale: [{ name, override, pin }], unread: [{ name, override, pin, reason }] } for the overrides of pkgText, read against the dependent's declared pins in lockText.
export function staleOverrides(pkgText, lockText, dependent = DEPENDENT) {
  const overrides = JSON.parse(pkgText).overrides || {};
  const entry = JSON.parse(lockText).packages[dependent];
  // The pins the dependent declares, read from every map a lockfile entry carries them in. npm lets an optionalDependencies entry replace the same name in dependencies,
  // so the optional pin is read last and wins.
  const declared = entry ? { ...entry.peerDependencies, ...entry.dependencies, ...entry.optionalDependencies } : {};
  const stale = [], unread = [];
  for (const [name, override] of Object.entries(overrides)) {
    if (!entry) { unread.push({ name, override, pin: undefined, reason: `the lockfile has no entry for ${dependent}, so nothing says what it declares` }); continue; }
    const pin = declared[name];
    if (pin === undefined) { unread.push({ name, override, pin, reason: `${dependent} does not name ${name}, so the override holds a package it does not pin` }); continue; }
    const c = compare(pin, override);
    if (c === null) unread.push({ name, override, pin, reason: `the pin ${pin} is not an exact version` });
    else if (c >= 0) stale.push({ name, override, pin });
  }
  return { stale, unread };
}
