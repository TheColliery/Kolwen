# Support-agent build spec

The document the `/chat` build reads. **Nothing here runs yet** — this is the set of requirements
that bind the moment a conversational surface exists, gathered in one place so the build collects
them rather than rediscovers them.

## Already-binding requirements from other units

These are not restated here; each lives in its own spec and binds at the same surface:

- **Reply language** — `docs/REPLY-LANGUAGE.md`. The reply is in the language of the MESSAGE on
  every path. Its system-prompt rule and per-message detection are the at-surface halves.
- **Never a clone** — `docs/NEVER-A-CLONE.md`. The IC label, the SELF-DECAP battery, grounding
  that is never silent, and no canned refusal templates.

## Zero Data Retention is an account-mode requirement, not a setting to remember

Whichever AI provider Kolwen's support agent uses, the account or project it runs under must be
configured for zero data retention where the provider offers it, and the retention tier must be a
stated fact rather than a default nobody checked.

The concrete shape, from AWS Bedrock's own documentation (`docs.aws.amazon.com/bedrock/latest/
userguide/data-retention.html`, read 2026-09-06): retention modes run `none` (ZDR) < `default` <
`aws_review`. Under `none`, *"No request or response data is written to durable storage by AWS or
shared with the model provider."* **A model can require a higher tier than `none`** — Claude models
on Bedrock require `aws_review`, under which requests are retained inside AWS for up to 30 days for
AWS's own review and are still never forwarded to the model provider. If the account is pinned to
`none` and a model requires more, the request is **blocked with an error** rather than silently
retained.

**The requirement, therefore:** the build states which retention tier each provider account runs
under, and treats a tier it did not choose as a defect. A provider that offers no such control is a
finding for the owner before it is used.

## Retention window

**[90 days]** for conversation content, bracketed for the same reason `TERMS.md` brackets it.

## The start-of-chat notice and the end-of-chat consent button

**Design-time requirements of `/chat`: a start-of-chat notice and an end-of-chat consent control
for helping improve Kolwen. Their exact text is drafted and PENDING THE OWNER'S SIGNATURE — it is
not reproduced here, and no wording in this file should be treated as final.**

## What does not exist yet

No endpoint, no account with any provider, no conversation storage, no deletion job. Every
paragraph above is a requirement on a thing that has not been built.
