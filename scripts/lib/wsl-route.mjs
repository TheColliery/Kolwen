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
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WSL_EXE_ENV = 'KOLWEN_WSL_EXE'; // the program to start instead of wsl.exe: only one NAMED wsl.exe (a test makes it a path that does not exist, or a stand-in), never any other program
const WSL_NAME = /(^|[\\/])wsl\.exe$/i; // the last path segment is wsl.exe (any case, either separator); a trailing separator, or any other name, is not it

// The program that stands for wsl.exe: { exe } when it is named wsl.exe, otherwise { exe, why } and nothing may start it (KOLWEN_WSL_EXE=msedge.exe would start a person's Edge).
export function wslExe(env = process.env) {
  const exe = env[WSL_EXE_ENV] || 'wsl.exe';
  return WSL_NAME.test(exe) ? { exe } : { exe, why: `${WSL_EXE_ENV} names ${exe}, which is not wsl.exe: this check starts no other program there` };
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

// Run wsl.exe with an argument list (never a shell string). `run` is injectable so a test needs no WSL.
export function wslRun(args, env = process.env) {
  const w = wslExe(env);
  if (w.why) return { status: null, stdout: Buffer.alloc(0), error: new Error(w.why) };
  const r = spawnSync(w.exe, args, { timeout: 60000, windowsHide: true });
  return { status: r.status, stdout: r.stdout ?? Buffer.alloc(0), error: r.error ?? null };
}

// The route: { kind: 'wsl', exe, distro } when the distro exists AND the headless shell is executable at the stable path, otherwise { kind: 'none', why } saying which of the two is missing.
// `distro` asks for one by name (KOLWEN_BROWSER=wsl:<name>); without it the first distro that is not Docker's is used.
export function findWslRoute({ env = process.env, run = wslRun, distro = null, scriptsDir = WSL_SCRIPTS } = {}) {
  const { exe, why } = wslExe(env);
  if (why) return { kind: 'refused', why };
  const listed = run(['-l', '-q'], env);
  if (listed.error || listed.status !== 0) return { kind: 'none', why: `WSL is not available here (${exe} ${listed.error ? 'could not be started: ' + (listed.error.code ?? listed.error.message) : 'exited ' + listed.status})` };
  const names = decodeWslText(listed.stdout).split(/\r?\n/).map(s => s.trim()).filter(s => s && !/^docker-desktop/i.test(s));
  const name = distro ? names.find(n => n === distro) : names[0];
  if (!name) return { kind: 'none', why: distro ? `WSL has no distro named ${distro}` : 'WSL has no distro' };
  const probe = toWslPath(join(scriptsDir, 'probe.sh'));
  if (!probe) return { kind: 'none', why: `the repository is not on a drive the distro can see (${scriptsDir})` };
  const probed = run(['-d', name, '--exec', 'bash', probe], env);
  if (probed.error || !/kolwen-wsl: OK/.test(decodeWslText(probed.stdout))) return { kind: 'none', why: `the headless shell is not executable at ${STABLE_SHELL} in the WSL distro ${name}` };
  return { kind: 'wsl', exe, distro: name };
}

// Start the browser script in the distro. Returns { child, output(), exited(), kill() }; output() is what the script and the browser printed so far.
export function startWslBrowser({ exe, distro, port, lifetimeS, scriptsDir = WSL_SCRIPTS }) {
  if (!WSL_NAME.test(exe)) throw new Error(`${exe} is not wsl.exe: this check starts no other program there`);
  const script = toWslPath(join(scriptsDir, 'browser-run.sh'));
  if (!script) throw new Error(`the repository is not on a drive the distro can see (${scriptsDir})`);
  const child = spawn(exe, ['-d', distro, '--exec', 'bash', script, String(port), String(lifetimeS)], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
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
