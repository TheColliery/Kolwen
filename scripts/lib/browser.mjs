// A headless Chromium-family browser, driven over the DevTools protocol, with nothing installed. Two routes, one API:
//   native: the Chrome that GitHub's ubuntu runner ships (or the Chrome, Chromium or Edge a developer's Linux or macOS machine has: MAC and LINUX_NAMES below), a child process of this script, on ONE profile (below);
//   wsl:    on Windows, the Blink headless shell inside a WSL distro (scripts/lib/wsl-route.mjs, scripts/wsl/browser-run.sh), with a profile of its own in a mktemp folder inside the distro.
// On Windows this check NEVER starts a Windows browser: findBrowser returns null there, and KOLWEN_BROWSER on Windows is refused unless it names the WSL route (findRoute). Node's own WebSocket
// (global since Node 22.4) carries the protocol. Zero npm dependencies. The rendered checks (scripts/rendered-check.mjs) use it.
//
// EVERY CHILD IS BOUNDED. The browser is started with a V8 heap cap for each renderer (--js-flags=--max-old-space-size) and with a kill timer that stops it whatever it is doing; every protocol
// command has its own deadline.
//
// THE PAGES TRAVEL BY THE SAME ROUTE AS THE BROWSER. browser.serve(webDir) gives the origin the pages are loaded from. On the native route that is a real HTTP server on 127.0.0.1 (static-server.mjs).
// On the WSL route nothing listens: a server on Windows 127.0.0.1 is not reachable from the distro (NAT), and the distro has no Node to run one, so the browser is told to ask the DevTools channel
// for every request to the origin (Fetch.enable) and the same responder that backs the HTTP server answers it (Fetch.fulfillRequest), headers and Content-Security-Policy included.
//
// ONE PROFILE, REUSED, NEVER DELETED (native route). Every run uses the same profile folder: KOLWEN_BROWSER_PROFILE if set, else kolwen-browser-profile in the user's own cache folder, never in a
// shared temp folder (profilePath(): $XDG_CACHE_HOME or ~/.cache; %LOCALAPPDATA% where a Windows caller asks). It is made once, with mode 0o700, and this module never deletes it or anything in it
// (it imports no delete call, and a test holds it to that). Why: on a developer's Windows machine a file-system filter can refuse every process but the browser READ, WRITE and DELETE on the files
// Edge writes, so a profile made per run could never be removed again and they pile up; that was the reason to stop making them, and the Windows route is gone. The WSL route's profile is a
// per-run mktemp folder inside the distro, which the script removes by an asserted path (the distro's disk is one image file to Windows, so nothing refuses the delete). The browser child gets
// the profile as its HOME and TEMP.
//
// ONE RUN AT A TIME, BY A LOCK THAT IS NOT A FILE (native route). A profile can be open in one browser at a time. The run takes a lock by listening on a port of 127.0.0.1 that is a function of the
// profile's path (lockProfile): the operating system hands the port back when the process ends, however it ends, so nothing is written, nothing is deleted and nothing is read from a file. A second
// launch on the same profile cannot listen, and fails at once with one line. The lock speaks: whoever connects to it is told it is this check's lock, so a program that is not this check holding
// that port is reported as that, and not as "another run". The WSL route needs no lock, every run having a profile of its own.
//
// NO FILE DATA REACHES A REQUEST. The DevTools port is chosen here (a server is bound to 127.0.0.1:0, its port read, the server closed, and the browser started with --remote-debugging-port=<that
// port>), and the browser's WebSocket address is read from its own GET /json/version answer and refused unless it is ws://127.0.0.1:<that port>/devtools/browser/<id>. The DevToolsActivePort file the
// browser writes is never read. Limit, stated: another program could take the port between the server closing and the browser binding it; then /json/version is answered by that program, the
// address check still passes, and the run would drive the wrong browser. The odds are those of a just-freed port being taken within milliseconds, on 127.0.0.1, by an HTTP server that answers like a Chromium.
//
// ONLY A FOLDER THIS CODE MADE (native route). The profile folder carries a marker file (MARKER) written when the code made it; an existing folder with files in it and no marker is refused with one
// line, before anything is started, so KOLWEN_BROWSER_PROFILE can never point this code at a person's real browser profile; a profile path that is a symlink or a junction is refused too
// (prepareProfile). Limit, stated: the marker records INTENT, not origin. A folder that holds a copied marker is accepted as ours; the second guard is the jar check of rendered-check.mjs, which fails
// the run, naming the cookies, when the default context of whatever profile was used holds one from outside the served origin.
//
// EVERY PAGE IN A CONTEXT OF ITS OWN. newPage() creates a browser context (Target.createBrowserContext) and the page lives in it: it is off the record, so the page sees no cookie or storage of the
// profile's default context, nothing it writes outlives the context, and page.close() disposes the context. Nothing here clears cookies or cache browser-wide. The default context is only ever
// READ (defaultCookies()), so a run can fail loudly if the profile holds a cookie from outside the served origin.
//
// NO SIGN-IN, NO NETWORK. Measured on a developer's Windows machine: a headless Edge on a fresh profile signs the computer's Microsoft account in by itself at start and puts 17 cookies in the
// default context (.bing.com, .msn.com, www.bing.com, among them .MSA.Auth and _U); with --disable-features=msImplicitSignin it puts none, on two launches of the same profile. A profile that was ALREADY signed in
// is not helped by that switch alone: after the cookies were cleared, Edge put the same 17 back within 4 s. What stops it there is that the browser can resolve no host name at all
// (--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1): the cookies stayed at 0 at 4 s and at 12 s. The check opens only the caller's own origin on 127.0.0.1, so it needs no other host. A
// resource a page asks for by host name therefore fails with net::ERR_NAME_NOT_RESOLVED, and that is a finding of the run (page.resourceFailures, rendered-check.mjs), never a silent miss.
//
// WHAT IS NOT SANDBOXED: with CI set, the native browser is started with --no-sandbox, because the runner's kernel refuses the browser's own sandbox to an unprivileged user (Ubuntu 24.04) and the
// only pages it opens are this repository's own files served from 127.0.0.1 by the caller. Locally the sandbox stays on. The WSL route starts the headless shell with its sandbox on.
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { homedir } from 'node:os';
import { join, resolve, delimiter, isAbsolute } from 'node:path';
import { makeResponder, serveWeb } from './static-server.mjs';
import { findWslRoute, startWslBrowser, scriptLines } from './wsl-route.mjs';

export const BROWSER_ENV = 'KOLWEN_BROWSER'; // a path to the binary on Linux and macOS; on Windows only "wsl" or "wsl:<distro>"
export const PROFILE_ENV = 'KOLWEN_BROWSER_PROFILE'; // an explicit path to the one profile folder (native route)

// The exit code of the command line when the check could not run HERE (no browser route on this machine): distinct from a pass (0), a failure (1) and a usage error (2).
export const EXIT_NOT_RUN_HERE = 3;

const MAC = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium'];
const LINUX_NAMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome', 'microsoft-edge', 'microsoft-edge-stable'];

// The native binary to run, or null. KOLWEN_BROWSER first (and when it is set but missing, null: a wrong explicit path is never replaced by a guess), then the platform's usual places, then PATH.
// On Windows it is ALWAYS null: this check does not start a Windows browser (msedge.exe, chrome.exe) whatever is installed or named; the Windows route is findRoute's WSL one. `exists` is injectable.
export function findBrowser(env = process.env, platform = process.platform, exists = existsSync) {
  if (platform === 'win32') return null;
  if (env[BROWSER_ENV]) return exists(env[BROWSER_ENV]) ? env[BROWSER_ENV] : null;
  if (platform === 'darwin') return MAC.find(exists) ?? null;
  for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) for (const name of LINUX_NAMES) { const p = join(dir, name); if (exists(p)) return p; }
  return null;
}

// Where the check can run on this machine: { kind: 'native', binary }, { kind: 'wsl', exe, distro }, { kind: 'none', why } (no browser route here) or { kind: 'refused', why } (an explicit
// request this check will not honour). On Windows KOLWEN_BROWSER is "wsl" or "wsl:<distro>" and nothing else: a path to msedge.exe, chrome.exe or any other program is refused with its reason.
// `deps` is injectable: { run } stands in for wsl.exe, { exists } for the file system.
export function findRoute(env = process.env, platform = process.platform, deps = {}) {
  if (platform === 'win32') {
    const want = env[BROWSER_ENV];
    if (want && !/^wsl(:[A-Za-z0-9._-]+)?$/.test(want)) return { kind: 'refused', why: `${BROWSER_ENV} names ${want}, which is not the WSL route: on Windows this check never starts a Windows browser; set it to wsl or wsl:<distro>, or leave it unset` };
    return findWslRoute({ env, run: deps.run, scriptsDir: deps.scriptsDir, distro: want && want.length > 4 ? want.slice(4) : null });
  }
  const binary = findBrowser(env, platform, deps.exists);
  return binary ? { kind: 'native', binary } : { kind: 'none', why: `no Chrome, Chromium or Edge was found (set ${BROWSER_ENV} to a binary)` };
}

const wait = ms => new Promise(r => setTimeout(r, ms));

// The folder the profile lives in: the user's own cache folder, never a shared temp folder (where another user, or another program, could have made the path first). %LOCALAPPDATA% on Windows,
// $XDG_CACHE_HOME (when it is an absolute path, as the XDG specification requires) or ~/.cache elsewhere.
export const profileBase = (env = process.env, platform = process.platform, home = homedir()) => (platform === 'win32'
  ? (env.LOCALAPPDATA || join(home, 'AppData', 'Local'))
  : (env.XDG_CACHE_HOME && isAbsolute(env.XDG_CACHE_HOME) ? env.XDG_CACHE_HOME : join(home, '.cache')));

// The one profile folder of a computer and user. The same path on every call, in every run.
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
  if (!existsSync(join(profile, MARKER))) {
    if (readdirSync(profile).length > 0) throw foreign();
    writeMarker(profile);
  }
  // mkdir gives a mode to a folder it makes, not to one that was there: an existing folder of ours is made private now that it is known to be ours (and only then: a folder that is not ours is
  // refused above, untouched). A folder owned by someone else refuses the chmod, and that ends the run.
  if (process.platform !== 'win32') {
    try { chmodSync(profile, 0o700); } catch (e) { throw new Error(`the browser profile ${profile} could not be made private (${e.code ?? e.message}), so it is not used`); }
  }
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
  // the fixed prefix is compared as a string, so its dots are dots; only the id is tested with a pattern, and the pattern has no escape in it
  const prefix = `ws://127.0.0.1:${Number(port)}/devtools/browser/`;
  const id = typeof url === 'string' && url.startsWith(prefix) ? url.slice(prefix.length) : '';
  if (!/^[A-Za-z0-9-]+$/.test(id)) throw new Error(`the browser answered with the WebSocket address "${String(url).slice(0, 80)}", which is not ws://127.0.0.1:${Number(port)}/devtools/browser/<id>`);
  return prefix + id;
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
const LOCK_GREETING = 'kolwen-browser-profile-lock';

// Who holds a lock port that could not be taken: this check's lock greets whoever connects, a program that is not this check does not. Returns 'a run' or 'another program'.
export const lockHolder = port => new Promise(done => {
  const sock = connect({ host: '127.0.0.1', port });
  let said = '';
  const end = () => { sock.destroy(); done(said.startsWith(LOCK_GREETING) ? 'a run' : 'another program'); };
  sock.setTimeout(1000, end);
  sock.on('data', d => { said += d; if (said.length >= LOCK_GREETING.length) end(); });
  sock.on('error', end);
  sock.on('close', end);
});

export function lockProfile(profile) {
  return new Promise((resolveLock, reject) => {
    const server = createServer(client => { client.on('error', () => {}); client.end(LOCK_GREETING + String.fromCharCode(10)); });
    server.unref();
    server.once('error', async e => {
      const port = lockPortOf(profile);
      // Windows keeps ranges of the dynamic ports for itself (Hyper-V, WSL): a port there refuses the bind with EACCES, which is no run and no program of ours either
      if (e.code === 'EACCES') { reject(new Error(`the browser profile ${profile} could not be locked: port ${port} of 127.0.0.1 is reserved by the system (point ${PROFILE_ENV} at another folder)`)); return; }
      if (e.code !== 'EADDRINUSE') { reject(e); return; }
      reject(new Error(await lockHolder(port) === 'a run'
        ? `the browser profile ${profile} is in use by another run`
        : `the browser profile ${profile} could not be locked: port ${port} of 127.0.0.1 is held by a program that is not this check (point ${PROFILE_ENV} at another folder)`));
    });
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

// The switches both routes start the browser with (the native arguments below; scripts/wsl/browser-run.sh carries the same list, and a test holds the two to each other): no sync, no component
// update, no background networking, a V8 heap cap, and no host name that resolves except through 127.0.0.1 (no host name resolves: nothing of Microsoft's or anyone's is reachable, so no sign-in
// cookie can come back).
export const COMMON_ARGS = ['--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--disable-sync',
  '--metrics-recording-only', '--hide-scrollbars', '--js-flags=--max-old-space-size=512', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1'];

// What a resource failure is worth: the browser resolves no host name, so a resource a page asks for by host name fails with this error. It is a finding (rendered-check.mjs), not a miss.
export const NAME_NOT_RESOLVED = 'net::ERR_NAME_NOT_RESOLVED';

// The Fetch.fulfillRequest parameters for the responder's answer `out` to a request of this method: the headers always, the body for every method but HEAD (a HEAD answer has none, as over HTTP).
export const fulfillParams = (requestId, method, out) => ({ requestId, responseCode: out.status, responseHeaders: Object.entries(out.headers).map(([name, value]) => ({ name, value: String(value) })), body: method === 'HEAD' ? '' : out.body.toString('base64') });

// The browser API over one DevTools connection, the same for both routes. `serveVia` is null (pages come from a real server, serveWeb) or an object holding the responder the browser is asked to
// get its pages from over the channel (the WSL route). `isExited()` says whether the browser process is gone.
async function drive({ endpoint, profile, label, commandTimeoutMs, isExited, cleanup, channel }) {
  const ws = new WebSocket(endpoint);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', () => rej(new Error('the DevTools connection failed')), { once: true }); });
  const conn = new Connection(ws, commandTimeoutMs);
  const web = { responder: null, origin: null }; // set by serve() on the channel route
  return {
    label,
    profile,
    // Where the pages come from: a real HTTP server on 127.0.0.1 (native), or the DevTools channel (WSL). Returns { origin, close }.
    async serve(webDir, { headers = true } = {}) {
      if (!channel) return serveWeb(webDir, { headers });
      web.responder = makeResponder(webDir, { headers });
      web.origin = `http://127.0.0.1:${await freePort()}`; // nothing listens there: the browser's request is answered before it reaches a network
      return { origin: web.origin, close: async () => { web.responder = null; } };
    },
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
      await send('Network.enable');
      const logs = []; // what the browser itself reports: a Content-Security-Policy violation arrives here (source 'security')
      conn.on('Log.entryAdded', (p, sid) => { if (sid === sessionId) logs.push({ source: p.entry.source, level: p.entry.level, text: p.entry.text, url: p.entry.url }); });
      const resourceFailures = []; // a request that failed, with its address: [{ url, errorText }]
      const urls = new Map();
      conn.on('Network.requestWillBeSent', (p, sid) => { if (sid === sessionId) urls.set(p.requestId, p.request.url); });
      conn.on('Network.loadingFailed', (p, sid) => { if (sid === sessionId) resourceFailures.push({ url: urls.get(p.requestId) ?? '', errorText: p.errorText }); });
      if (channel && web.responder) {
        // the pages of this origin are answered here, over the channel
        await send('Fetch.enable', { patterns: [{ urlPattern: `${web.origin}/*`, requestStage: 'Request' }] });
        conn.on('Fetch.requestPaused', (p, sid) => {
          if (sid !== sessionId) return;
          let out = null;
          try { out = web.responder ? web.responder(p.request.url) : null; } catch { out = null; }
          const done = out
            ? send('Fetch.fulfillRequest', fulfillParams(p.requestId, p.request.method, out))
            : send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'Failed' });
          done.catch(() => { /* the page went away */ });
        });
      }
      return {
        send,
        logs,
        resourceFailures,
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
      for (let i = 0; i < 30 && !isExited(); i++) await wait(100);
      try { ws.close(); } catch { /* closed already */ }
      await cleanup();
    },
  };
}

// Start the browser on a route found by findRoute (or, for the native route, on a binary). `lifetimeMs` is the hard limit on the whole browser process.
export async function launchBrowser({ route, binary, lifetimeMs = 300000, commandTimeoutMs = 20000, ci = process.env.CI === 'true' } = {}) {
  if (typeof WebSocket !== 'function') throw new Error('this Node has no global WebSocket (Node 22.4 or newer is needed)');
  const r = route ?? { kind: 'native', binary };
  if (r.kind === 'wsl') return launchWsl(r, { lifetimeMs, commandTimeoutMs });
  if (r.kind !== 'native') throw new Error(`there is no browser route to launch (${r.why ?? r.kind})`);
  return launchNative(r.binary, { lifetimeMs, commandTimeoutMs, ci });
}

// The native route: the one profile, its lock, a child process of this script.
async function launchNative(binary, { lifetimeMs, commandTimeoutMs, ci }) {
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
    const args = ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, ...COMMON_ARGS,
      '--disable-features=msImplicitSignin', // Edge signs the computer's Microsoft account in by itself at start without it (see NO SIGN-IN above); Chrome and Chromium ignore the name
      ...(ci ? ['--no-sandbox'] : []), 'about:blank'];
    // the browser's own HOME and TEMP are the profile, so what it writes outside --user-data-dir lands in the one folder, not in the user's
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
    return { ...(await drive({ endpoint, profile, label: binary, commandTimeoutMs, isExited: () => exited, cleanup, channel: false })), binary };
  } catch (e) { await cleanup(); throw e; }
}

// The WSL route: the headless shell in the distro, started by scripts/wsl/browser-run.sh with a profile of its own that the script removes. Windows reaches its DevTools port through WSL's localhost
// forwarding; the port is a free one on Windows, chosen here, and the script is told to bind it inside the distro.
async function launchWsl(route, { lifetimeMs, commandTimeoutMs }) {
  const port = await freePort();
  const run = startWslBrowser({ distro: route.distro, port, lifetimeS: Math.ceil(lifetimeMs / 1000) + 5 });
  const cleanup = async () => {
    if (!run.exited()) await wait(0);
    for (let i = 0; i < 150 && !run.exited(); i++) await wait(100); // the script ends the browser and removes its folder when the browser closes
    if (!run.exited()) { run.kill(); for (let i = 0; i < 100 && !run.exited(); i++) await wait(100); }
    const bad = scriptLines(run.output()).filter(l => /^(LEFT|REFUSED|BAD)/.test(l));
    if (bad.length) console.error('kolwen-browser: the WSL script reported: ' + bad.join('; '));
  };
  try {
    let endpoint = null;
    for (let i = 0; i < 300 && !run.exited(); i++) { // a distro that was stopped takes some seconds to start
      const version = await versionOf(port);
      if (version) { endpoint = devToolsEndpoint(version.webSocketDebuggerUrl, port); break; }
      await wait(100);
    }
    if (run.spawnError()) throw new Error(`the WSL route could not be started (${run.spawnError().code ?? run.spawnError().message})`);
    if (!endpoint) throw new Error(run.exited() ? `the headless shell in WSL (${route.distro}) exited before it answered on its DevTools port${scriptLines(run.output()).length ? ' (' + scriptLines(run.output()).join('; ') + ')' : ''}` : 'the headless shell in WSL answered nothing on its DevTools port in 30 s');
    return await drive({ endpoint, profile: `WSL ${route.distro}: a profile of its own under /tmp, removed at the end`, label: `WSL ${route.distro}`, commandTimeoutMs, isExited: () => run.exited(), cleanup, channel: true });
  } catch (e) { run.kill(); await cleanup(); throw e; }
}
