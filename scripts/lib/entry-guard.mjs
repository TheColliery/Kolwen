// "Is this module the script node was started with?", by REAL path on both sides (node/runtime.md section 4: realpath-and-contain, `fs.realpathSync.native` so a Windows 8.3 alias, a junction or a
// symlink resolves). Node gives the main module's `import.meta.url` its real path while `process.argv[1]` keeps the path as typed, so a lexical compare (`resolve(argv[1]) === fileURLToPath(import.meta.url)`)
// reads false through a junction or a symlink and the script exits 0 having done nothing, which reads as a pass.
// An argv that does not resolve reads false: an import (argv[1] is another file, or absent) and a path that is not this file run nothing. Node builtins only.
// Use: `if (isMainModule(import.meta.url)) main();`
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const isMainModule = metaUrl => {
  if (!process.argv[1]) return false;
  try { return realpathSync.native(process.argv[1]) === realpathSync.native(fileURLToPath(metaUrl)); } catch { return false; }
};
