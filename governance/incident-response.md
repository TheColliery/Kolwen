# Incident response

> Part of Kolwen's control-family set. **Written from day one so that a future audit COLLECTS
> EVIDENCE rather than builds it** (owner ruling AR-10, 2026-09-06). Everything under "Today" is a
> present-tense fact with its backing named; everything under "Planned" is not yet true.
> **No certification is held or claimed** — see `ISO-MAP.md`.

## Today

- **Reporting channel:** GitHub private vulnerability reporting, with `SECURITY.md` as the public
  instruction. A private channel exists before an incident does.
- **Backup channel:** `contact@kolwen.com`, with the known limitation that it forwards but cannot
  send, stated in `SECURITY.md` rather than hidden.
- **Recorded history:** none since 2026-08-22, the repository's first commit — see
  `docs/TRUST.md` §5.
- **Rollback:** every deploy is a commit; reverting the commit redeploys the previous site, and
  `post-deploy-check.mjs` confirms what is actually being served.

## Planned

A written severity scale and a notification clock. Thailand's PDPA requires notification to the
regulator within 72 hours of becoming aware, and to affected users where the risk is high — that
obligation is recorded in `PRIVACY.md` and becomes operational the day personal data is processed.
