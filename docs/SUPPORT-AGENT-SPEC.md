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

The concrete shape, from AWS Bedrock's own documentation, read 2026-09-06 at
`docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html`: retention modes run `none`
(ZDR) < `default` < `aws_review`. Under `none`, *"No request or response data is written to durable storage by AWS or
shared with the model provider."* **A model can require a higher tier than `none`** — Claude models
on Bedrock require `aws_review`, under which requests are retained inside AWS for up to 30 days for
AWS's own review and are still never forwarded to the model provider. If the account is pinned to
`none` and a model requires more, the request is **blocked with an error** rather than silently
retained.

**The requirement, therefore:** the build states which retention tier each provider account runs
under, and treats a tier it did not choose as a defect. A provider that offers no such control is a
finding for the owner before it is used.

## Retention window

**[N days]** for conversation content, bracketed for the same reason `TERMS.md` brackets it: N is
set before launch, and no statute supplies it.

## The start-of-chat notice and the end-of-chat consent button

**Design-time requirements of `/chat`: a start-of-chat notice and an end-of-chat consent control
for helping improve Kolwen. Their exact text is drafted and PENDING THE OWNER'S SIGNATURE — it is
not reproduced here, and no wording in this file should be treated as final.**

## Account enforcement, appeals and the person behind the AI

**The principle: an AI agent never works alone.** A support agent that refuses a refund "due to a violation"
before the appeal is decided, sends the customer back to the appeal form, and then lets the conversation close
as "no longer monitored" has turned a dispute into a loop with nobody in it. These requirements are each the
opposite of one step in that loop. They sit beside the abuse defences (the trigger side of enforcement, which
decides when a case opens) and the support-data clause (what a support conversation may retain); this section
covers what happens to the customer once an account action is on the table.

The enforcement process itself is in `TERMS.md` ("Acceptable use and how it is enforced"): notice, suspension
rather than termination, a window to answer, a written decision, one appeal to a human, and a register of
cases. The requirements below are how the support surface behaves around that process; none replaces a step.

1. **An AI first line, with a person always behind it.** The agent hands off to a person when the user asks for
   one, on any account action, on anything about money, when the same issue is raised a second time, and when
   its own confidence in an answer is low. **The AI never closes a thread that holds an open account action or
   dispute.**
2. **Every suspension states the rule and the conduct, and names the appeal route.** This is the "notice" step of
   the process, in the customer's hands. Whether the law or a live security investigation can justify delaying
   that notice is an open question for counsel, with its timing and content; the process in `TERMS.md` has no such
   exception, so until counsel decides, notice comes first.
3. **Every customer contact gets a case ID, in one numbering.** An appeal is a case with its type prefix, never a
   second scheme. The customer sees the case's state and a decision deadline that Kolwen sets and publishes (the
   Terms set **14 business days** to answer an appeal), **with an escalation when the deadline passes.** The ID rules
   are in "Case IDs and the case status page", below.
4. **One case across support, safety and billing.** Every door sees the same case and its ID, and no door sends the
   customer back to a door already tried.
5. **Money waits for the decision.** No refund is refused while an appeal is open, and a reversed suspension
   restores the time, or refunds pro rata, without a second request. This is the "refund follows the outcome"
   rule of the process.
6. **Data export and account deletion stay open during a suspension.**

**Also required:** a suspended or cancelled customer keeps their entitlement to human support for as long as
their dispute or appeal is open. A suspension never removes the person.

**Phase 1.** The AI support is the maintainer's assistant, and the maintainer is the person behind it. The AI
triages, keeps the case and its deadline, and drafts every reply; the maintainer reads, decides and sends
anything that touches an account, money or an appeal. The published appeal deadline is sized to one person. A
second person joins that lane when Kolwen hires.

**Checks still open** (counsel's, not answered here): whether a decision about an account taken solely by
automated processing needs a right to human intervention, to express a view and to contest it (GDPR Art. 22);
whether the EU Digital Services Act's duty to give a statement of reasons reaches this service; and the Thai
reading.

The support tool is a provider choice, and carries the same duty as every other provider: a studied alternative
and a way out within a day.

## Case IDs and the case status page

**The format.** `KW-XXXX-XXXX-C`: the prefix `KW`, a body of eight Crockford Base32 characters in two groups of four,
and one check character. An appeal's case takes the type prefix `KWA-` in place of `KW-`; its body and check
character follow the same rules. The shape borrows the postal S10 identifier's (a two-character prefix, an
eight-character body, one check character). It does not borrow the serial: the body is random, never a sequence.

**The body.** Each of the eight characters is one of the 32 symbols (the symbols 0 to 9, then ABCDEFGHJKMNPQRSTVWXYZ, Crockford's table, values 0 to 31 in that order), drawn from a
cryptographically secure random source: five random bits give one symbol, and 32 divides 256, so the draw is uniform
with no rejection step. A body already issued under either prefix is drawn again, never reused. Crockford's page accepts lowercase input and, at decode time only, reads `I` and `L` as `1`
and `O` as `0`. Source: https://www.crockford.com/base32.html, read 2026-11-02.

**The check character.** Read the eight body characters as one base-32 number N, the first character most
significant. The check character is the symbol at position N mod 37 (counting from 0) in the 37-symbol set (
the 32 symbols followed by `*`, `~`, `$`, `=` and `U`). Crockford's page: "The check symbol encodes the number modulo 37, 37 being the least prime number greater than 32." Example, not an issued ID: body `0000000Z` gives N = 31, 31 mod 37 = 31, and position 31 is `Z`, so the
format reads `KW-0000-000Z-Z`. The check character catches a mistyped ID; it does not authenticate one. The S10
check digit this copies the shape of is a different algorithm (weighted modulus 11 over digits only): UPU S10-12,
clause 5.4, approved 17 October 2017, read 2026-11-02.

**The requirements.**

1. **The ID is a reference, never the key.** The acknowledgement mail carries a status link with its own secret: a
   random string of at least 128 bits from a cryptographically secure source (a house choice; no standard gives this
   figure). Alternatively the reader proves control of the contact address before the page opens. Knowing a case ID
   opens nothing.
2. **The ID is random, never sequential.** A sequence would show how many cases there are and make the next one
   guessable.
3. **The case page shows the state and the deadline only, never the content.** No message, no reason text, no account
   data.
4. **Lookups are rate-limited.** The limit is set and published by Kolwen. The figure is not in this spec yet (see
   the open items below).

**The mail subject.** The ID is in the subject of every mail about the case, so a reply threads to it.

**The page.** It is called "Case status" and sits at `kolwen.com/support/case`. It is not called "tracking", and it
does not sit at `/status`, which is the site's service-health page.

**Open, for the maintainer and counsel:** the rate-limit figure; the status-link lifetime; whether a case ID is shown
to the customer in the app as well as in mail.

## What does not exist yet

No endpoint, no account with any provider, no conversation storage, no deletion job, no case ID generator, no case
status page and no mail threading. Every paragraph above is a requirement on a thing that has not been built.
