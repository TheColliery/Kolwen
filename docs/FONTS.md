# Fonts

The site's two typefaces are subsets of IBM's Plex families, under the SIL Open Font License 1.1. They are
renamed KW Sans Thai and KW Mono, because the licence reserves the name "Plex" for IBM. The face manifest is
`web/fonts/fonts.css`. `scripts/font-subset.mjs` makes the cut, and `scripts/font-coverage.test.mjs` checks that
no rendered character falls outside it.

## Provenance

The shipped files were cut from these IBM releases. The archive hashes identify the source a reader can
download from the same release.

| Face | Upstream release | Archive bytes | Archive sha256 |
|---|---|---|---|
| IBM Plex Sans Thai | `@ibm/plex-sans-thai` 1.1.0, github.com/IBM/plex | 1,985,960 | `sha256:d7203f43c20f9abd40487f845c48db4077d2056ea18632c8959591c6815d7fb9` |
| IBM Plex Mono | `@ibm/plex-mono` 2.5.0, github.com/IBM/plex | 6,940,652 | `sha256:6d23f01257663d8cc49a0d64c22ced630b79e0e2a0ac08a0da86e9a38bbc481c` |

GitHub publishes the Mono archive's digest; the Sans Thai asset carries none, so its digest is the one computed on fetch.

The archives were fetched on 2026-10-17.

## Shipped files

sha256 of each file as the site serves it. Update this table when a font file changes.

| File | sha256 |
|---|---|
| `web/fonts/thai/kw-sans-thai-400.7a93a32da9.woff2` | `sha256:7a93a32da9165054c8cfa4b4c9128ab830199246f6c5a79593b4b179beacc301` |
| `web/fonts/thai/kw-sans-thai-500.bab87050a2.woff2` | `sha256:bab87050a2baf72574b9f53de777b1fce54d3d99d096abed70f862a1316a5845` |
| `web/fonts/thai/kw-sans-thai-600.4e5f5074ff.woff2` | `sha256:4e5f5074fff353a0ec4c3eca96db4409241db33007dfddc4b8dc714427eebbb2` |
| `web/fonts/thai/kw-sans-thai-700.b87d41e0f9.woff2` | `sha256:b87d41e0f9ba47fa10d8b78c1c376b53690194ea64b67129106ebdfde57cb1b2` |
| `web/fonts/mono/kw-mono-400.e8d30e29b8.woff2` | `sha256:e8d30e29b872d10e077a21585b451781f9891682b9b827422ce9801e8298cb07` |
| `web/fonts/mono/kw-mono-500.78ee778fb0.woff2` | `sha256:78ee778fb0bcae3bda2096f04a40f7eb267f14dd1c836ae3262821bced98d0bc` |

Each folder keeps its licence beside the files (`thai/OFL.txt`, `mono/OFL.txt`). Both are committed with LF line
endings and no carriage-return bytes.
