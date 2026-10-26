# Contributing to Kolwen

<!-- Diverges from the flock published-code template by more than placeholders, deliberately: the
     template is written for a Coal* skill repo and tells a contributor to run build-plugin.mjs,
     verify.mjs and test.mjs against a plugin.json, none of which exist here. Its SHAPE is kept
     (sections, ordering, closers); the gates, the layout table and the rules are this room's. -->

Kolwen is the public face of a Thai-first verifiable AI assistant, part of the
[TheColliery](https://github.com/TheColliery) series. Issues, bug reports, and pull requests are
welcome.

**This repository is the face, not the kitchen.** No training pipeline, corpus, or model internals
live here. It holds the site, the brand kit, the package name reservations, and the documentation
for a product that has not shipped yet.

---

## Proposing a change

1. **Open an issue first** describing the problem or the gap. For anything touching a published
   claim—the site copy, the README, the brand rules—the issue is where the claim gets argued,
   not the PR.
2. Make the change and keep the gates green (below).
3. Say in the PR how you verified it. "It looks right" is not a verification; the command you ran
   is.

A first-time contributor: the gate commands in the next section ARE the getting-started steps.
Clone, install nothing, run them.

---

## Developing and testing

Kolwen ships **no runtime dependency**—the scripts use Node.js built-ins only, Node 22+. There is
no build step. `package.json` and `package-lock.json` exist to pin Wrangler, the deploy tool,
and to override one transitive dependency for an advisory;
nothing here needs an `npm install` to run.

```bash
node scripts/rendered-check.mjs     # every page in a real headless browser: 320 px reflow, 200% text, CSP, the reading theme (Chrome, Chromium or Edge on Linux and macOS; on Windows the headless shell inside WSL; KOLWEN_BROWSER names a binary, or is `wsl` on Windows)
node --test scripts/rendered-check.test.mjs   # that check's own tests, each defect planted in a copy of web/
node scripts/surface-check.mjs      # the room's own laws: claims, leakage, orthography, contrast, the tracker claim, production noindex
node scripts/secret-gate.mjs        # the house secret scan over the tracked tree (the hooks also scan what a commit or push adds)
node --test scripts/secret-scan.test.mjs scripts/secret-gate.test.mjs scripts/legal-state.test.mjs   # the scanner's, the gate's and the legal-state switch's own tests
node scripts/legal-state.mjs        # check TERMS.md against legal/legal-state.json; --write renders it, and is the only way to flip the Thai 7-day clause
node brand/make-brand.mjs           # regenerate every brand asset; must leave git clean
node scripts/post-deploy-check.mjs  # compare the live site to what is committed (needs network); --origin <url> checks one host
```

The surface check, the brand byte-identity check and the secret gate (with its test files) run in CI on every push and must pass, and so does the `rendered` job, which runs the rendered check in a headless Chrome on the runner. Locally the rendered check says `NOT RUN HERE` and exits 3 when it finds no browser route, which is not a pass; in CI it fails instead. The post-deploy check runs after a deploy.

The repository also ships a `pre-commit` and a `pre-push` hook in `.githooks/` that run the secret scan, then the surface check. `pre-commit` scans the working-tree copy of each tracked file, not what is staged, so a key that is staged and then removed from the working copy passes it; `pre-push` scans the added lines, commit messages and tags of every pushed commit, and CI scans the tree, so that key is caught there. They run only in a clone that ran `git config core.hooksPath .githooks`, and `git push --no-verify` bypasses them; GitHub's server-side secret scanning and push protection stay this repository's other wall.

### Rules that are not style preferences

- **A claim must match what the code does.** This repository's whole positioning is that its
  statements are checkable, so a sentence that overstates is a defect of the same class as a bug.
- **`brand/make-brand.mjs` is the single source of the mark's geometry.** Never hand-edit a
  generated asset; change the script and regenerate. CI compares byte-for-byte.
- **The mark is abstract.** Describe it by geometry, never by an object word—see
  [`brand/README.md`](brand/README.md) section 6.
- **Trademark language:** the word mark is FILED. Say pending, never the completed-registration
  wording or the circled-R symbol—`scripts/surface-check.mjs` fails the build on either, and
  `brand/README.md` section 1 is the authority.
- **Em dashes are unspaced** in English prose (`word—word`). Thai text keeps its own spacing.
- Shipped source and documentation stay in English; the site itself is bilingual.

---

## Supported platforms

Nothing is downloadable yet, so there is no runtime platform claim to make. The site is a
Cloudflare Worker serving static assets; the tooling is Node 22+ on any OS. When the model ships,
the README's own compatibility statement is the one that binds—do not restate a different claim
here.

---

## Project layout

| Path | Purpose |
|---|---|
| `web/` | Everything served at kolwen.com. Every path under it is a live URL |
| `web-src/` | What the home, pricing and not-found pages are generated from (the templates and the language catalogue), and `seams.json`, the map of which group each page belongs to |
| `brand/` | The identity kit and the generator that is the source of the mark's geometry |
| `py/` | The PyPI name reservation. No runtime code yet |
| `docs/` | Operator documentation, starting with how the site deploys |
| `scripts/` | Zero-dependency checks that run in CI |

---

## Changing site text, and adding a language

- **The words of the legal pages and the changelog** are in `TERMS.md`, `PRIVACY.md`, `legal/` and `CHANGELOG.md`. **The words of the home, pricing and not-found pages** are keys in `web-src/i18n/en.json` and `web-src/i18n/th.json` (keyed by page, plus a `shared` group for the header and footer); their structure is the templates in `web-src/pages/`. Edit the source, run `node scripts/legal-pages.mjs --write`, and commit the regenerated files under `web/` with it. Never edit `web/index.html`, `web/pricing.html` or `web/404.html` by hand: CI runs `--check` and names the difference.
- A value is a whole sentence, never a fragment joined to another. Both language files carry the same keys. The check refuses the rest (a bad language tag, a plain space before the Thai repetition mark ๆ, and more); `scripts/legal-pages.mjs` and `scripts/lib/i18n-catalogue.mjs` are the list of record.
- **Adding a language** starts with one file, `web-src/i18n/<bcp47>.json`, holding every key (the check names a missing one and a tag the registry would shorten: `th`, not `th-Thai`). A script the site has no font for also needs a folder under `web/fonts/` with the font's licence text and a manifest entry (`web/fonts/fonts.css` and `scripts/font-subset.mjs` say how a font is cut and named). Today that file is checked but no page is generated from it: each template still holds one document per language, English and Thai, so a third language does not appear on the site until the page build is made to render per language. Say so in the change rather than describing the language as added.

---

## Sizes, a page's job, and the rendered check

- **Sizes and spacing** are tokens in `scripts/lib/layout-tokens.mjs`, the one table, emitted into every page's style block (a token at the path `font.size.1` is the custom property `--kw-font-size-1`). Add or change a size there, in `rem`; a page never carries a px font size of its own, and surface-check rule 21 names the line that does. The file's header says which numbers are the house's own and what stays in px.
- **A new page declares its job** on `<html>`, as `data-job="prose"` (its main content is prose read top to bottom, so it takes the reading theme) or `data-job="default"` (cards, buttons or figures to choose from). A page made from a template in `web-src/pages/` writes the attribute in the template; a page made from Markdown sets `job` in its entry of `PAGES` in `scripts/lib/legal-page-text.mjs`, and the generator refuses an entry without one. Rule 21 checks that every page declares a job, and rule 22 and the rendered check hold the reading theme's contrast in both colour schemes.
- **The rendered check** is `node scripts/rendered-check.mjs` (`--only reflow,zoom,csp,theme,contrast,lineheight,measure` runs some of it). On Linux and macOS it needs Chrome, Chromium or Edge, which it looks for itself (`KOLWEN_BROWSER` names the binary if yours is elsewhere). On Windows it never starts a Windows browser: it runs the Blink headless shell inside a WSL distro, looked for at `~/tools/chrome-headless-shell-linux64/chrome-headless-shell` in that distro (the `chrome-headless-shell` build of Chrome for Testing, which Google's own page at `developer.chrome.com/blog/chrome-headless-shell` says to fetch with `npx @puppeteer/browsers install chrome-headless-shell@stable`; place it so the executable is at that path), and there `KOLWEN_BROWSER` is only `wsl` or `wsl:<distro>`, anything else being refused. `KOLWEN_FONT_HINTING` (`none`, `slight`, `medium` or `full`; unset is `none`) runs the WSL route once with that font hinting, to watch the plan table the way a Linux visitor's browser may draw it; another value is refused before the browser starts, and the pass line names the hinting the run used. A server on the Windows loopback cannot be reached from the distro, so nothing listens: the pages reach the browser over its DevTools channel, answered with the headers of the `/*` rule of `web/_headers`, so the Content-Security-Policy that is checked is the real one. With no browser route on the machine the run prints `NOT RUN HERE`, exits 3 (a pass is 0, findings 1, a bad argument 2) and is not a pass: the pass is the pull request's `rendered` job. A page that asks for a resource by host name fails as a `resources` finding, because the browser resolves no host name. Its header lists what each check measures and its stated limits. Only a Content-Security-Policy violation fails the `csp` check; what the browser says about other response headers (a Permissions-Policy feature name it does not know) is printed as a `NOTE` line and never fails the run. On Linux and macOS (the native route) the run reuses one browser profile, `KOLWEN_BROWSER_PROFILE` if you set it (it must name a new or empty folder: a folder with files in it and no `kolwen-browser-profile.marker` is refused) and otherwise `kolwen-browser-profile` in your own cache folder (`$XDG_CACHE_HOME` or `~/.cache`, never a shared temp folder); it is made once, private to you (mode 0700), and the code never deletes it. (That is why it is one profile and not one per run: on a developer's Windows machine a file-system filter can refuse every process but the browser the right to delete the files Edge writes, so a profile made for each run could never be removed; the check no longer starts a Windows browser.) On the WSL route the profile is different: each run makes a folder of its own inside the distro and the script removes it at the end, so there is no fixed profile, no marker and no lock on Windows. Each page and language is measured in a browser context of its own, off the record and disposed afterwards, so nothing is cleared browser-wide and nothing stays in the profile. The browser is started with no way to resolve a host name (only 127.0.0.1, where the check serves the pages, is reachable) and with Edge's implicit sign-in off, because a headless Edge otherwise signs the computer's Microsoft account in by itself and puts sign-in cookies in the profile; after every run the jars are read, and a cookie from outside 127.0.0.1 fails the run as a `cookies` finding (its name and domain are printed, never its value). A page whose language switch does not set the wanted `lang` fails as a `language` finding, so no page is measured in the language an earlier page left behind. A profile path that is a symlink or a junction is refused. The check chooses the DevTools port itself and never reads the browser's `DevToolsActivePort` file. On the native route, one run at a time: a second one fails at once with `the browser profile <path> is in use by another run`. The `kolwen-browser-*` folders that earlier versions of the check left in the temp folder may hold sign-in cookies (earlier versions did not stop headless Edge signing in) and should be deleted by hand; a delete is not promised to succeed. SC 1.4.8 is a target of the reading theme, never a claim that it is met.

## Adding a page, and moving a group

- Every served page belongs to exactly one group in `web-src/seams.json` (today the company site, whose `pages` list is the seven pages). A new file under `web/` that no group lists, or that two groups list, fails surface-check rule 20 and the message names the file: add its clean URL path to the group's `pages`.
- Rule 20 also holds what keeps a group able to get a host of its own by a redirect change: every page links the terms and privacy pages at kolwen.com, no other file copies a legal text, each path has exactly one Content-Security-Policy rule (a second zone would be another Worker with its own headers file, never a second rule in `web/_headers`), no cookie carries a `Domain` attribute, and no catalogue key names a host. `scripts/lib/domain-seams.mjs` is the list of record and states what it cannot see.
- No group has moved, and no group, zone or redirect names a host other than kolwen.com.

---

## Releasing

Nothing has been released. When the first release lands, it follows the series release pattern:
CHANGELOG entry, annotated tag, GitHub Release for stable tags only.

**A `py-v*` tag publishes to PyPI, so a tag here is an outward act—and the workflow enforces
that it was an intentional one.** Only a SIGNED, ANNOTATED tag passes: a lightweight tag has no
tag object and nothing to attribute, an unsigned one proves nothing, and a signature that does not
verify stops the run before anything is built. There is no override.

---

## License and conduct

Contributions are licensed under this repository's own outbound license—see
[LICENSE](LICENSE). No CLA: sending a PR licenses it the way the project already ships. Please
assume good faith and be respectful, per [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Report security
issues per [SECURITY.md](SECURITY.md), never in a public issue.

**Response time:** best effort by a solo maintainer. No SLA is promised, and none is implied by
this document.
