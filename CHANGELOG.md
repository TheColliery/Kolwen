# Changelog

All notable changes to Kolwen are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow SemVer.

**Nothing has been released.** There is no version number yet because there is no release—the
PyPI entry is a name reservation at `0.0.x`, not a product. The first entry below is the
Unreleased section, and it stays that way until something ships.

<!--
Section types map to bump size (keepachangelog.com/en/1.1.0):
  ### Added / ### Deprecated          -> MINOR minimum
  ### Removed / breaking ### Added

- `PRIVACY.md`, published as a DRAFT with legal gaps by the owner’s order. Four clauses that
  need a lawyer carry a `[pending legal review]` marker instead of an answer. Not linked from the
  site, and not yet reviewed by counsel.
- `TERMS.md`, a draft with legal gaps, carrying the no-training covenant.
- `docs/TRUST.md`, `docs/SUPPORT-AGENT-SPEC.md` and a `governance/` set with an ISO map. All of it
  describes what is true today or is labelled a plan; no certification is held or claimed.

### Changed  -> MAJOR
  ### Fixed / non-breaking ### Changed / ### Security -> PATCH
Newest version first, each under `## [X.Y.Z] - YYYY-MM-DD`. A released entry is
immutable -- to correct one, add a forward-pointing note in the NEW entry, never
edit the old text. Every shipped tag gets an entry, landed BEFORE the tag.
-->

## [Unreleased]

### Corrections

Not one of Keep a Changelog's bump-mapped section types, deliberately: this corrects the project's
own RECORD, not its software, so mapping it to a SemVer bump would be wrong. It applies this
file's stated rule—add a forward-pointing note, never edit the old text—to a claim made in a
commit body rather than to a released entry.

- **`PRIVACY.md` printed a measurement that was not true.** It said `grep -n 'main' wrangler.jsonc`
  "returns nothing". The command matches a comment line that says the site deploys on a push to
  main, so it returned a line, and did so before this sitting. The page now names the check that
  does return nothing, `grep -nE '^[[:space:]]*"main"' wrangler.jsonc`, and states what the config
  declares, which now includes an empty `previews` block. The claim itself, that the Worker has no
  `main` entry point and so runs no code of ours, was and is true.

- **Two commit messages state that this repository stores its text files with CRLF line endings.
  They are wrong.** The commits are `220cc55` and `f632501`. The claim was already retracted in
  `b54cf0f`'s message, but no file in this repository carried the correction, and nobody browsing
  a repository reads commit bodies.
- **The measured truth:** reading bytes straight out of the index—`git cat-file blob` on every
  tracked path, counting `0x0D`—finds **41 text blobs, 13 binary, and zero CRLF pairs**. Not one
  tracked text file contains a carriage return. `c8bf1c5`, the commit the other two set out to
  correct, was right the first time.
- **The `.gitattributes` added in `c8bf1c5` stands, on its own reason.** It pins a convention that
  had never been declared, and its `/.githooks/** eol=lf` rule is what keeps the hooks executable
  on a POSIX box—a hook checked out with CRLF fails as a bad interpreter, which is a gate that
  is silently absent rather than loudly broken. It does not stand on "the repository was mixed",
  because that was never true.

Documentation claims that did not match the code or the record, found by an external automated
review of the repository and corrected in LWK-168. The earlier text is left in git history; this is
the pointer to it.

- **`governance/policies.md` and `docs/TRUST.md` said every published claim is machine-checked.**
  The rule is universal, but `scripts/surface-check.mjs` covers a named list of failure classes
  only. Both now say so. One of the classes the earlier sentence named, the absolute-local-path
  rule, had never been able to fire; the rule is fixed and the sentence no longer overstates it.
- **`PRIVACY.md` said nothing is sold or shared "because nothing is collected"**, in the same
  document that discloses Cloudflare handling every request and Google Fonts receiving the visitor's
  IP address. The statement is now scoped to Kolwen's own systems and names the three parties.
- **`TERMS.md` stated a retention period of 90 days while `PRIVACY.md` said conversations are
  session-only.** Both, and `docs/TRUST.md`, `docs/SUPPORT-AGENT-SPEC.md` and
  `governance/retention-deletion.md`, now carry one bracketed `[N days]`: no period has been
  chosen, and none is stated as fact.
- **`governance/change-management.md` said a reviewer inspects every change before it is pushed.**
  Dependabot patch and minor bumps auto-merge after the required checks pass; the exception and its
  conditions are now written into that item.
- **`docs/DEPLOY.md` still described unmatched paths answering 200 with the home page.** They have
  answered 404 since the 404 page shipped.
- **`docs/REPLY-LANGUAGE.md` said its scan proves no hard-coded single-language reply template
  exists.** It flags non-Latin text only; the limit is now stated. `docs/NEVER-A-CLONE.md` no longer
  copies the values of `web/ic.json`, and states which half of the battery's self-test CI can run.
- **`README.md` presented the four unreleased models in the present tense and said issues were
  welcome only after a first release**, against a `CONTRIBUTING.md` that already invites them.
- **Further corrections from the review of the above.** The README's opening sentence, the
  one-line pitch, still said the discipline goes into "a model you can actually run"; it now says
  no model has shipped. `docs/TRUST.md` said the served files are compared to what is committed
  "after every deploy": the check runs only after a push touching `web/`, `wrangler.jsonc` or the
  checker, and from CI it reads the Worker's `workers.dev` address because `kolwen.com` refuses
  the request, so what `kolwen.com` itself serves is not compared there. The row now says both.
  "Nothing is retained today" is scoped to conversation content in the four documents that carried
  it, because the contact mailbox holds what a visitor sends it.
- **Two Thai summaries said less than their English, in Kolwen's favour.** The cookie interim
  position dropped the promise not to rely on the strictly-necessary characterisation to skip a
  banner, and the retention sentence kept "no statute supplies the number" while dropping that a
  period must be stated, recorded and enforced. Both Thai summaries, and the one for the retrieval
  basis, now carry every obligation their English carries. The Thai has still not been read by a
  native legal reviewer.
- **A correction to the correction above: the fix made the English the looser half.** Fixing the
  cookie interim position's Thai to say no cookie "of that kind" left its English saying Kolwen
  "sets none", which read back to a clause about the chat cookie and could be taken as "sets no
  cookie at all". The English now says Kolwen sets no non-essential cookie. The Thai is unchanged.
- **`PRIVACY.md` cited the owner's rulings by their register id** in its draft header, in both
  languages, and in its gapped note. That published the numbering of a decision log that is not
  public. It now cites the ruling by its date. The governance documents keep their ids, and their
  index now says in one line what such an id is.
- **One interim clause in `PRIVACY.md` was phrased as a legal conclusion** ("it is a controller for
  that processing") while the gap it sits under reserves that characterisation to counsel. It is
  now phrased as Kolwen's own undertaking, in English and Thai alike ("Kolwen will treat it as a
  controller for that processing"). The gap and its marker are unchanged.
- **A correction to the correction to `governance/policies.md`: its list of what the surface check
  fails the build on was closed ("a named list of failures only") and the check outgrew it.** The
  list named eight classes; the check has ten rules. It left out the legal-gap marker rule, which
  had been extended to `TERMS.md` in the same batch, and a new half of the IC-label rule (a
  required-text key left empty or undeclared). The sentence no longer claims to be the complete
  list: it says the script's numbered rules are, summarises the classes that guard a published
  claim, and says the script wins where the two disagree. `docs/TRUST.md` now points at the script.

### Changed

- `docs/DEPLOY.md` no longer says the repository has no `package.json`, and no longer tells a
  reader to run `npx wrangler@4.128.0`. It now points at the pin in `package.json` and derives the
  version from there, so the number is written in one place.
- `TERMS.md`'s two legal gaps now carry numbered labels ("GAP 1", "GAP 2"), as `PRIVACY.md`'s do,
  so a check can tell whether a counsel-pending marker still sits beside each. No gap's wording
  changed beyond moving its marker to the front of its own sentence.
- `PRIVACY.md` now carries an interim position beside each of its four `[pending legal review]`
  gaps, labelled as not legal advice. Every marker and the draft notice are unchanged: the gaps
  are still open for counsel, and the interim positions say only what Kolwen will do meanwhile.
- The favicon and touch icon are now generated from the brand icon rather than copied. The
  generator writes both places from one call, and CI fails if either drifts, so the mark cannot
  disagree with itself.

### Added

- Workers Previews for the site. An empty `previews` block in `wrangler.jsonc` enables it, so a
  pull request gets a preview URL through Workers Builds. Previews are public, with no Cloudflare
  Access in front of them: owner ruling, 2026-09-23. The Worker has no binding, variable or
  secret, so a preview reaches nothing that is not already public. Not yet observed live.
- A `noindex` header for preview and version hosts only, as a host-pattern rule at the end of
  `web/_headers`. `kolwen.com` never matches it. It also matches production's own `workers.dev`
  alias, which is not `kolwen.com`; `docs/DEPLOY.md` names that residual. Checked by a local
  re-implementation of Cloudflare's documented matching, not against a live preview.
- Wrangler is pinned as a devDependency in a new `package.json` and `package-lock.json`, at
  4.136.3 exactly. Dependabot's new `npm` entry checks daily; a patch or minor bump auto-merges
  once CI is green, through the existing `dependabot-auto-merge.yml`, and a major bump waits for
  the owner. No Dependabot `npm` pull request has been observed yet.
- A real 404 page, in both languages. An address with no page behind it now answers HTTP 404;
  it used to answer 200 with the home page, so crawlers indexed pages that do not exist.
- Cache-Control headers for the static assets. The page itself stays on must-revalidate, because
  it carries the claims.
- A publish gate: only a signed, annotated tag can release the Python package. A lightweight tag,
  an unsigned one, or a signature that does not verify all stop before anything is built.
- The public site at kolwen.com, bilingual, English default with Thai behind a toggle.
- The brand kit, with the mark's geometry generated from a single zero-dependency script.
- Name reservations on PyPI and npm.
- Repository gates: a surface check for the room's published claims, a byte-identity check for
  every brand asset, and a post-deploy check comparing the live site to what is committed.
- The contributor spine: contributing guide, code of conduct, this changelog, issue templates.
