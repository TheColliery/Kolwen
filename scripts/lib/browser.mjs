// A headless Chromium-family browser, driven over the DevTools protocol, with nothing installed: the Chrome that GitHub's ubuntu runner ships (or Edge or Chrome on a developer's machine), a child
// process of this script, and Node's own WebSocket (global since Node 22.4) for the protocol. Zero npm dependencies. The rendered checks (scripts/rendered-check.mjs) use it.
//
// EVERY CHILD IS BOUNDED. The browser is started with a V8 heap cap for each renderer (--js-flags=--max-old-space-size) and with a kill timer that stops it whatever it is doing; every protocol
// command has its own deadline. Every browser profile is made under ONE folder this process owns (kolwen-browser-run-*, mkdtemp under the OS temp folder), and the profile of a browser is deleted
// after that browser has exited, retrying briefly when the OS still holds a file; a profile that cannot be deleted is named on stderr in one line, never left silently. A profile is the only thing
// this module deletes, and only inside that run folder. The browser child gets that profile as its own HOME and TEMP, so nothing of it lands in the user's.
//
// WHAT IS NOT SANDBOXED: with CI set, the browser is started with --no-sandbox, because the runner's kernel refuses the browser's own sandbox to an unprivileged user (Ubuntu 24.04) and the only pages
// it opens are this repository's own files served from 127.0.0.1 by the caller. Locally the sandbox stays on.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute, delimiter } from 'node:path';

export const BROWSER_ENV = 'KOLWEN_BROWSER'; // an explicit path to the binary, which wins over the search

const WINDOWS = () => {
  const roots = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  return roots.flatMap(r => [join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), join(r, 'Google', 'Chrome', 'Application', 'chrome.exe')]);
};
const MAC = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium'];
const LINUX_NAMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome', 'microsoft-edge', 'microsoft-edge-stable'];

// The binary to run, or null. KOLWEN_BROWSER first (and when it is set but missing, null: a wrong explicit path is never replaced by a guess), then the platform's usual places, then PATH.
export function findBrowser(env = process.env, platform = process.platform) {
  if (env[BROWSER_ENV]) return existsSync(env[BROWSER_ENV]) ? env[BROWSER_ENV] : null;
  if (platform === 'win32') return WINDOWS().find(existsSync) ?? null;
  if (platform === 'darwin') return MAC.find(existsSync) ?? null;
  for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) for (const name of LINUX_NAMES) { const p = join(dir, name); if (existsSync(p)) return p; }
  return null;
}

const wait = ms => new Promise(r => setTimeout(r, ms));

// The folder every profile of this process lives in, made on first use and taken away again, when it is empty, as the process exits.
let RUN_DIR = null;
export function runDir() {
  if (RUN_DIR) return RUN_DIR;
  RUN_DIR = mkdtempSync(join(tmpdir(), 'kolwen-browser-run-'));
  process.once('exit', () => { try { rmdirSync(RUN_DIR); } catch { /* not empty: a profile that could not be deleted was named when it failed */ } });
  return RUN_DIR;
}

// Delete one profile folder, and only if it is inside `root` (both resolved with realpath, so a link or an 8.3 name cannot lead out). Returns null when it is gone, or one line saying why not.
// `remove` is injectable so a test can make the OS refuse. The OS may hold a file of a browser that has only just exited: rmSync retries EBUSY, EPERM and the like before it gives up.
export function removeProfile(profile, root, remove = rmSync) {
  let real, base;
  try { real = realpathSync.native(profile); base = realpathSync.native(root); }
  catch (e) { return e.code === 'ENOENT' ? null : `could not resolve the browser profile ${profile} to delete it (${e.code ?? e.message})`; }
  const rel = relative(base, real);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return `did not delete ${profile}: it is not inside the folder this run made (${root})`;
  try { remove(real, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); return null; }
  catch (e) { return `could not delete the browser profile ${profile} (${e.code ?? e.message}); it is a throwaway headless-browser profile, safe to delete by hand`; }
}

// DevToolsActivePort holds the port on its first line and the browser's websocket path on its second. It is a file, so it is data to check before it is used to open a connection: the port is
// decimal digits from 1 to 65535, the path is /devtools/browser/<id> with an id of letters, digits and hyphens, and the host is fixed (this machine). Returns the websocket URL, null while the
// file does not yet hold both lines, and throws one line for anything else.
export function devToolsEndpoint(text) {
  const [port, path] = String(text).split(/\r?\n/);
  if (!port || !path) return null;
  if (!/^[0-9]{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error(`DevToolsActivePort names the port "${port.slice(0, 20)}", which is not a decimal number from 1 to 65535`);
  const id = /^\/devtools\/browser\/([A-Za-z0-9-]+)$/.exec(path);
  if (!id) throw new Error(`DevToolsActivePort names the path "${path.slice(0, 40)}", which is not /devtools/browser/<id>`);
  return `ws://127.0.0.1:${Number(port)}/devtools/browser/${id[1]}`;
}

// One protocol connection. send(method, params, sessionId) -> result; on(event, handler).
class Connection {
  constructor(ws, commandTimeoutMs) {
    this.ws = ws;
    this.timeout = commandTimeoutMs;
    this.next = 1;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`)); else p.resolve(msg.result);
      } else for (const h of this.handlers.get(msg.method) ?? []) h(msg.params, msg.sessionId);
    });
    ws.addEventListener('close', () => { for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error(`${p.method}: the browser closed the connection`)); } this.pending.clear(); });
  }
  send(method, params = {}, sessionId) {
    const id = this.next++;
    return new Promise((resolveCmd, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method}: no answer in ${this.timeout} ms`)); }, this.timeout);
      this.pending.set(id, { resolve: resolveCmd, reject, timer, method });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  on(event, handler) { (this.handlers.get(event) ?? this.handlers.set(event, []).get(event)).push(handler); }
}

// Start the browser. Returns { newPage(), close() }. `lifetimeMs` is the hard limit on the whole browser process.
export async function launchBrowser({ binary, lifetimeMs = 300000, commandTimeoutMs = 20000, ci = process.env.CI === 'true' } = {}) {
  if (typeof WebSocket !== 'function') throw new Error('this Node has no global WebSocket (Node 22.4 or newer is needed)');
  const root = runDir();
  const profile = mkdtempSync(join(root, 'profile-'));
  const args = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-extensions', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--metrics-recording-only', '--hide-scrollbars', '--js-flags=--max-old-space-size=512', ...(ci ? ['--no-sandbox'] : []), 'about:blank'];
  // the browser's own HOME and TEMP are the profile, so what it writes outside --user-data-dir lands in the folder that is deleted with it. USERPROFILE is NOT overridden: measured with
  // Microsoft Edge on Windows, a headless Edge started with USERPROFILE set to its profile never wrote DevToolsActivePort (8 s), while HOME, the XDG folders and TEMP/TMP/TMPDIR each did.
  const env = { ...process.env, HOME: profile, TEMP: profile, TMP: profile, TMPDIR: profile, XDG_CONFIG_HOME: profile, XDG_CACHE_HOME: profile };
  const child = spawn(binary, args, { stdio: 'ignore', windowsHide: true, env });
  let exited = false;
  child.on('exit', () => { exited = true; });
  const killer = setTimeout(() => { if (!exited) child.kill(); }, lifetimeMs);
  killer.unref();
  const cleanup = async () => {
    clearTimeout(killer);
    if (!exited) child.kill();
    for (let i = 0; i < 50 && !exited; i++) await wait(100); // the profile is deleted after the browser has exited, not under it
    const why = removeProfile(profile, root);
    if (why) console.error('kolwen-browser: ' + why);
  };
  try {
    let endpoint = null, unusable = null;
    for (let i = 0; i < 150 && !exited; i++) {
      const f = join(profile, 'DevToolsActivePort');
      if (existsSync(f)) {
        const text = readFileSync(f, 'utf8');
        // the same unusable content twice in a row, 100 ms apart, is not a half-written file
        try { endpoint = devToolsEndpoint(text); } catch (e) { if (unusable === text) throw e; unusable = text; }
        if (endpoint) break;
      }
      await wait(100);
    }
    if (!endpoint) throw new Error(exited ? 'the browser exited before it opened a DevTools port' : 'the browser opened no DevTools port in 15 s');
    const ws = new WebSocket(endpoint);
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', () => rej(new Error('the DevTools connection failed')), { once: true }); });
    const conn = new Connection(ws, commandTimeoutMs);
    return {
      binary,
      async newPage() {
        const { targetId } = await conn.send('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await conn.send('Target.attachToTarget', { targetId, flatten: true });
        const send = (method, params) => conn.send(method, params, sessionId);
        await send('Page.enable');
        await send('Runtime.enable');
        await send('Log.enable');
        const logs = []; // what the browser itself reports: a Content-Security-Policy violation arrives here (source 'security')
        conn.on('Log.entryAdded', (p, sid) => { if (sid === sessionId) logs.push({ source: p.entry.source, level: p.entry.level, text: p.entry.text, url: p.entry.url }); });
        return {
          send,
          logs,
          // Resize the viewport (CSS px). `mobile: false`: the page is laid out as a desktop browser window of this width.
          async setViewport(width, height = 800) { await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); },
          async setColorScheme(scheme) { await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }); },
          async goto(url) {
            const loaded = new Promise((res, rej) => {
              const timer = setTimeout(() => rej(new Error(`${url}: the page did not finish loading in ${commandTimeoutMs} ms`)), commandTimeoutMs);
              conn.on('Page.loadEventFired', (_p, sid) => { if (sid === sessionId) { clearTimeout(timer); res(); } });
            });
            await send('Page.navigate', { url });
            await loaded;
            await this.evaluate('document.fonts.ready.then(() => true)');
          },
          // Evaluate an expression in the page and return its value (JSON-serialisable). A thrown exception becomes an Error.
          async evaluate(expression) {
            const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
            if (r.exceptionDetails) throw new Error('page script: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
            return r.result.value;
          },
          async screenshot() { const { data } = await send('Page.captureScreenshot', { format: 'png' }); return Buffer.from(data, 'base64'); },
          async close() { try { await conn.send('Target.closeTarget', { targetId }); } catch { /* the browser may be gone */ } },
        };
      },
      async close() {
        try { await conn.send('Browser.close'); } catch { /* the browser may be gone already */ }
        for (let i = 0; i < 30 && !exited; i++) await wait(100);
        try { ws.close(); } catch { /* closed already */ }
        await cleanup();
      },
    };
  } catch (e) { await cleanup(); throw e; }
}
