# Changelog

All notable changes to Kolwen are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow SemVer.

**Nothing has been released.** There is no version number yet because there is no release—the
PyPI entry is a name reservation at `0.0.x`, not a product. The first entry below is the
Unreleased section, and it stays that way until something ships.

<!--
Section types map to bump size (keepachangelog.com/en/1.1.0):
  ### Added / ### Deprecated          -> MINOR minimum
  ### Removed / breaking ### Changed  -> MAJOR
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

### Changed

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
