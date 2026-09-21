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

### Changed

- `PRIVACY.md` now carries an interim position beside each of its four `[pending legal review]`
  gaps, labelled as not legal advice. Every marker and the draft notice are unchanged: the gaps
  are still open for counsel, and the interim positions say only what Kolwen will do meanwhile.
- The favicon and touch icon are now generated from the brand icon rather than copied. The
  generator writes both places from one call, and CI fails if either drifts, so the mark cannot
  disagree with itself.

### Added

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
