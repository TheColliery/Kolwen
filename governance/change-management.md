# Change management

> Part of Kolwen's control-family set. **Written from day one so that a future audit COLLECTS
> EVIDENCE rather than builds it** (owner ruling AR-10, 2026-09-06; what `AR-n` means is in
> [the index](README.md)). Everything under "Today" is a present-tense fact with its backing
> named; everything under "Planned" is not yet true.
> **No certification is held or claimed** — see `ISO-MAP.md`.

## Today

A change reaches the public site through a fixed path, every step of which is machine-checked:

1. The change is made and staged; the room's gates are run **after** staging, never before.
2. CI runs the byte-identity check on generated assets, the published-claims check, the reply-language
   harness and the clone battery. `all-green` gates on all of them.
3. CodeQL and Scorecard run on the same push.
4. A reviewer inspects before the push, not after — a defect this room named in its own record and
   corrected. **One carve-out has no human reviewer in its path: a Dependabot bump.**
   `.github/workflows/dependabot-auto-merge.yml` enables auto-merge under four conditions: the pull
   request's author is `dependabot[bot]` and no one else; the bump is patch or minor; the merge
   waits until the required status checks pass (listed in `access-control.md`); and a major bump
   and every human-authored pull request still wait for a human.
5. Cloudflare Workers Builds deploys, and `post-deploy-check.mjs` verifies the live bytes.
6. A package release additionally requires a signed annotated tag.

**Local hooks** mirror the surface check at commit and push time (`.githooks/`), enabled per clone
with `git config core.hooksPath .githooks`. **Nothing enforces that a clone runs that command** —
stated because it is the honest limit of the control.

## Planned

A second reviewer, once there is a second person.
