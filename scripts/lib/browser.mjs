// A headless Chromium-family browser, driven over the DevTools protocol, with nothing installed: the Chrome that GitHub's ubuntu runner ships (or Edge or Chrome on a developer's machine), a child
// process of this script, and Node's own WebSocket (global since Node 22.4) for the protocol. Zero npm dependencies. The rendered checks (scripts/rendered-check.mjs) use it.
//
// EVERY CHILD IS BOUNDED. The browser is started with a V8 heap cap for each renderer (--js-flags=--max-old-space-size) and with a kill timer that stops it whatever it is doing; every protocol
// command has its own deadline; the temp profile folder is the one this module made (mkdtemp under the OS temp folder) and is the only thing it deletes.
//
// WHAT IS NOT SANDBOXED: with CI set, the browser is started with --no-sandbox, because the runner's kernel refuses the browser's own sandbox to an unprivileged user (Ubuntu 24.04) and the only pages
// it opens are this repository's own files served from 127.0.0.1 by the caller. Locally the sandbox stays on.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep, delimiter } from 'node:path';

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
  const profile = mkdtempSync(join(tmpdir(), 'kolwen-browser-'));
  const args = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-extensions', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--metrics-recording-only', '--hide-scrollbars', '--js-flags=--max-old-space-size=512', ...(ci ? ['--no-sandbox'] : []), 'about:blank'];
  const child = spawn(binary, args, { stdio: 'ignore', windowsHide: true });
  let exited = false;
  child.on('exit', () => { exited = true; });
  const killer = setTimeout(() => { if (!exited) child.kill(); }, lifetimeMs);
  killer.unref();
  const cleanup = () => {
    clearTimeout(killer);
    if (!exited) child.kill();
    // a narrow delete: the folder this call made, resolved to be inside the OS temp folder
    const real = resolve(profile);
    if (real.startsWith(resolve(tmpdir()) + sep) && /kolwen-browser-/.test(real)) { try { rmSync(real, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* a profile folder the OS still holds is the OS temp folder's to sweep */ } }
  };
  try {
    let endpoint = null;
    for (let i = 0; i < 150 && !exited; i++) {
      const f = join(profile, 'DevToolsActivePort');
      if (existsSync(f)) { const [port, path] = readFileSync(f, 'utf8').split(/\r?\n/); if (port && path) { endpoint = `ws://127.0.0.1:${port}${path}`; break; } }
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
        cleanup();
      },
    };
  } catch (e) { cleanup(); throw e; }
}
