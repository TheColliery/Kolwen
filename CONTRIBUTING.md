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

Kolwen ships **zero dependencies**—Node.js built-ins only, Node 22+. There is no `npm install`,
no lockfile, and no build step.

```bash
node scripts/surface-check.mjs      # the room's own laws: claims, leakage, orthography, contrast
node brand/make-brand.mjs           # regenerate every brand asset; must leave git clean
node scripts/post-deploy-check.mjs  # compare the live site to what is committed (needs network)
```

The first two run in CI on every push and both must pass. The third runs after a deploy.

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
| `brand/` | The identity kit and the generator that is the source of the mark's geometry |
| `py/` | The PyPI name reservation. No runtime code yet |
| `docs/` | Operator documentation, starting with how the site deploys |
| `scripts/` | Zero-dependency checks that run in CI |

---

## Releasing

Nothing has been released. When the first release lands, it follows the series release pattern:
CHANGELOG entry, annotated tag, GitHub Release for stable tags only. A `py-v*` tag publishes to
PyPI, so a tag here is an outward act.

---

## License and conduct

Contributions are licensed under this repository's own outbound license—see
[LICENSE](LICENSE). No CLA: sending a PR licenses it the way the project already ships. Please
assume good faith and be respectful, per [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Report security
issues per [SECURITY.md](SECURITY.md), never in a public issue.

**Response time:** best effort by a solo maintainer. No SLA is promised, and none is implied by
this document.
