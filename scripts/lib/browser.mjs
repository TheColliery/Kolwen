// A headless Chromium-family browser, driven over the DevTools protocol, with nothing installed: the Chrome that GitHub's ubuntu runner ships (or Edge or Chrome on a developer's machine), a child
// process of this script, and Node's own WebSocket (global since Node 22.4) for the protocol. Zero npm dependencies. The rendered checks (scripts/rendered-check.mjs) use it.
//
// EVERY CHILD IS BOUNDED. The browser is started with a V8 heap cap for each renderer (--js-flags=--max-old-space-size) and with a kill timer that stops it whatever it is doing; every protocol
// command has its own deadline.
//
// ONE PROFILE, REUSED, NEVER DELETED. Every run uses the same profile folder: KOLWEN_BROWSER_PROFILE if set, else kolwen-browser-profile in the user's own cache folder, never in a shared temp folder
// (profilePath(): %LOCALAPPDATA% on Windows, $XDG_CACHE_HOME or ~/.cache elsewhere). It is made once, with mode 0o700, and this module never deletes it or anything in it (it imports no delete call,
// and a test holds it to that). Why: measured on the owner's Windows box, a file-system filter refuses every process but the browser READ, WRITE and DELETE on the files Edge writes, so a profile
// made per run (or per launch) can never be removed again and they pile up (81 folders, about 1 GB; warehouse research/browser-test-profiles-2026-10-18/FINDINGS.md). The browser child gets the
// profile as its HOME and TEMP.
//
// ONE RUN AT A TIME, BY A LOCK THAT IS NOT A FILE. A profile can be open in one browser at a time. The run takes a lock by listening on a port of 127.0.0.1 that is a function of the profile's path
// (lockProfile): the operating system hands the port back when the process ends, however it ends, so nothing is written, nothing is deleted and nothing is read from a file. A second launch on the
// same profile cannot listen, and fails at once with one line.
//
// NO FILE DATA REACHES A REQUEST. The DevTools port is chosen here (a server is bound to 127.0.0.1:0, its port read, the server closed, and the browser started with --remote-debugging-port=<that
// port>), and the browser's WebSocket address is read from its own GET /json/version answer and refused unless it is ws://127.0.0.1:<that port>/devtools/browser/<id>. The DevToolsActivePort file the
// browser writes is never read. Limit, stated: another program could take the port between the server closing and the browser binding it; then /json/version is answered by that program, the
// address check still passes, and the run would drive the wrong browser. The odds are those of a just-freed port being taken within milliseconds, on 127.0.0.1, by an HTTP server that answers like a Chromium.
//
// ONLY A FOLDER THIS CODE MADE. The profile folder carries a marker file (MARKER) written when the code made it; an existing folder with files in it and no marker is refused with one line, before
// anything is started, so KOLWEN_BROWSER_PROFILE can never point this code at a person's real browser profile; a profile path that is a symlink or a junction is refused too (prepareProfile).
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
import { existsSync, lstatSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { join, resolve, delimiter, isAbsolute } from 'node:path';

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

// The folder the profile lives in: the user's own cache folder, never a shared temp folder (where another user, or another program, could have made the path first). %LOCALAPPDATA% on Windows,
// $XDG_CACHE_HOME (when it is an absolute path, as the XDG specification requires) or ~/.cache elsewhere.
export const profileBase = (env = process.env, platform = process.platform, home = homedir()) => (platform === 'win32'
  ? (env.LOCALAPPDATA || join(home, 'AppData', 'Local'))
  : (env.XDG_CACHE_HOME && isAbsolute(env.XDG_CACHE_HOME) ? env.XDG_CACHE_HOME : join(home, '.cache')));

// The one profile folder of this machine and user. The same path on every call, in every run.
export const profilePath = (env = process.env, platform = process.platform, home = homedir()) => resolve(env[PROFILE_ENV] || join(profileBase(env, platform, home), 'kolwen-browser-profile'));

// The file this code writes into a profile folder when it makes the folder.
export const MARKER = 'kolwen-browser-profile.marker';

// Write the marker with an exclusive create: a file that is already there (a run that was a moment ahead, or anything else) is never overwritten, and that is not an error.
export function writeMarker(profile) {
  try { writeFileSync(join(profile, MARKER), 'made by scripts/lib/browser.mjs for the Kolwen rendered check; only that check uses this folder\n', { flag: 'wx', mode: 0o600 }); }
  catch (e) { if (e.code !== 'EEXIST') throw e; }
}

// Make the profile folder if it is not there (mode 0o700, and mark it), accept a folder that carries the marker, adopt an existing EMPTY folder (nothing of anyone's is in it), and refuse anything
// else with one line naming the path: a profile path that is a symlink or a junction (lstat does not follow it), or a folder with files in it and no marker, which was not made by this code and
// may be a person's real browser profile.
export function prepareProfile(profile) {
  const foreign = () => new Error(`the browser profile ${profile} is a folder this check did not make (it has no ${MARKER}), so it is not used; point ${PROFILE_ENV} at a new or empty folder`);
  if (lstatSync(profile, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`the browser profile ${profile} is a link (a symlink or a junction), so it is not used`);
  try { mkdirSync(profile, { recursive: true, mode: 0o700 }); }
  catch (e) { if (e.code === 'EEXIST' || e.code === 'ENOTDIR') throw foreign(); throw e; } // a file stands where the folder should be
  if (existsSync(join(profile, MARKER))) return;
  if (readdirSync(profile).length > 0) throw foreign();
  writeMarker(profile);
}

// A cookie reduced to what may be shown: its name and its domain. The value is dropped here, where the browser's answer is received, so no later line can print it.
const shown = ({ name, domain }) => ({ name: String(name), domain: String(domain) });

// The cookies of a list that are not the served origin's own (127.0.0.1): what a run must not find in any jar.
export const foreignCookies = list => list.filter(c => c.domain.replace(/^\./, '') !== '127.0.0.1');

// A free port of 127.0.0.1, chosen here: a server is bound to port 0, its port read, and the server closed.
export const freePort = () => new Promise((res, rej) => {
  const s = createServer();
  s.once('error', rej);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
});

// The WebSocket address the browser reports for itself (webSocketDebuggerUrl of its /json/version answer), checked against the port WE chose: only ws://127.0.0.1:<port>/devtools/browser/<id>, with
// an id of letters, digits and hyphens, is accepted, and the address that is returned is rebuilt from our port and that id. Anything else is refused with one line.
export function devToolsEndpoint(url, port) {
  const id = new RegExp(`^ws://127\.0\.0\.1:${Number(port)}/devtools/browser/([A-Za-z0-9-]+)$`).exec(typeof url === 'string' ? url : '');
  if (!id) throw new Error(`the browser answered with the WebSocket address "${String(url).slice(0, 80)}", which is not ws://127.0.0.1:${Number(port)}/devtools/browser/<id>`);
  return `ws://127.0.0.1:${Number(port)}/devtools/browser/${id[1]}`;
}

// What the browser on `port` says about itself, or null while it does not answer.
const versionOf = port => fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) }).then(r => r.json()).catch(() => null);

// The lock of a profile. Its port is a function of the profile's path (FNV-1a, into 49152 to 65535), so every run on one profile contends for the same port. The lock is a server this process
// keeps listening: the operating system takes it back when the process ends, however it ends. Resolves to the function that gives it up; a profile that is locked already is "in use by another run".
export const lockPortOf = (profile, platform = process.platform) => {
  let h = 2166136261;
  for (const ch of (platform === 'win32' ? profile.toLowerCase() : profile)) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
  return 49152 + (h % 16384);
};
export function lockProfile(profile) {
  return new Promise((resolveLock, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', e => reject(e.code === 'EADDRINUSE' ? new Error(`the browser profile ${profile} is in use by another run`) : e));
    server.listen(lockPortOf(profile), '127.0.0.1', () => resolveLock(() => new Promise(done => server.close(() => done()))));
  });
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
  prepareProfile(profile); // before anything is started: a link, or a folder this code did not make, is refused here
  const release = await lockProfile(profile); // before anything is started: a profile that another run has open fails here, in one line
  let child = null, exited = false, killer = null, spawnError = null;
  const cleanup = async () => {
    clearTimeout(killer);
    if (child && !exited) child.kill();
    for (let i = 0; i < 50 && child && !exited; i++) await wait(100); // let the browser be gone before the profile is given up for the next run
    await release();
  };
  try {
    const port = await freePort();
    const args = ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-extensions', '--disable-background-networking',
      '--disable-component-update', '--disable-sync', '--metrics-recording-only', '--hide-scrollbars', '--js-flags=--max-old-space-size=512',
      '--disable-features=msImplicitSignin', // Edge signs the Windows Microsoft account in by itself at start without it (see NO SIGN-IN above); Chrome and Chromium ignore the name
      '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1', // no host name resolves: nothing of Microsoft's (or anyone's) is reachable, so no sign-in cookie can come back
      ...(ci ? ['--no-sandbox'] : []), 'about:blank'];
    // the browser's own HOME and TEMP are the profile, so what it writes outside --user-data-dir lands in the one folder, not in the user's. USERPROFILE is NOT overridden: measured with
    // Microsoft Edge on Windows, a headless Edge started with USERPROFILE set to its profile never opened a DevTools port (8 s), while HOME, the XDG folders and TEMP/TMP/TMPDIR each did.
    const env = { ...process.env, HOME: profile, TEMP: profile, TMP: profile, TMPDIR: profile, XDG_CONFIG_HOME: profile, XDG_CACHE_HOME: profile };
    child = spawn(binary, args, { stdio: 'ignore', windowsHide: true, env });
    child.on('exit', () => { exited = true; });
    child.on('error', e => { spawnError = e; exited = true; });
    killer = setTimeout(() => { if (!exited) child.kill(); }, lifetimeMs);
    killer.unref();
    let endpoint = null;
    for (let i = 0; i < 150 && !exited; i++) {
      const version = await versionOf(port);
      if (version) { endpoint = devToolsEndpoint(version.webSocketDebuggerUrl, port); break; }
      await wait(100);
    }
    if (spawnError) throw new Error(`the browser could not be started (${spawnError.code ?? spawnError.message})`);
    // a second Chromium started on a profile that is open hands over to the first and exits at once: that is the same "in use" as the lock, seen from the other side of a race
    if (!endpoint) throw new Error(exited ? `the browser profile ${profile} is in use by another run, or the browser exited before it answered on its DevTools port` : 'the browser answered nothing on its DevTools port in 15 s');
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
