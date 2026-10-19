// The WSL route of the rendered check. On Windows this check never starts a Windows browser: it runs the Blink headless shell INSIDE a WSL distro, at its STABLE path
// (~/tools/chrome-headless-shell-linux64/chrome-headless-shell, never a versioned folder; the machine's updater repoints the stable link), from the script scripts/wsl/browser-run.sh.
//
// WHY A SCRIPT FILE AND ARGV. Everything that crosses into the distro is a file in the repo (scripts/wsl/*.sh) started as `wsl.exe -d <distro> --exec bash <path> <args>`: the arguments are
// argv, never a string a shell parses, and nothing is ever typed into an inline `wsl.exe bash -lc '...'` (an inline one with an unset variable once deleted a person's WSL home). The only
// delete in the whole route is the script's own, of the mktemp folder it made, behind an asserted path (see browser-run.sh).
//
// WHAT WAS MEASURED, so the shape is not a guess: the distro had no node, so the check cannot run itself inside it; a server on Windows 127.0.0.1 is not reachable from the distro (NAT: 127.0.0.1
// refused, the host gateway timed out); a port the browser binds inside the distro IS reachable from Windows on 127.0.0.1 (WSL's localhost forwarding). So the browser and its profile live in
// the distro, Windows drives it over DevTools, and the pages travel over that same channel (Fetch.fulfillRequest, scripts/lib/browser.mjs) from the one Node responder.
// Node builtins only.
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

// The program the route starts is ONE file: <SystemRoot>/System32/wsl.exe, built from %windir% (then %SystemRoot%, then C:/Windows: Windows sets both to one folder) and from nothing a caller names. There is no knob for another
// program: an earlier KOLWEN_WSL_EXE checked only that the name ended in wsl.exe, so a renamed copy of any program passed (measured: a node.exe saved as <dir>/wsl.exe was started). A test that needs
// WSL absent points windir at an empty folder (not SystemRoot: a node process started with a wrong SystemRoot aborts, exit 134, measured), and one that needs a stand-in for its answers injects the
// runner (findWslRoute's run). Limit: the environment is the person's own, so a windir they point at a folder of their making starts what they put there; this check defends against a mistaken name, not against the account that runs it.
export function systemWslExe(env = process.env) {
  const root = env.windir || env.SystemRoot || 'C:\\Windows';
  return win32.join(root, 'System32', 'wsl.exe');
}
export const STABLE_SHELL = '~/tools/chrome-headless-shell-linux64/chrome-headless-shell';
export const WSL_SCRIPTS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'wsl');

// A Windows path as the distro sees it (/mnt/<drive>/...), or null for a path it cannot see (a UNC path, a relative path).
export function toWslPath(winPath) {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(String(winPath));
  if (!m) return null;
  return '/mnt/' + m[1].toLowerCase() + '/' + m[2].split(/[\\/]+/).filter(Boolean).join('/');
}

// What wsl.exe prints for itself (the distro list) is UTF-16 little-endian; what a Linux program prints is UTF-8. Both come back as text, with no byte-order mark.
export function decodeWslText(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf ?? ''));
  let text = b.includes(0) ? new TextDecoder('utf-16le').decode(b) : b.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text.replace(/\0/g, '');
}

// Run the System32 wsl.exe with an argument list (never a shell string). `run` is injectable (findWslRoute) so a test needs no WSL.
export function wslRun(args, env = process.env) {
  const r = spawnSync(systemWslExe(env), args, { timeout: 60000, windowsHide: true });
  return { status: r.status, stdout: r.stdout ?? Buffer.alloc(0), error: r.error ?? null };
}

// The route: { kind: 'wsl', distro } when the distro exists AND the headless shell is executable at the stable path, otherwise { kind: 'none', why } saying which of the two is missing.
// `distro` asks for one by name (KOLWEN_BROWSER=wsl:<name>); without it the first distro that is not Docker's is used.
export function findWslRoute({ env = process.env, run = wslRun, distro = null, scriptsDir = WSL_SCRIPTS } = {}) {
  const listed = run(['-l', '-q'], env);
  if (listed.error || listed.status !== 0) return { kind: 'none', why: `WSL is not available here (wsl.exe ${listed.error ? 'could not be started: ' + (listed.error.code ?? listed.error.message) : 'exited ' + listed.status})` };
  const names = decodeWslText(listed.stdout).split(/\r?\n/).map(s => s.trim()).filter(s => s && !/^docker-desktop/i.test(s));
  const name = distro ? names.find(n => n === distro) : names[0];
  if (!name) return { kind: 'none', why: distro ? `WSL has no distro named ${distro}` : 'WSL has no distro' };
  const probe = toWslPath(join(scriptsDir, 'probe.sh'));
  if (!probe) return { kind: 'none', why: `the repository is not on a drive the distro can see (${scriptsDir})` };
  const probed = run(['-d', name, '--exec', 'bash', probe], env);
  if (probed.error || !/kolwen-wsl: OK/.test(decodeWslText(probed.stdout))) return { kind: 'none', why: `the headless shell is not executable at ${STABLE_SHELL} in the WSL distro ${name}` };
  return { kind: 'wsl', distro: name };
}

// Start the browser script in the distro. Returns { child, output(), exited(), kill() }; output() is what the script and the browser printed so far.
export function startWslBrowser({ distro, port, lifetimeS, scriptsDir = WSL_SCRIPTS, env = process.env }) {
  const script = toWslPath(join(scriptsDir, 'browser-run.sh'));
  if (!script) throw new Error(`the repository is not on a drive the distro can see (${scriptsDir})`);
  const child = spawn(systemWslExe(env), ['-d', distro, '--exec', 'bash', script, String(port), String(lifetimeS)], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let text = '', done = false, spawnError = null;
  const take = d => { if (text.length < 20000) text += decodeWslText(d); };
  child.stdout.on('data', take);
  child.stderr.on('data', take);
  child.on('exit', () => { done = true; });
  child.on('error', e => { spawnError = e; done = true; });
  return { child, output: () => text, exited: () => done, spawnError: () => spawnError, kill: () => { try { child.kill(); } catch { /* gone already */ } } };
}

// The lines of a script's output that are its own report (kolwen-wsl: ...), for a diagnosis.
export const scriptLines = text => String(text).split(/\r?\n/).filter(l => l.startsWith('kolwen-wsl:')).map(l => l.slice(12));
