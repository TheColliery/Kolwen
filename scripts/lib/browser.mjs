// A headless Chromium-family browser, driven over the DevTools protocol, with nothing installed: the Chrome that GitHub's ubuntu runner ships (or Edge or Chrome on a developer's machine), a child
// process of this script, and Node's own WebSocket (global since Node 22.4) for the protocol. Zero npm dependencies. The rendered checks (scripts/rendered-check.mjs) use it.
//
// EVERY CHILD IS BOUNDED. The browser is started with a V8 heap cap for each renderer (--js-flags=--max-old-space-size) and with a kill timer that stops it whatever it is doing; every protocol
// command has its own deadline.
//
// ONE PROFILE, REUSED, NEVER DELETED. Every run uses the same profile folder: KOLWEN_BROWSER_PROFILE if set, else kolwen-browser-profile in the OS temp folder (profilePath()). It is made once and this
// module never deletes it or anything in it (it imports no delete call, and a test holds it to that). Why: measured on the owner's Windows box, a file-system filter refuses every process but the
// browser READ, WRITE and DELETE on the files Edge writes, so a profile made per run (or per launch) can never be removed again and they pile up (81 folders, about 1 GB; warehouse
// research/browser-test-profiles-2026-10-18/FINDINGS.md). A profile can be open in one browser at a time: a second launch finds the first browser's port in the profile's DevToolsActivePort,
// asks it over HTTP, and fails at once with one line. The browser child gets the profile as its HOME and TEMP.
//
// ONLY A FOLDER THIS CODE MADE. The profile folder carries a marker file (MARKER) written when the code made it; an existing folder with files in it and no marker is refused with one line, before
// anything is started, so KOLWEN_BROWSER_PROFILE can never point this code at a person's real browser profile (prepareProfile).
//
// EVERY PAGE IN A CONTEXT OF ITS OWN. newPage() creates a browser context (Target.createBrowserContext) and the page lives in it: it is off the record, so the page sees no cookie or storage of the
// profile's default context, nothing it writes outlives the context, and page.close() disposes the context. Nothing here clears cookies or cache browser-wide. The default context is only ever
// READ (defaultCookies()), so a run can fail loudly if the profile holds a cookie from outside the served origin.
//
// NO SIGN-IN, NO NETWORK. Measured on the owner's box: a headless Edge on a fresh profile signs the Windows Microsoft account in by itself at start and puts 17 cookies in the default context
// (.bing.com, .msn.com, www.bing.com, among them .MSA.Auth and _U); with --disable-features=msImplicitSignin it puts none, on two launches of the same profile. A profile that was ALREADY signed in
// is not helped by that switch alone: after the cookies were cleared, Edge put the same 17 back within 4 s. What stops it there is that the browser can resolve no host name at all
// (--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1): the cookies stayed at 0 at 4 s and at 12 s. The check opens only the caller's own server on 127.0.0.1, so it needs no other host.
// Both are in the arguments of launchBrowser.
//
// WHAT IS NOT SANDBOXED: with CI set, the browser is started with --no-sandbox, because the runner's kernel refuses the browser's own sandbox to an unprivileged user (Ubuntu 24.04) and the only pages
// it opens are this repository's own files served from 127.0.0.1 by the caller. Locally the sandbox stays on.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, delimiter } from 'node:path';

export const BROWSER_ENV = 'KOLWEN_BROWSER'; // an explicit path to the binary, which wins over the search
export const PROFILE_ENV = 'KOLWEN_BROWSER_PROFILE'; // an explicit path to the one profile folder

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

// The one profile folder of this machine and user. The same path on every call, in every run.
export const profilePath = (env = process.env, temp = tmpdir()) => resolve(env[PROFILE_ENV] || join(temp, 'kolwen-browser-profile'));

// The file this code writes into a profile folder when it makes the folder.
export const MARKER = 'kolwen-browser-profile.marker';

// Make the profile folder if it is not there (and mark it), accept a folder that carries the marker, adopt an existing EMPTY folder (nothing of anyone's is in it), and refuse anything else with
// one line naming the path: a folder with files in it and no marker was not made by this code, and may be a person's real browser profile.
export function prepareProfile(profile) {
  const marker = join(profile, MARKER);
  if (existsSync(marker)) return;
  const refuse = () => new Error(`the browser profile ${profile} is a folder this check did not make (it has no ${MARKER}), so it is not used; point ${PROFILE_ENV} at a new or empty folder`);
  if (existsSync(profile)) {
    if (!statSync(profile).isDirectory() || readdirSync(profile).length > 0) throw refuse();
  } else mkdirSync(profile, { recursive: true });
  writeFileSync(marker, 'made by scripts/lib/browser.mjs for the Kolwen rendered check; only that check uses this folder\n');
}

// A cookie reduced to what may be shown: its name and its domain. The value is dropped here, where the browser's answer is received, so no later line can print it.
const shown = ({ name, domain }) => ({ name: String(name), domain: String(domain) });

// The cookies of a list that are not the served origin's own (127.0.0.1): what a run must not find in any jar.
export const foreignCookies = list => list.filter(c => c.domain.replace(/^\./, '') !== '127.0.0.1');

// A port from the first line of DevToolsActivePort: decimal digits, 1 to 65535, as a number; null for anything else. The file is data, so the number is all that is taken from that line.
const portOf = line => (/^[0-9]{1,5}$/.test(line) && Number(line) >= 1 && Number(line) <= 65535 ? Number(line) : null);

// DevToolsActivePort holds the port on its first line and the browser's websocket path on its second. It is a file, so it is data to check before it is used to open a connection: the port is
// decimal digits from 1 to 65535, the path is /devtools/browser/<id> with an id of letters, digits and hyphens, and the host is fixed (this machine). Returns the websocket URL, null while the
// file does not yet hold both lines, and throws one line for anything else.
export function devToolsEndpoint(text) {
  const [port, path] = String(text).split(/\r?\n/);
  if (!port || !path) return null;
  const n = portOf(port);
  if (n === null) throw new Error(`DevToolsActivePort names the port "${port.slice(0, 20)}", which is not a decimal number from 1 to 65535`);
  const id = /^\/devtools\/browser\/([A-Za-z0-9-]+)$/.exec(path);
  if (!id) throw new Error(`DevToolsActivePort names the path "${path.slice(0, 40)}", which is not /devtools/browser/<id>`);
  return `ws://127.0.0.1:${n}/devtools/browser/${id[1]}`;
}

// Is a browser of ANOTHER run open on this profile? Its port is in the profile's DevToolsActivePort; a file left by a browser that was killed names a port nobody answers on, so the port is asked
// over HTTP (a Chromium answers /json/version with its name) and only a browser that answers counts. Nothing is deleted either way. `ask` is injectable for a test.
export async function profileInUse(profile, ask = port => fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) }).then(r => r.json())) {
  let port = null;
  try { port = portOf(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0]); } catch { return false; }
  if (port === null) return false;
  try { return typeof (await ask(port))?.Browser === 'string'; } catch { return false; }
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

// Start the browser on the one profile. Returns { profile, newPage(), close() }. `lifetimeMs` is the hard limit on the whole browser process.
export async function launchBrowser({ binary, lifetimeMs = 300000, commandTimeoutMs = 20000, ci = process.env.CI === 'true' } = {}) {
  if (typeof WebSocket !== 'function') throw new Error('this Node has no global WebSocket (Node 22.4 or newer is needed)');
  const profile = profilePath();
  prepareProfile(profile); // before anything is started: a folder this code did not make is refused here
  if (await profileInUse(profile)) throw new Error(`the browser profile ${profile} is in use by another run`);
  const portFile = join(profile, 'DevToolsActivePort');
  // a port file left by an earlier browser that was killed is not this browser's: only a file that differs from it (or is newer) is
  const left = existsSync(portFile) ? { text: readFileSync(portFile, 'utf8'), mtimeMs: statSync(portFile).mtimeMs } : null;
  const args = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-extensions', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--metrics-recording-only', '--hide-scrollbars', '--js-flags=--max-old-space-size=512',
    '--disable-features=msImplicitSignin', // Edge signs the Windows Microsoft account in by itself at start without it (see NO SIGN-IN above); Chrome and Chromium ignore the name
    '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1', // no host name resolves: nothing of Microsoft's (or anyone's) is reachable, so no sign-in cookie can come back
    ...(ci ? ['--no-sandbox'] : []), 'about:blank'];
  // the browser's own HOME and TEMP are the profile, so what it writes outside --user-data-dir lands in the one folder, not in the user's. USERPROFILE is NOT overridden: measured with
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
    for (let i = 0; i < 50 && !exited; i++) await wait(100); // the next run asks whether this browser still answers: let it be gone first
  };
  try {
    let endpoint = null, unusable = null;
    for (let i = 0; i < 150 && !exited; i++) {
      if (existsSync(portFile)) {
        const text = readFileSync(portFile, 'utf8');
        if (!left || text !== left.text || statSync(portFile).mtimeMs > left.mtimeMs) {
          // the same unusable content twice in a row, 100 ms apart, is not a half-written file
          try { endpoint = devToolsEndpoint(text); } catch (e) { if (unusable === text) throw e; unusable = text; }
          if (endpoint) break;
        }
      }
      await wait(100);
    }
    // a second Chromium started on a profile that is open hands over to the first and exits at once: that is the same "in use" as the check above, seen from the other side of a race
    if (!endpoint) throw new Error(exited ? `the browser profile ${profile} is in use by another run, or the browser exited before it opened a DevTools port` : 'the browser opened no DevTools port in 15 s');
    const ws = new WebSocket(endpoint);
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', () => rej(new Error('the DevTools connection failed')), { once: true }); });
    const conn = new Connection(ws, commandTimeoutMs);
    return {
      binary,
      profile,
      // Browser-level protocol commands, for a test that has to reach the default context.
      send: (method, params) => conn.send(method, params),
      // The cookies of the profile's DEFAULT context, names and domains only. Read, never cleared.
      async defaultCookies() { return (await conn.send('Storage.getCookies', {})).cookies.map(shown); },
      // A page in a browser context of its own (see EVERY PAGE IN A CONTEXT OF ITS OWN above); page.close() disposes the context.
      async newPage() {
        // disposeOnDetach: the context goes with the connection if this process dies before close()
        const { browserContextId } = await conn.send('Target.createBrowserContext', { disposeOnDetach: true });
        const { targetId } = await conn.send('Target.createTarget', { url: 'about:blank', browserContextId });
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
          // The cookies of THIS page's context, names and domains only.
          async cookies() { return (await conn.send('Storage.getCookies', { browserContextId })).cookies.map(shown); },
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
          async close() {
            try { await conn.send('Target.closeTarget', { targetId }); } catch { /* the browser may be gone */ }
            try { await conn.send('Target.disposeBrowserContext', { browserContextId }); } catch { /* the browser may be gone */ }
          },
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
